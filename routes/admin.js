import { validarVigenciaMenu, errorPublicarMenu } from '../services/menu-cobertura.js';
import { autorizarPanel } from '../services/acceso-panel.js';
// routes/admin.js — API REST para el panel de administración
import express from 'express';
import { DateTime } from 'luxon';
import * as db from '../services/supabase.js';
import * as wa from '../services/whatsapp.js';
import { construirListMessage, esEntregaTardia, MOTIVOS_TARDIA, limiteEntrega, hoy, ZONA as ZONA_COMEDOR } from '../services/menu.js';
import { diezDigitos, claveEmpleado } from '../services/telefono.js';
import { resumenCocina } from '../services/cocina.js';
import { fechaServicio } from '../services/pedidos.js';
import { hashClave, generarClave } from '../services/sesion.js';
import { horarioCobertura, validarTurnoCobertura } from '../services/cobertura.js';
import { estadoExtraordinaria, autorizarExtraordinaria } from '../services/cobertura-extraordinaria.js';
import { contarServicios } from '../services/comidas.js';
import { comidasDelPeriodo } from '../services/consultas-comidas.js';
import { normalizarSeleccionCocina, seleccionarPedidosCocina } from '../services/seleccion-cocina.js';
import { construirReporte } from '../services/reportes.js';
import { construirDashboard } from '../services/dashboard.js';

export const adminRouter = express.Router();

// El servidor aplica permisos aunque se intente llamar directamente a la API.
adminRouter.use(autorizarPanel);
adminRouter.get('/sesion', (req, res) => {
  res.json({ usuario: req.rolPanel === 'gerente' ? 'gerente' : 'admin', rol: req.rolPanel });
});

// ── Empleados ───────────────────────────────────────────────────

