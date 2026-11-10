// Helper compartido por Node y navegador. Cargar operacion.js antes.
// No modifica pedidos, sesión, GPS ni llegadas: sólo propone contexto.
(() => {
  const ZONA_HORARIA = 'America/Mexico_City';
  const formatoMexico = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const lista = valor => Array.isArray(valor) ? valor : [];
  const coordenadasValidas = p => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
  const identidad = valor => typeof valor === 'string' ? valor
    : typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : '';
  const noSurtido = p => !!p.no_surtido_en || p.estado === 'no_surtido';

  function fechaValida(fecha) {
    if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
    const ms = Date.parse(fecha + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === fecha;
  }

  function enMexico(iso) {
    // Un instante sin offset dependería de la zona horaria del equipo.
    if (typeof iso !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i.test(iso)
      || !fechaValida(iso.slice(0, 10))) return null;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    const p = Object.fromEntries(formatoMexico.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`,
      minutos: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60 + ((ms % 1000) + 1000) % 1000 / 60000 };
  }

  function metrosEntre(a, b) {
    const rad = grados => grados * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }

  // ts y ahoraMs son milisegundos Unix. El cuarto argumento opcional permite
  // evaluar el mismo fix con un reloj explícito; el frontend usa el actual.
  function detectarPunto(pos, puntos, zonasPermitidas, ahoraMs = Date.now()) {
    const rechazo = motivo => ({ zona: '', motivo });
    if (!pos) return rechazo('sin_posicion');
    if (!coordenadasValidas(pos)) return rechazo('coordenadas_invalidas');
    if (!Number.isFinite(pos.ts) || !Number.isFinite(ahoraMs) || pos.ts > ahoraMs
      || ahoraMs - pos.ts > 90000) return rechazo('posicion_vieja');
    if (!Number.isFinite(pos.precision_m) || pos.precision_m < 0 || pos.precision_m > 100) {
      return rechazo('precision_invalida');
    }
    const registrados = lista(puntos).filter(p => coordenadasValidas(p) && identidad(p.zona)
      && Number.isFinite(p.radio_m ?? 150) && (p.radio_m ?? 150) > 0);
    if (!registrados.length) return rechazo('sin_puntos');
    const posibles = registrados.map(p => ({ zona: p.zona, radio: p.radio_m ?? 150, distancia: metrosEntre(pos, p) }))
      .filter(p => p.distancia <= p.radio + pos.precision_m);
    if (!posibles.length) return rechazo('fuera_de_radio');
    // Los permisos no vuelven inequívoco un solapamiento físico entre zonas.
    const zonas = new Set(posibles.map(p => p.zona));
    if (zonas.size !== 1) return rechazo('zona_ambigua');
    if (!posibles.some(p => p.distancia + pos.precision_m <= p.radio)) return rechazo('precision_cruza_borde');
    const zona = posibles[0].zona;
    if (!lista(zonasPermitidas).includes(zona)) return rechazo('zona_no_permitida');
    return { zona, motivo: '' };
  }

  function servicios(pedidos, zona, fecha) {
    if (!zona || !fechaValida(fecha)) return [];
    const grupos = new Map();
    for (const p of lista(pedidos)) {
      if (!p || p.zona !== zona || noSurtido(p)) continue;
      const cobertura = p.tipo === 'cobertura';
      if (p.tipo != null && p.tipo !== 'regular' && !cobertura) continue;
      const diaPedido = cobertura ? p.fecha_servicio : p.fecha_menu;
      if (diaPedido != null && diaPedido !== fecha) continue;
      const folio = identidad(p.folio);
      if (cobertura && !folio.trim()) continue;
      const sinProgramada = p.entrega_programada_en == null;
      const programada = cobertura && !sinProgramada ? enMexico(p.entrega_programada_en) : null;
      if (programada && programada.fecha !== fecha) continue;
      // Los folios antiguos no tenían programación; una fecha inválida presente
      // no recibe ese fallback, para no inventar un horario autorizado.
      const hora = cobertura && !sinProgramada ? programada?.hora || ''
        : globalThis.GoLunchOperacion.horaEntrega(p.turno, zona, fecha) || '';
      if (!cobertura && !hora) continue;
      const id = cobertura ? 'cobertura|' + folio : 'regular|' + p.turno;
      if (!grupos.has(id)) grupos.set(id, {
        id, titulo: cobertura ? 'Cobertura ' + folio : 'Regular · ' + (p.turno === 'turno_a' ? 'Turno A' : 'Turno B'),
        hora, turno: p.turno, zona, pedidos: [], pendientes: 0, total: 0
      });
      const servicio = grupos.get(id);
      // Un folio con horarios discordantes sigue visible para revisión manual.
      if (servicio.hora !== hora) servicio.hora = '';
      if (servicio.turno !== p.turno) servicio.turno = '';
      servicio.pedidos.push(p);
      servicio.total++;
      if (!p.entregado_en) servicio.pendientes++;
    }
    // Se conserva también cada servicio terminado: no adelanta el siguiente.
    return [...grupos.values()].sort((a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99') || a.id.localeCompare(b.id));
  }

  function sugerirServicio(agenda, ahoraISO, fecha) {
    const ahora = enMexico(ahoraISO);
    if (!fechaValida(fecha) || !ahora || ahora.fecha !== fecha) return '';
    let mejor = '', distancia = Infinity, empate = false;
    for (const s of lista(agenda)) {
      if (!s || !identidad(s.id) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.hora)) continue;
      const [h, m] = s.hora.split(':').map(Number);
      const diferencia = Math.abs(h * 60 + m - ahora.minutos);
      if (diferencia < distancia) {
        mejor = s.id; distancia = diferencia; empate = false;
      } else if (diferencia === distancia) empate = true;
    }
    return empate ? '' : mejor;
  }

  function esDelServicio(pedido, servicio) {
    if (!pedido) return false;
    const cobertura = pedido.tipo === 'cobertura';
    if (pedido.tipo != null && pedido.tipo !== 'regular' && !cobertura) return false;
    const clave = identidad(cobertura ? pedido.codigo_entrega : pedido.numero_empleado);
    if (!clave.trim()) return false;
    return lista(servicio?.pedidos).some(p => p && (p.tipo === 'cobertura') === cobertura
      && (p.tipo == null || p.tipo === 'regular' || p.tipo === 'cobertura')
      && identidad(cobertura ? p.codigo_entrega : p.numero_empleado) === clave);
  }

  globalThis.GoLunchGuiado = Object.freeze({ detectarPunto, servicios, sugerirServicio, esDelServicio });
})();
