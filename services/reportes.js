import { DateTime } from 'luxon';
import { MOTIVOS_TARDIA, ZONA as ZONA_COMEDOR } from './menu.js';
import { contarServicios, limiteComida, tardiaComida, horaComida } from './comidas.js';
import { noSurtida } from './incidencias.js';

const MIN_OPINIONES = 5;

export function construirReporte(ini, fin, pedidos, ahora = DateTime.now()) {
    const porDia = {}, porPlatillo = {}, porPlatilloRating = {};
    const rating = { si: 0, tal_vez: 0, no: 0, sin_responder: 0 };
    let entregados = 0, tardios = 0, noEntregados = 0, pendientes = 0, indeterminados = 0;
    const motivos = {};

    // Merma y recurrencia solo cuentan pedidos que YA se pudieron recoger. Un
    // pedido de hoy a las 9 am no es merma: todavía no le toca. Se usa el mismo
    // límite que marca las entregas tardías (hora del turno + tolerancia).
    const hoyISO = ahora.setZone(ZONA_COMEDOR).toISODate();
    const porEmpleado = {}, mermaTurno = {}, mermaZona = {}, rutas = {};

    const acumula = (mapa, clave, seEntrego) => {
      const c = mapa[clave] || (mapa[clave] = { evaluables: 0, entregados: 0, no_recogidos: 0 });
      c.evaluables++;
      if (seEntrego) c.entregados++; else c.no_recogidos++;
    };

    for (const p of pedidos) {
      porDia[p.fecha_menu] = (porDia[p.fecha_menu] || 0) + 1;

      const plat = p.opcion_texto || p.opcion_id;
      porPlatillo[plat] = (porPlatillo[plat] || 0) + 1;

      if (!noSurtida(p) && p.tipo !== 'cobertura') {
        if (['si', 'tal_vez', 'no'].includes(p.rating)) rating[p.rating]++;
        else rating.sin_responder++;
      }

      // La encuesta pregunta por UN platillo, así que la respuesta se guarda
      // junto a su platillo. Antes solo existía el total del periodo, que no
      // contesta la única pregunta que justifica preguntar: cuál quitar.
      // Se cuentan aparte los entregados, porque solo un platillo entregado
      // se pudo calificar: es el denominador honesto de la participación.
      if (!noSurtida(p) && p.tipo !== 'cobertura') {
      const c = porPlatilloRating[plat] || (porPlatilloRating[plat] = {
        platillo: plat, porciones: 0, entregados: 0, si: 0, tal_vez: 0, no: 0
      });
      c.porciones++;
      if (p.entregado_en) c.entregados++;
      if (['si', 'tal_vez', 'no'].includes(p.rating)) c[p.rating]++;
      }

      // Una falla del servicio conserva la solicitud, pero no se atribuye al
      // empleado ni se usa como entrega, merma por no recoger o calificación.
      if (noSurtida(p)) continue;

      // Sin turno no hay hora de entrega que vencer (pedidos viejos de
      // WhatsApp): se da por vencido cuando el día ya pasó.
      const limite = limiteComida(p);
      const yaVencio = limite ? ahora > limite : p.fecha_menu < hoyISO;

      if (yaVencio) {
        acumula(mermaTurno, p.turno || 'sin_turno', !!p.entregado_en);
        acumula(mermaZona,  p.zona  || 'sin_zona',  !!p.entregado_en);

        const emp = p.empleados || {};
        const clave = emp.numero_empleado || p.empleado_telefono;
        const e = porEmpleado[clave] || (porEmpleado[clave] = {
          numero_empleado: emp.numero_empleado || '',
          nombre: emp.nombre || '(empleado dado de baja)',
          pedidos: 0, no_recogidos: 0
        });
        e.pedidos++;
        if (!p.entregado_en) e.no_recogidos++;
      } else if (!p.entregado_en) {
        pendientes++;
      }

      if (!p.entregado_en) { noEntregados++; continue; }

      // Tiempos de ruta: la primera y la última entrega de cada turno de cada
      // día. No hay marca de "salió el vehículo", así que la ruta se mide entre
      // escaneos, que es lo que de verdad se registra.
      const t = DateTime.fromISO(p.entregado_en);
      if (t.isValid) {
        const k = JSON.stringify([p.fecha_menu, p.turno || 'sin_turno', p.zona || 'sin_zona', horaComida(p)]);
        const r = rutas[k] || (rutas[k] = {
          fecha: p.fecha_menu, turno: p.turno || 'sin_turno', zona: p.zona || 'sin_zona', horario: horaComida(p),
          entregas: 0, primera: t, ultima: t
        });
        r.entregas++;
        if (t < r.primera) r.primera = t;
        if (t > r.ultima)  r.ultima  = t;
      }

      // Tres estados, no dos. `esEntregaTardia` devuelve null cuando NO PUEDE
      // saberlo —turno inválido, hora ilegible—, y ese null caía en el `else`
      // y se contaba como entregado a tiempo. O sea que el número de
      // puntualidad que se le enseña al cliente salía optimista por defecto,
      // justo en la cifra de la que cuelga la penalización del 30%.
      // Ante la duda no se presume a favor: se cuenta aparte y se reporta.
      // (Hallazgo GL-018 de la auditoría.)
      const tardia = tardiaComida(p);
      if (tardia === true) {
        tardios++;
        const m = p.motivo_tardia || 'sin_motivo';
        motivos[m] = (motivos[m] || 0) + 1;
      } else if (tardia === false) {
        entregados++;
      } else {
        indeterminados++;
      }
    }

    const pct = (parte, total) => total ? Math.round((parte / total) * 1000) / 10 : 0;
    const hhmm = d => d.setZone(ZONA_COMEDOR).toFormat('HH:mm');

    const filasMerma = mapa => Object.entries(mapa)
      .map(([clave, c]) => ({ clave, ...c, pct_merma: pct(c.no_recogidos, c.evaluables) }))
      .sort((a, b) => b.no_recogidos - a.no_recogidos);

    const rutaPorDia = Object.values(rutas)
      .map(r => ({
        fecha: r.fecha, turno: r.turno, zona: r.zona, horario: r.horario, entregas: r.entregas,
        primera: hhmm(r.primera), ultima: hhmm(r.ultima),
        minutos: Math.round(r.ultima.diff(r.primera, 'minutes').minutes)
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.turno.localeCompare(b.turno));

    // Promedio de duración por turno. Un día con una sola entrega dura 0
    // minutos y aplanaría el promedio, así que no cuenta como ruta.
    const acumTurno = {};
    for (const r of rutaPorDia) {
      if (r.entregas < 2) continue;
      const a = acumTurno[r.turno] || (acumTurno[r.turno] = { dias: 0, minutos: 0 });
      a.dias++;
      a.minutos += r.minutos;
    }

    return {
      ini, fin, ...contarServicios(pedidos),
      rating_elegibles: pedidos.filter(p => p.tipo !== 'cobertura' && !noSurtida(p)).length,
      no_surtidos: pedidos.filter(noSurtida).length,
      incidencias: pedidos.filter(noSurtida).map(p => ({ fecha:p.fecha_menu, tipo:p.tipo || 'regular', folio:p.folio || null,
        numero_empleado:p.empleados?.numero_empleado || '', nombre:p.empleados?.nombre || '',
        platillo:p.opcion_texto || p.opcion_id, turno:p.turno, zona:p.zona,
        motivo:p.no_surtido_motivo, registrado_en:p.no_surtido_en, registrado_por:p.no_surtido_por })),
      // Ordenados para graficar sin que el cliente tenga que hacerlo
      pedidos_por_dia: Object.entries(porDia).sort().map(([fecha, n]) => ({ fecha, pedidos: n, ...contarServicios(pedidos.filter(p => p.fecha_menu === fecha)) })),
      porciones_por_platillo: Object.entries(porPlatillo)
        .sort((a, b) => b[1] - a[1]).map(([platillo, n]) => ({ platillo, porciones: n,
          ...contarServicios(pedidos.filter(p => (p.opcion_texto || p.opcion_id) === platillo)) })),
      rating,
      // Qué platillo gustó y cuál no. La aprobación pesa las tres respuestas
      // en una sola cifra comparable —"me gustó" vale 100, "estuvo bien" 50,
      // "no me gustó" 0— y se ordena de peor a mejor, porque la decisión que
      // alimenta es cuál sacar del menú. Los platillos que nadie calificó van
      // al final con aprobación nula: no se puede juzgar lo que no se opinó,
      // y ponerlos en 0 los haría parecer los peores.
      rating_por_platillo: Object.values(porPlatilloRating)
        .map(c => {
          const respondidos = c.si + c.tal_vez + c.no;
          return {
            ...c,
            respondidos,
            sin_calificar: Math.max(0, c.entregados - respondidos),
            // Entero y no decimales: un 37.5% sobre cuatro opiniones aparenta
            // una precisión que el dato no tiene.
            aprobacion: respondidos
              ? Math.round((c.si * 100 + c.tal_vez * 50) / respondidos)
              : null,
            // Debajo de este mínimo la cifra no se publica como porcentaje: se
            // muestran las respuestas en crudo. Un platillo con dos opiniones
            // no debe encabezar una decisión de menú solo por salir en 0%.
            muestra_corta: respondidos > 0 && respondidos < MIN_OPINIONES,
            participacion: c.entregados ? pct(respondidos, c.entregados) : 0
          };
        })
        // Arriba lo que sí se puede leer —peor calificado primero—, luego lo de
        // muestra corta y al final lo que nadie opinó. Así la cabeza de la
        // tabla siempre es material de decisión y no ruido con pocas respuestas.
        .sort((a, b) => {
          const grupo = x => x.respondidos === 0 ? 2 : (x.muestra_corta ? 1 : 0);
          const ga = grupo(a), gb = grupo(b);
          if (ga !== gb) return ga - gb;
          if (ga === 0) return a.aprobacion - b.aprobacion || b.respondidos - a.respondidos;
          if (ga === 1) return b.respondidos - a.respondidos;
          return b.porciones - a.porciones;
        }),
      min_opiniones: MIN_OPINIONES,
      // pendientes = ya pedidos pero cuya hora de entrega aún no llega; van
      // dentro de no_entregados y por eso se informan aparte.
      // 'indeterminados' son entregas cuyo turno u hora no permiten decidir si
      // fueron puntuales. Se informan aparte en vez de sumarse a los puntuales:
      // un dato que no se tiene no debe verse como un dato a favor.
      entrega: { entregados, tardios, indeterminados, no_entregados: noEntregados, pendientes },
      motivos_tardia: Object.entries(motivos)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({ motivo: MOTIVOS_TARDIA[id] || 'Sin motivo indicado', veces: n })),

      sin_recoger: Object.values(porEmpleado)
        .filter(e => e.no_recogidos > 0)
        .map(e => ({ ...e, pct: pct(e.no_recogidos, e.pedidos) }))
        .sort((a, b) => b.no_recogidos - a.no_recogidos || b.pct - a.pct),
      merma: {
        por_turno: filasMerma(mermaTurno).map(f => ({ turno: f.clave, ...f, clave: undefined })),
        por_zona:  filasMerma(mermaZona).map(f  => ({ zona:  f.clave, ...f, clave: undefined }))
      },
      ruta: {
        por_dia: rutaPorDia,
        promedio_por_turno: Object.entries(acumTurno)
          .map(([turno, a]) => ({ turno, dias: a.dias, tramos: a.dias, minutos_promedio: Math.round(a.minutos / a.dias) }))
          .sort((a, b) => a.turno.localeCompare(b.turno))
      }
    };
}