adminRouter.get('/empleados', async (req, res) => {
  try {
    res.json({ empleados: await db.listEmpleados() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/empleados', async (req, res) => {
  try {
    const { telefono, nombre, numero_empleado, activo, zona_default, turno_default } = req.body;
    if (!nombre || !numero_empleado) {
      return res.status(400).json({ error: 'Faltan campos: nombre, numero_empleado' });
    }
    const emp = await db.upsertEmpleado({
      telefono, nombre, numero_empleado, activo,
      ...(Object.hasOwn(req.body, 'zona_default') ? { zona_default } : {}),
      ...(Object.hasOwn(req.body, 'turno_default') ? { turno_default } : {})
    });
    res.json({ ok: true, empleado: emp });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

adminRouter.put('/empleados/:telefono/activo', async (req, res) => {
  try {
    const { activo } = req.body;
    const emp = await db.setEmpleadoActivo(req.params.telefono, !!activo);
    res.json({ ok: true, empleado: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Corregir el teléfono conservando el historial de pedidos.
// Va aparte del POST de alta porque ese hace upsert por teléfono: capturar el
// número bueno ahí no edita al empleado, da de alta uno nuevo.
adminRouter.put('/empleados/:telefono/telefono', async (req, res) => {
  try {
    const nuevo = req.body?.telefono_nuevo;
    if (diezDigitos(nuevo).length !== 10) {
      return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos' });
    }
    const r = await db.cambiarTelefonoEmpleado(req.params.telefono, nuevo);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Borrar un empleado se lleva TODOS sus pedidos por el ON DELETE CASCADE de la
// llave foránea, incluidos los del día en curso que ya están en la cocina. Eso
// destruyó un día entero de pedidos del piloto: se ven las consultas al menú
// (la tabla accesos no tiene llave foránea y sobrevive) pero los pedidos ya no
// están, y en el plan Free de Supabase no hay respaldo del que recuperarlos.
//
// Así que ya no se borra a quien tiene historial. Desactivar hace lo que la
// gente quiere en la práctica —sacarlo de las listas— y conserva la evidencia
// de las entregas, que es lo que respalda la facturación ante el cliente.
adminRouter.delete('/empleados/:telefono', async (req, res) => {
  try {
    const cuantos = await db.contarPedidosDeEmpleado(req.params.telefono);
    if (cuantos > 0) {
      return res.status(409).json({
        error: `Este empleado tiene ${cuantos} pedido(s) registrados y borrarlo los eliminaría también. ` +
               `Usa Desactivar: lo saca de las listas y conserva su historial.`,
        motivo: 'tiene_pedidos', pedidos: cuantos
      });
    }
    await db.deleteEmpleado(req.params.telefono);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Repartidores ────────────────────────────────────────────────
// Todo este bloque va bajo ADMIN_KEY, que es lo que protege al router. La
// clave del repartidor se asigna aquí: él no crea la suya, y en ninguna
// respuesta viaja el hash — las consultas piden columnas explícitas.
const ZONAS_REPARTO = ['zona_vdc', 'zona_refris'];

function zonasLimpias(zonas) {
  if (!Array.isArray(zonas)) return null;
  const z = [...new Set(zonas)].filter(x => ZONAS_REPARTO.includes(x));
  return z.length ? z : null;
}

// Largo mínimo cuando la clave la escribe el administrador. Las generadas
// traen 8 caracteres; el riesgo está en la escrita a mano con prisa, que sin
// esto podía ser "1". El límite de intentos ayuda, pero no salva a una clave
// de tres dígitos. Devuelve el motivo para que el panel lo pueda explicar.
const CLAVE_MINIMA = 6;
function claveElegida(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return { usar: null };   // que la genere el servidor
  const limpia = valor.trim();
  if (limpia.length < CLAVE_MINIMA) {
    return { error: `La clave debe tener al menos ${CLAVE_MINIMA} caracteres. Déjala vacía para que se genere una.` };
  }
  return { usar: limpia };
}

adminRouter.get('/repartidores', async (req, res) => {
  try {
    res.json({ repartidores: await db.listRepartidores() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/repartidores', async (req, res) => {
  try {
    const { nombre, zonas, clave } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'Se requiere el nombre' });
    }
    const z = zonasLimpias(zonas);
    if (!z) return res.status(400).json({ error: 'Se requiere al menos una zona válida', zonas_validas: ZONAS_REPARTO });

    // Si el administrador no escribe una, se genera legible para dictarla.
    const elegida = claveElegida(clave);
    if (elegida.error) return res.status(400).json({ error: elegida.error });
    const enClaro = elegida.usar || generarClave();
    const repartidor = await db.crearRepartidor({
      nombre: String(nombre).trim(), zonas: z, clave_hash: await hashClave(enClaro)
    });
    // La clave viaja UNA sola vez, aquí, y nunca se vuelve a poder consultar:
    // en la base solo queda el hash.
    res.json({ ok: true, repartidor, clave: enClaro });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/repartidores/:id', async (req, res) => {
  try {
    const { nombre, zonas, activo } = req.body || {};
    const cambios = {};
    if (nombre !== undefined) {
      if (!String(nombre).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
      cambios.nombre = String(nombre).trim();
    }
    if (zonas !== undefined) {
      const z = zonasLimpias(zonas);
      if (!z) return res.status(400).json({ error: 'Se requiere al menos una zona válida', zonas_validas: ZONAS_REPARTO });
      cambios.zonas = z;
    }
    if (activo !== undefined) cambios.activo = !!activo;

    const repartidor = await db.actualizarRepartidor(req.params.id, cambios);
    // Desactivar tiene que cerrar la sesión que ya estaba abierta: si el
    // equipo se perdió, dejar de poder entrar mañana no sirve de nada.
    if (activo === false) await db.invalidarSesiones(req.params.id);
    res.json({ ok: true, repartidor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restablecer clave. No existe "ver la clave actual" a propósito: solo hay
// hash, y poder recuperarla querría decir que no está bien guardada.
adminRouter.post('/repartidores/:id/clave', async (req, res) => {
  try {
    const elegida = claveElegida(req.body?.clave);
    if (elegida.error) return res.status(400).json({ error: elegida.error });
    const enClaro = elegida.usar || generarClave();
    await db.actualizarRepartidor(req.params.id, { clave_hash: await hashClave(enClaro) });
    // Cambiar la clave cierra las sesiones abiertas con la anterior.
    const repartidor = await db.invalidarSesiones(req.params.id);
    res.json({ ok: true, repartidor, clave: enClaro });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Coberturas del segundo turno ───────────────────────────────
adminRouter.get('/cobertura/extraordinarias', async (req, res) => {
  try { res.json(await estadoExtraordinaria()); }
  catch (err) { res.status(500).json({ error: 'No se pudo consultar el menú especial de hoy.' }); }
});
adminRouter.post('/cobertura/extraordinarias', async (req, res) => {
  try {
    const solicitud = await autorizarExtraordinaria(req.body || {}, req.rolPanel);
    res.json({ ok: true, solicitud });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Glovis decide quién está autorizado; CICSA lo selecciona de la plantilla
// existente. No hay una segunda captura libre de nombre o número.
adminRouter.get('/cobertura/supervisores', async (req, res) => {
  try {
    res.json({ supervisores: await db.listSupervisoresCobertura() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/cobertura/supervisores', async (req, res) => {
  try {
    const { empleado_telefono, clave, vigente_desde, vigente_hasta } = req.body || {};
    if (!empleado_telefono) return res.status(400).json({ error: 'Selecciona un empleado de la plantilla.' });
    if (vigente_desde && !/^\d{4}-\d{2}-\d{2}$/.test(vigente_desde)) {
      return res.status(400).json({ error: 'La fecha de inicio no es válida.' });
    }
    if (vigente_hasta && !/^\d{4}-\d{2}-\d{2}$/.test(vigente_hasta)) {
      return res.status(400).json({ error: 'La fecha de término no es válida.' });
    }
    if (vigente_desde && vigente_hasta && vigente_hasta < vigente_desde) {
      return res.status(400).json({ error: 'La fecha de término no puede ser anterior al inicio.' });
    }
    const empleado = await db.getEmpleado(empleado_telefono);
    if (!empleado) return res.status(404).json({ error: 'El empleado no existe o está inactivo.' });
    const elegida = claveElegida(clave);
    if (elegida.error) return res.status(400).json({ error: elegida.error });
    const enClaro = elegida.usar || generarClave();
    const supervisor = await db.crearSupervisorCobertura({
      empleado_telefono: empleado.telefono,
      clave_hash: await hashClave(enClaro),
      vigente_desde,
      vigente_hasta
    });
    res.json({ ok: true, supervisor, clave: enClaro });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ese empleado ya está autorizado como supervisor.' });
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/cobertura/supervisores/:id', async (req, res) => {
  try {
    const cambios = {};
    if (req.body?.activo !== undefined) cambios.activo = !!req.body.activo;
    if (req.body?.vigente_desde !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.vigente_desde || '')) {
        return res.status(400).json({ error: 'La fecha de inicio no es válida.' });
      }
      cambios.vigente_desde = req.body.vigente_desde;
    }
    if (req.body?.vigente_hasta !== undefined) {
      if (req.body.vigente_hasta && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.vigente_hasta)) {
        return res.status(400).json({ error: 'La fecha de término no es válida.' });
      }
      cambios.vigente_hasta = req.body.vigente_hasta || null;
    }
    let supervisor = await db.actualizarSupervisorCobertura(req.params.id, cambios);
    if (req.body?.activo === false) supervisor = await db.subirVersionSesionSupervisor(req.params.id);
    res.json({ ok: true, supervisor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/cobertura/supervisores/:id/clave', async (req, res) => {
  try {
    const elegida = claveElegida(req.body?.clave);
    if (elegida.error) return res.status(400).json({ error: elegida.error });
    const enClaro = elegida.usar || generarClave();
    await db.actualizarSupervisorCobertura(req.params.id, { clave_hash: await hashClave(enClaro) });
    const supervisor = await db.subirVersionSesionSupervisor(req.params.id);
    res.json({ ok: true, supervisor, clave: enClaro });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/cobertura/menu/:fecha', async (req, res) => {
  try {
    res.json({ menu: await db.getMenuCobertura(req.params.fecha) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/cobertura/menu', async (req, res) => {
  const validacion = validarVigenciaMenu(req.body);
  if (validacion.error) return res.status(400).json({ error: validacion.error });
  try {
    const resultado = await db.publicarPeriodoMenuCobertura(validacion.menu);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('[Cobertura] Error publicando vigencia:', err.message);
    const respuesta = errorPublicarMenu(err);
    res.status(respuesta.status).json({ error: respuesta.error });
  }
});

adminRouter.get('/cobertura/solicitudes/:fecha', async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.fecha || '')) {
      return res.status(400).json({ error: 'Fecha inválida.' });
    }
    const turno = validarTurnoCobertura(req.query.turno);
    const todas = await db.listSolicitudesCobertura(req.params.fecha);
    const solicitudes = todas.filter(s => s.turno === turno);
    const horario = horarioCobertura(turno);
    const por_turno = ['turno_a', 'turno_b'].map(t => {
      const activas = todas.filter(s => s.turno === t && s.estado !== 'cancelada');
      const normales = activas.filter(s => s.origen !== 'extraordinaria');
      const h = horarioCobertura(t);
      return { turno: t, total_solicitudes: activas.length, total_porciones: activas.reduce((n,s) => n + s.total_porciones,0),
        solicitudes_corte: normales.length, porciones_corte: normales.reduce((n,s) => n + s.total_porciones,0),
        horario: h.fecha === req.params.fecha ? h : null };
    });
    res.json({
      solicitudes, turno, por_turno,
      total_solicitudes: solicitudes.filter(s => s.estado !== 'cancelada').length,
      total_porciones: solicitudes.filter(s => s.estado !== 'cancelada')
        .reduce((s, x) => s + (x.total_porciones || 0), 0),
      // El panel usa la hora del servidor, no la del equipo, para decidir
      // cuándo cerrar, sonar y presentar la comanda final.
      horario: horario.fecha === req.params.fecha ? horario : null
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Menús ───────────────────────────────────────────────────────

adminRouter.get('/menu/:fecha', async (req, res) => {
  try {
    const menu = await db.getMenu(req.params.fecha);
    res.json({ menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/menu', async (req, res) => {
  try {
    const { fecha, fija_a, fija_b, fija_c, var_1, var_2, var_3 } = req.body;
    if (!fecha || !fija_a || !fija_b || !fija_c || !var_1 || !var_2 || !var_3) {
      return res.status(400).json({ error: 'Faltan campos del menú (se requieren las 6 opciones y la fecha)' });
    }
    const menu = await db.upsertMenu({ fecha, fija_a, fija_b, fija_c, var_1, var_2, var_3 });
    res.json({ ok: true, menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Próximos 7 días y si ya tienen menú. Ahora que "sin menú = sin servicio",
// olvidar publicar se vería idéntico a un día festivo: esta vista hace el
// olvido visible en el panel.
adminRouter.get('/menus-proximos', async (req, res) => {
  try {
    const tz = process.env.TZ || 'America/Mexico_City';
    const inicio = DateTime.now().setZone(tz).plus({ days: 1 });
    const fin = inicio.plus({ days: 6 });

    const publicadas = new Set(await db.getFechasConMenu(inicio.toISODate(), fin.toISODate()));

    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = inicio.plus({ days: i }).setLocale('es');
      dias.push({
        fecha: d.toISODate(),
        dia_semana: d.toFormat('ccc'),        // "lun", "mar", ...
        dia_num: d.day,
        publicado: publicadas.has(d.toISODate()),
        es_fin_de_semana: d.weekday >= 6
      });
    }
    res.json({ dias });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pedidos ─────────────────────────────────────────────────────

adminRouter.get('/pedidos/:fecha', async (req, res) => {
  try {
    const pedidos = await db.getPedidosPorFecha(req.params.fecha);
    res.json({ fecha: req.params.fecha, count: pedidos.length, pedidos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/pedidos', async (req, res) => {
  try {
    const { ini, fin } = req.query;
    if (!ini || !fin) return res.status(400).json({ error: 'Se requieren parámetros ini y fin (YYYY-MM-DD)' });
    const pedidos = await db.getPedidosRango(ini, fin);
    res.json({ ini, fin, count: pedidos.length, pedidos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resumen para cocina: conteo por platillo (con desglose por turno y zona)
adminRouter.get('/resumen-cocina/:fecha', async (req, res) => {
  try {
    res.json(await resumenCocina(req.params.fecha, req.query));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Reportes consolidados: cada comida conserva servicio, estado y horario.
adminRouter.get('/reportes', async (req, res) => {
  try {
    const { ini, fin } = req.query;
    const filtros = normalizarSeleccionCocina(req.query);
    const comidas = seleccionarPedidosCocina(await comidasDelPeriodo(ini, fin), filtros);
    res.json({ ...construirReporte(ini, fin, comidas), filtros });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

adminRouter.get('/comidas/:fecha', async (req, res) => {
  try {
    const filtros = normalizarSeleccionCocina(req.query);
    const comidas = seleccionarPedidosCocina(await comidasDelPeriodo(req.params.fecha), filtros);
    res.json({ fecha: req.params.fecha, filtros, count: comidas.length, ...contarServicios(comidas), comidas });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

adminRouter.get('/comidas', async (req, res) => {
  try {
    const { ini, fin } = req.query, filtros = normalizarSeleccionCocina(req.query);
    const comidas = seleccionarPedidosCocina(await comidasDelPeriodo(ini, fin), filtros);
    res.json({ ini, fin, filtros, count: comidas.length, ...contarServicios(comidas), comidas });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Envío masivo del menú a todos los empleados activos ──────────

adminRouter.post('/enviar-menu', async (req, res) => {
  try {
    const fecha = await fechaServicio();
    const menu = fecha ? await db.getMenu(fecha) : null;
    if (!menu) return res.status(400).json({ error: 'No hay ningún menú publicado a futuro' });

    const empleados = await db.listEmpleadosActivos();

    // Excluir a quienes ya tienen pedido registrado para mañana
    const pedidos = await db.getPedidosPorFecha(fecha);
    const yaPidieron = new Set(pedidos.map(p => claveEmpleado(p.empleado_telefono)));
    const pendientes = empleados.filter(emp => diezDigitos(emp.telefono).length === 10 && !yaPidieron.has(claveEmpleado(emp.telefono)));

    let enviados = 0, fallidos = 0;
    const errores = [];

    for (const emp of pendientes) {
      try {
        const payload = construirListMessage(emp.telefono, emp.nombre, menu);
        const resp = await wa.enviarListMessage(payload);
        // Intentar extraer el message_id (wamid) de la respuesta de WhatsApp
        const msgId = resp?.messages?.[0]?.id || null;
        enviados++;
        await db.registrarEnvio({
          fecha_menu: fecha,
          telefono: emp.telefono,
          nombre: emp.nombre,
          estado: 'enviado',
          message_id: msgId
        });
      } catch (err) {
        fallidos++;
        errores.push({ telefono: emp.telefono, error: err.message });
        await db.registrarEnvio({
          fecha_menu: fecha,
          telefono: emp.telefono,
          nombre: emp.nombre,
          estado: 'fallido',
          error: err.message
        }).catch(()=>{});
      }
    }

    res.json({
      ok: true,
      fecha,
      enviados,
      fallidos,
      omitidos: yaPidieron.size,
      total_activos: empleados.length,
      errores
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard de envíos: estado por empleado para una fecha ──────

adminRouter.get('/dashboard/:fecha', async (req, res) => {
  try {
    const fecha = req.params.fecha;
    const [empleados, pedidos, coberturas] = await Promise.all([
      db.listEmpleadosActivos(),
      db.getPedidosPorFecha(fecha),
      db.getCoberturasParaEntrega(fecha)
    ]);
    // Quién abrió la app ese día. Si la tabla todavía no existe en la base, el
    // dashboard sigue funcionando como antes en vez de caerse entero.
    //
    // Pero se recuerda SI falló, y eso es lo importante: sin la bandera, una
    // consulta caída dejaba la lista vacía y todos los que no pidieron salían
    // como "no abrió la app" — el panel afirmaba un dato duro sobre gente que
    // quizá sí entró. Y las dos lecturas piden acciones opuestas: si nadie
    // abrió se ataca la difusión, si abrieron y no pidieron se ataca el menú.
    // Confundirlas es justo lo que esta función existe para evitar, así que
    // cuando no se sabe hay que decir que no se sabe.
    let accesos = [];
    let accesosOk = true;
    try {
      accesos = await db.getAccesosPorFecha(fecha);
    } catch (err) {
      accesosOk = false;
      console.error('[Panel] No se pudo leer accesos de', fecha, '—', err.message);
    }
    res.json(construirDashboard({fecha, empleados, pedidos, coberturas, accesos, accesosOk}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
