import { rolPanel } from '../services/acceso-panel.js';
// routes/entrega.js — API de confirmación de entregas (escaneo del QR)
//
// Va separada de /api porque su clave es distinta: el repartidor usa
// ENTREGA_KEY, que solo sirve para esto. Si el teléfono se pierde o la
// persona cambia, se rota ENTREGA_KEY en Railway sin tocar la ADMIN_KEY.
// La ADMIN_KEY también se acepta, para que el panel siga funcionando.

import express from 'express';
import { DateTime } from 'luxon';
import * as db from '../services/supabase.js';
import {
  verificarClave, emitirToken, leerToken,
  registrarIntento, limpiarIntentos, DURACION_SESION_HORAS
} from '../services/sesion.js';
import {
  MOTIVOS_TARDIA, MOTIVOS_TARDIA_VALIDOS,
  horarioZona, TOLERANCIA_TARDIA_MIN,
  ZONAS_VALIDAS, TURNOS_VALIDOS, ZONA, hoy
} from '../services/menu.js';
import { validarReceptorEscaneado } from '../services/cobertura.js';
import { turnoValido } from '../services/reparto-grupos.js';

export const entregaRouter = express.Router();

// La fecha de REPARTO es hoy, y no tiene nada que ver con la de PEDIDO.
//
// `fechaServicio()` responde "el próximo día con menú" — o sea mañana o después,
// nunca hoy: es la fecha para la que la gente está pidiendo. La app del
// repartidor la usaba para decidir qué entregar, así que le mostraba los pedidos
// de MAÑANA y dejaba marcarlos entregados un día antes. Eso destruye justo lo
// que la evidencia debe probar: una hora de entrega no vale nada si se puede
// sellar antes de que la comida exista.
//
// Se acepta `hoy` como fecha en la URL para que el aparato no tenga que
// calcularla: el reloj de un teléfono puede estar mal, y quien manda es el
// servidor, que ya vive en la zona del comedor.
function fechaPedida(param) {
  return (param === 'hoy' || !param) ? hoy() : param;
}

// La hora de entrega la pone el reloj del TELÉFONO, y tiene que ser así: el
// reparto ocurre sin señal y lo que importa es el instante del escaneo, no el
// de la sincronización. Pero ese reloj no se validaba de ninguna forma, y esa
// hora es exactamente la que decide la penalización del 30% del contrato: un
// aparato con la fecha mal puesta —o alguien mandando un POST a mano— podía
// sellar cualquier cosa. (Hallazgo GL-008 de la auditoría.)
//
// La regla es la más estrecha que no estorba: una entrega del día X tiene que
// haber ocurrido dentro del día civil X en la hora del comedor. Una cola que
// sincroniza al día siguiente sigue trayendo la hora original del escaneo, que
// cae dentro de su propio día, así que no la afecta.
//
// Lo que no pasa la prueba NO se rechaza —la comida sí se entregó— sino que se
// sella con la hora de recepción del servidor. Vale más una hora aproximada y
// honesta que una inventada por un reloj descompuesto. La hora del servidor ya
// se guarda aparte en `entrega_recibido_en`, así que la desviación es auditable.
function horaEntregaConfiable(entregadoEn, fechaServicio) {
  const ahora = new Date().toISOString();
  if (typeof entregadoEn !== 'string') return { hora: ahora, estimada: true, motivo: 'sin_hora' };
  const t = Date.parse(entregadoEn);
  if (Number.isNaN(t)) return { hora: ahora, estimada: true, motivo: 'hora_invalida' };
  // Día civil de la fecha de servicio, en la zona del comedor.
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(t));
  if (dia !== fechaServicio) {
    return { hora: ahora, estimada: true, motivo: 'fuera_del_dia', declarada: entregadoEn };
  }
  return { hora: entregadoEn, estimada: false };
}

// Por encima de esta precisión el fix no viene de satélites sino de antenas o
// wifi, y una coordenada de kilómetros no distingue el andén de la carretera:
// como evidencia no sirve, y presentarla es peor que no tener nada.
const PRECISION_MAXIMA_M = 100;

// El listón para fijar el PUNTO es más alto que para una entrega: se mide una
// vez y contra él se calcula la distancia de todas las entregas del contrato.
// Un punto capturado con 300 m de error desplaza para siempre cada medición.
// Además es lo que impide capturarlo desde una PC, donde la ubicación sale del
// wifi o de la IP y da cientos de metros o de plano otra ciudad.
const PRECISION_PUNTO_MAXIMA_M = 25;

// A quién se le entregó la comida. 'supervisor' cubre lo que el empleado no
// recogió: el proveedor ya la cocinó y la llevó, y devolverla es merma suya,
// así que se deja en el sitio y queda constancia de quién la recibió.
const ENTREGADO_A_VALIDOS = ['empleado', 'supervisor'];
const METODOS_ENTREGA_VALIDOS = ['camara', 'lector', 'manual'];

// ── Login del repartidor ──────────────────────────────────────
// Va ANTES del middleware de autorización: es la puerta, no puede exigir estar
// adentro. La clave la asigna el administrador; el repartidor no crea la suya.
entregaRouter.post('/login', async (req, res) => {
  try {
    const clave = req.body?.clave;
    const origen = req.ip || req.headers['x-forwarded-for'] || 'sin_origen';

    const { bloqueado } = registrarIntento(origen);
    if (bloqueado) {
      // 429 y no 401: hay que distinguir "te equivocaste" de "ya no te
      // escucho", si no el repartidor vuelve a teclear pensando que falló.
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    }
    if (typeof clave !== 'string' || !clave.trim()) {
      return res.status(400).json({ error: 'Se requiere la clave' });
    }

    // Se comparan TODAS las claves activas en vez de buscar por usuario: el
    // repartidor solo teclea su clave, no un nombre de usuario. Son pocos
    // registros y scrypt es lento a propósito, así que el recorrido no importa.
    const candidatos = await db.repartidoresParaLogin();
    let encontrado = null;
    for (const r of candidatos) {
      if (await verificarClave(clave.trim(), r.clave_hash)) { encontrado = r; break; }
    }

    if (!encontrado) {
      // Mensaje único a propósito: decir "ese usuario no existe" contra "clave
      // incorrecta" le regala a quien prueba la mitad del trabajo.
      return res.status(401).json({ error: 'Clave incorrecta' });
    }

    limpiarIntentos(origen);
    const token = emitirToken(encontrado);
    res.json({
      token,
      expires_at: new Date(Date.now() + DURACION_SESION_HORAS * 3600 * 1000).toISOString(),
      repartidor: { id: encontrado.id, nombre: encontrado.nombre, zonas: encontrado.zonas || [] }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Autorización ──────────────────────────────────────────────
// Tres formas de entrar, en orden de preferencia:
//   1. Token de sesión de un repartidor  → identifica a la persona
//   2. ADMIN_KEY                         → administración y diagnóstico
//   3. ENTREGA_KEY compartida            → SOLO con el modo legado encendido
//
// La tercera existe para no dejar tirados los equipos que ya tienen la clave
// vieja guardada. No atribuye la entrega a nadie: queda como "Reparto general",
// que es la verdad — con una clave compartida no se sabe quién fue.
// El try/catch de afuera no es adorno. Express 4 no captura los rechazos de un
// middleware async: lo que se escape de aquí sale como unhandled rejection y
// Node se lleva el proceso entero. Como esto corre ANTES que toda ruta de
// entrega, cualquier tropiezo aquí —un secreto sin configurar, un parpadeo de
// Supabase al consultar el repartidor— tumbaba el servidor con una petición
// sin credenciales. Ahora sale como 500 y la app sigue de pie.
entregaRouter.use(async (req, res, next) => {
 try {
  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY no configurada en el servidor' });
  }

  const cabecera = req.headers['authorization'] || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;

  if (token) {
    // Se revisa aquí y no arriba a propósito: sin secreto no se pueden validar
    // tokens, pero la clave compartida sí sigue sirviendo. Así una variable que
    // falte frena el modo nuevo sin dejar tirados a los equipos que están
    // migrando.
    if (!process.env.ENTREGA_SESSION_SECRET) {
      console.error('[Entrega] Llegó un token pero ENTREGA_SESSION_SECRET no está configurada');
      return res.status(500).json({ error: 'Sesiones no configuradas en el servidor' });
    }
    const datos = leerToken(token);
    if (!datos) return res.status(401).json({ error: 'Sesión inválida', motivo: 'token_invalido' });
    if (datos.vencido) return res.status(401).json({ error: 'Sesión vencida', motivo: 'token_vencido' });

    const r = await db.getRepartidor(datos.id);
    if (!r || !r.activo) {
      return res.status(401).json({ error: 'Sesión inválida', motivo: 'repartidor_inactivo' });
    }
    // La versión de sesión es lo que cierra los accesos anteriores cuando se
    // restablece una clave o se desactiva a alguien: el token viejo sigue bien
    // firmado, pero ya no coincide con la versión que hay en la base.
    if ((datos.v || 1) !== (r.version_sesion || 1)) {
      return res.status(401).json({ error: 'Sesión cerrada por el administrador', motivo: 'sesion_invalidada' });
    }
    req.repartidor = { id: r.id, nombre: r.nombre, zonas: r.zonas || [] };
    return next();
  }

  const clave = req.headers['x-admin-key'];
  if (rolPanel(clave)) {
    req.esAdmin = true;
    return next();
  }
  if (process.env.ENTREGA_LEGACY_ENABLED === 'on' &&
      process.env.ENTREGA_KEY && clave === process.env.ENTREGA_KEY) {
    req.repartidor = null;         // sin identidad: no se le atribuye a nadie
    req.esLegado = true;
    return next();
  }

  return res.status(401).json({ error: 'No autorizado' });
 } catch (err) {
  console.error('[Entrega] Error autenticando:', err);
  return res.status(500).json({ error: 'No se pudo verificar la sesión. Intenta de nuevo.' });
 }
});

// Zonas que la sesión tiene permitidas. Un administrador y el modo legado no
// están limitados; un repartidor sí, y el servidor lo comprueba aunque el
// frontend ya lo haya filtrado: lo que manda el navegador no es de fiar.
function zonasPermitidas(req) {
  if (req.esAdmin || req.esLegado) return null;      // null = sin restricción
  return Array.isArray(req.repartidor?.zonas) ? req.repartidor.zonas : [];
}

function puedeConZona(req, zona) {
  const permitidas = zonasPermitidas(req);
  if (permitidas === null) return true;
  if (!zona) return true;            // sin zona declarada no hay qué restringir
  return permitidas.includes(zona);
}

// La página de reparto descarga esto al salir y luego trabaja sin señal.
// Con ?zona= devuelve solo esa ruta, para que dos repartidores trabajen a la
// vez sin verse las listas. Sin zona descarga todas las zonas de la sesión.
entregaRouter.get('/:fecha', async (req, res) => {
  try {
    const zona = req.query.zona || null;
    const turno = req.query.turno || null;
    if (turno && !turnoValido(turno)) return res.status(400).json({ error: 'Turno inválido' });
    if (zona && !ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }
    if (!puedeConZona(req, zona)) {
      return res.status(403).json({ error: 'No tienes autorizada esa zona', zonas: zonasPermitidas(req) });
    }

    const fecha = fechaPedida(req.params.fecha);
    const regulares = await db.getPedidosPorFecha(fecha);
    // El teléfono conserva su última descarga si no se puede cargar todo.
    let coberturas;
    try { coberturas = await db.getCoberturasParaEntrega(fecha); } catch (err) {
      console.error('[Entrega] No se pudieron cargar coberturas:', err.message);
      return res.status(503).json({ error: 'No se pudieron cargar las coberturas. Conserva la última lista y vuelve a descargar antes de continuar la entrega.' });
    }
    const permitidas = zonasPermitidas(req);
    const zonaAutorizada = p => permitidas === null || permitidas.includes(p.zona);
    const regularesAutorizados = regulares.filter(zonaAutorizada);
    const coberturasAutorizadas = coberturas.filter(zonaAutorizada);
    const regularesZona = regularesAutorizados.filter(p => !p.no_surtido_en && (!zona || p.zona === zona) && (!turno || p.turno === turno));
    const coberturasZona = coberturasAutorizadas.filter(p => !p.no_surtido_en && (!zona || p.zona === zona) && (!turno || p.turno === turno));

    const pedidos = [
      ...regularesZona.map(p => ({
        tipo: 'regular',
        codigo_entrega: p.empleados?.numero_empleado || null,
        numero_empleado: p.empleados?.numero_empleado || null,
        nombre: p.empleados?.nombre || null,
        platillo: p.opcion_texto,
        zona: p.zona,
        turno: p.turno,
        entregado_en: p.entregado_en || null,
        metodo_entrega: p.metodo_entrega ?? null,
        motivo_tardia: p.motivo_tardia || null,
        entregado_a: p.entregado_a || null,
        recibido_por: p.recibido_por || null
      })),
      ...coberturasZona.map(item => ({
        tipo: 'cobertura',
        codigo_entrega: String(item.codigo_entrega),
        numero_empleado: item.empleado_numero_snapshot,
        nombre: item.empleado_nombre_snapshot,
        platillo: item.opcion_texto,
        zona: item.zona,
        turno: item.turno || 'turno_b',
        origen: item.origen || 'supervisor',
        entrega_programada_en: item.entrega_programada_en || null,
        entregado_en: item.entregado_en || null,
        metodo_entrega: item.metodo_entrega ?? null,
        motivo_tardia: item.motivo_tardia || null,
        entregado_a: 'responsable',
        recibido_por: item.receptor_nombre || item.responsable_nombre,
        folio: item.folio,
        responsable_numero: item.responsable_numero,
        responsable_nombre: item.responsable_nombre,
        receptor_discrepante: item.receptor_discrepante || false,
        receptor_verificado: item.receptor_verificado
      }))
    ];

    // Llegadas ya registradas y punto de referencia del contrato. La app los
    // necesita para no volver a pedir una llegada que ya existe y para avisar
    // "estás a 3 km del punto" antes de que alguien la registre por error.
    // Si la tabla todavía no existe en la base, no se tumba el reparto: se
    // devuelven vacíos y la app opera como antes.
    let llegadas = [], puntos = [];
    try { llegadas = await db.getLlegadasPorFecha(fecha, zona); } catch {}
    try { puntos = await db.getPuntosEntrega(); } catch {}

    // Índice de las zonas autorizadas del día, no solo la activa: permite
    // que el equipo distinga "este número no existe" de "este pedido es de la
    // otra ruta" estando sin señal. Solo número y zona — ningún dato personal.
    const indice_zonas = {};
    for (const p of regularesAutorizados) {
      const n = p.empleados?.numero_empleado;
      if (n) indice_zonas[n] = p.zona || null;
    }
    for (const item of coberturasAutorizadas) {
      indice_zonas['EX|' + item.codigo_entrega] = item.zona || null;
    }

    res.json({
      fecha,
      server_time: DateTime.now().setZone(ZONA).toISO(),
      zona,
      turno,
      total: pedidos.length,
      entregados: pedidos.filter(p => p.entregado_en).length,
      indice_zonas,
      llegadas: llegadas.filter(p => zonaAutorizada(p) && (!zona || p.zona === zona) && (!turno || p.turno === turno)),
      puntos: puntos.filter(p => zonaAutorizada(p) && (!zona || p.zona === zona)),
      // La app las necesita para decidir si una entrega salió tardía y pedir
      // el motivo estando SIN SEÑAL, sin volver a preguntarle al servidor.
      turno_hora: horarioZona(zona, fecha),
      tolerancia_min: TOLERANCIA_TARDIA_MIN,
      motivos_tardia: MOTIVOS_TARDIA,
      pedidos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Llegada al punto de entrega. Es el evento que decide la puntualidad, no el
// escaneo: repartir 30 box lunch toma diez minutos o más, así que medir comida
// por comida haría que la última siempre saliera tarde aunque el vehículo
// llegara a tiempo. El contrato penaliza el bloque, no la unidad.
//
// Viaja en la misma cola que los escaneos y por eso acepta su propia hora: la
// llegada ocurre en el puerto sin señal y sube después.
entregaRouter.post('/llegada', async (req, res) => {
  try {
    const { fecha, zona, turno, punto, llegada_en, lat, lon, precision_m } = req.body || {};
    if (req.repartidor && req.body?.repartidor_id != null && Number(req.body.repartidor_id) !== Number(req.repartidor.id)) {
      return res.status(403).json({ error: 'Esta llegada pertenece a otro repartidor', motivo: 'otro_repartidor' });
    }
    if (!fecha || !zona || !turno) {
      return res.status(400).json({ error: 'Se requieren fecha, zona y turno' });
    }
    if (!ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }
    if (!TURNOS_VALIDOS.includes(turno)) {
      return res.status(400).json({ error: 'Turno inválido', turnos_validos: TURNOS_VALIDOS });
    }
    if (!puedeConZona(req, zona)) {
      return res.status(403).json({ error: 'No tienes autorizada esa zona', zonas: zonasPermitidas(req) });
    }

    const util = precision_m == null || precision_m <= PRECISION_MAXIMA_M;
    const r = await db.registrarLlegada({
      fecha, zona, turno, punto: punto || '',
      llegada_en: llegada_en || new Date().toISOString(),
      lat: util ? lat : null,
      lon: util ? lon : null,
      precision_m
    });
    res.json({ ...r, precision_descartada: !util });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fijar el punto de entrega del contrato. Se captura desde la tablet parada en
// el andén, que es el único equipo que puede hacerlo bien: el panel corre en
// una PC y ahí la ubicación sale del wifi o de la IP, con cientos de metros de
// error.
//
// Exige ADMIN_KEY y NO acepta la ENTREGA_KEY, a diferencia del resto de este
// router: este punto es la referencia contra la que se mide cada entrega, y si
// el repartidor pudiera moverlo bastaría con fijarlo donde uno esté parado para
// que todo saliera "a 0 m del punto". La evidencia dejaría de valer.
entregaRouter.post('/punto', async (req, res) => {
  if (!rolPanel(req.headers['x-admin-key'])) {
    return res.status(403).json({ error: 'Solo la clave de administrador puede fijar el punto de entrega' });
  }
  try {
    const { zona, punto, nombre, direccion, lat, lon, radio_m, precision_m } = req.body || {};
    if (!ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'Se requieren lat y lon numéricas' });
    }
    // Un punto de referencia capturado con mala precisión contamina TODAS las
    // distancias que se calculen después. Aquí el listón es más alto que para
    // una entrega: se mide una vez y se usa durante todo el contrato.
    if (precision_m != null && precision_m > PRECISION_PUNTO_MAXIMA_M) {
      return res.status(400).json({
        error: 'Precisión insuficiente para fijar el punto',
        precision_m, maxima: PRECISION_PUNTO_MAXIMA_M
      });
    }
    const guardado = await db.guardarPuntoEntrega({ zona, punto, nombre, direccion, lat, lon, radio_m });
    res.json({ ok: true, punto: guardado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincronización por lotes: el reparto ocurre sin señal, así que llegan
// varias entregas juntas cuando el vehículo recupera cobertura. Cada una
// se responde por separado para que la app sepa cuáles reintentar.
entregaRouter.post('/', async (req, res) => {
  try {
    const { fecha, zona, entregas } = req.body || {};
    if (!fecha || !Array.isArray(entregas)) {
      return res.status(400).json({ error: 'Se requieren fecha y entregas[]' });
    }

    // No se puede entregar comida que todavía no existe. Sin esto, la app —que
    // pedía la fecha de PEDIDO en vez de la de reparto— dejaba marcar como
    // entregados los pedidos de mañana, y una hora de entrega que se puede
    // sellar por anticipado no prueba nada ante el cliente.
    //
    // El corte va contra la fecha del servidor, no la del aparato: un teléfono
    // con el reloj adelantado no debe poder abrir el día siguiente.
    //
    // Se rechaza el lote entero y de forma DEFINITIVA (no es un error pasajero),
    // para que la cola del teléfono lo suelte en vez de reintentarlo por
    // siempre. Fechas pasadas sí pasan: son las colas que se sincronizan tarde.
    if (fecha > hoy()) {
      return res.status(400).json({
        error: 'No se puede registrar una entrega de una fecha futura',
        motivo: 'fecha_futura', fecha, hoy: hoy(), definitivo: true
      });
    }
    // La zona del lote es opcional si cada elemento trae su propio grupo.
    // Los registros antiguos sin grupo solo se reconocen si ya estaban
    // entregados; los pendientes requieren revisión antes de escribir.
    if (zona && !ZONAS_VALIDAS.includes(zona)) {
      return res.status(400).json({ error: 'Zona inválida', zonas_validas: ZONAS_VALIDAS });
    }

    if (!puedeConZona(req, zona)) {
      return res.status(403).json({ error: 'No tienes autorizada esa zona', zonas: zonasPermitidas(req) });
    }

    const resultados = [];
    let registrosLegados = null;
    for (const e of entregas) {
      const numero = e?.numero_empleado;
      const tipo = e?.tipo === 'cobertura' ? 'cobertura' : 'regular';
      const codigoEntrega = tipo === 'cobertura' ? String(e?.codigo_entrega || '') : String(numero || '');
      if (!codigoEntrega || !numero) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega || null, numero_empleado: numero || null, ok: false, motivo: 'sin_numero' });
        continue;
      }
      const turnoItem = e.turno;
      const zonaDeclarada = e.zona || zona;

      // También se comprueba antes de reconocer una cola antigua confirmada.
      if (req.repartidor && e.repartidor_id != null && Number(e.repartidor_id) !== Number(req.repartidor.id)) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false, motivo: 'otro_repartidor' });
        continue;
      }
      if (zonaDeclarada && !puedeConZona(req, zonaDeclarada)) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false, motivo: 'zona_no_autorizada' });
        continue;
      }
      if (req.body.turno && turnoItem && req.body.turno !== turnoItem) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false, motivo: 'turno_incorrecto' });
        continue;
      }
      if (zona && zona !== zonaDeclarada) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false, motivo: 'zona_incorrecta', zona_esperada: zona });
        continue;
      }
      const metodoValido = METODOS_ENTREGA_VALIDOS.includes(e.metodo_entrega);
      if (e.metodo_entrega != null && !metodoValido) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false,
          motivo: 'metodo_entrega_invalido', error: 'El método debe ser camara, lector o manual. Conserva este registro para revisión.' });
        continue;
      }
      const grupoIncompleto = !turnoValido(turnoItem) || !ZONAS_VALIDAS.includes(zonaDeclarada);
      const requiereRevision = e.accion === 'cierre_ruta' || req.body.accion === 'cierre_ruta' ||
        e.origen === 'lista' || req.body.origen === 'lista' ||
        (e.entregado_a === 'supervisor' && (e.accion !== 'entrega' || !metodoValido));
      if (grupoIncompleto || requiereRevision) {
        // Un reintento antiguo ya confirmado puede liberarse sin volver a escribir.
        // Los registros antiguos aún pendientes conservan la cola para revisión.
        if (!registrosLegados) {
          const [regulares, coberturas] = await Promise.all([db.getPedidosPorFecha(fecha), db.getCoberturasParaEntrega(fecha)]);
          registrosLegados = { regulares, coberturas };
        }
        const anterior = tipo === 'cobertura'
          ? registrosLegados.coberturas.find(p => String(p.codigo_entrega) === codigoEntrega)
          : registrosLegados.regulares.find(p => String(p.empleados?.numero_empleado) === String(numero));
        const zonaAnteriorAutorizada = anterior && puedeConZona(req, anterior.zona) &&
          (zonasPermitidas(req) === null || zonasPermitidas(req).includes(anterior.zona));
        const grupoCoincide = (!zonaDeclarada || anterior?.zona === zonaDeclarada) &&
          (!turnoItem || anterior?.turno === turnoItem) && (!req.body.turno || anterior?.turno === req.body.turno);
        if (zonaAnteriorAutorizada && grupoCoincide && anterior.no_surtido_en) {
          resultados.push({ tipo, codigo_entrega:codigoEntrega, numero_empleado:numero, ok:false, motivo:'no_surtido' });
          continue;
        }
        if (zonaAnteriorAutorizada && grupoCoincide && anterior.entregado_en) {
          resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: true, ya_entregado: true,
            entregado_en: anterior.entregado_en, metodo_entrega: anterior.metodo_entrega ?? null });
          continue;
        }
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false,
          motivo: requiereRevision ? 'entrega_requiere_revision' : 'grupo_requerido',
          error: requiereRevision
            ? 'La entrega desde lista o cierre de ruta no se registra. Este registro se conserva para revisión.'
            : 'Actualiza la app y selecciona zona y turno. Este registro se conserva para revisión.' });
        continue;
      }
      // Un motivo inventado no se guarda: solo los del catálogo
      const motivo = MOTIVOS_TARDIA_VALIDOS.includes(e?.motivo_tardia) ? e.motivo_tardia : null;
      try {
        // El elemento conserva su zona; el lote sirve de respaldo cuando
        // esta no viene. Arriba ya se verificó que ambos grupos coincidan.
        const zonaItem = e?.zona !== undefined ? e.zona : zona;
        // La coordenada solo se guarda si el fix sirve. Por encima de este
        // radio el dato vino de antenas y no de satélites: aparenta prueba y
        // no la es, así que se descarta en vez de contaminar la evidencia.
        const util = e?.precision_m == null || e.precision_m <= PRECISION_MAXIMA_M;
        const reloj = horaEntregaConfiable(e?.entregado_en, fecha);
        if (reloj.estimada) {
          console.warn('[Entrega] Hora del equipo descartada (' + reloj.motivo + ') para',
                       numero, 'del', fecha, '— declarada:', reloj.declarada || '(ninguna)');
        }
        const datosComunes = {
          turno_esperado: turnoItem,
          metodo_entrega: e.metodo_entrega ?? null,
          lat: util ? e?.lat : null,
          lon: util ? e?.lon : null,
          precision_m: e?.precision_m,
          repartidor_id: req.repartidor?.id ?? null,
          repartidor_nombre: req.repartidor?.nombre ?? (req.esLegado ? 'Reparto general' : null)
        };

        let r;
        if (tipo === 'cobertura') {
          let receptorVerificado = null;
          if (e?.receptor_discrepante === true) {
            // El QR del gafete trae número y nombre. Se registra incluso si la
            // plantilla quedó vieja, pero la coincidencia queda explícita para
            // que administración pueda revisarla y no se presente como válida.
            const receptor = await db.getEmpleadoPorNumeroIncluyendoBajas(e?.receptor_numero);
            receptorVerificado = validarReceptorEscaneado(receptor, e?.receptor_numero, e?.receptor_nombre);
          }
          r = await db.marcarCoberturaEntregada(
            fecha, codigoEntrega, reloj.hora, motivo, zonaItem || null,
            {
              ...datosComunes,
              receptor_numero: e?.receptor_numero,
              receptor_nombre: typeof e?.receptor_nombre === 'string' ? e.receptor_nombre.slice(0, 120) : null,
              receptor_discrepante: e?.receptor_discrepante === true,
              receptor_verificado: receptorVerificado
            }
          );
        } else {
          r = await db.marcarEntregado(
            fecha, numero, reloj.hora, motivo, zonaItem || null,
            {
              ...datosComunes,
              entregado_a: ENTREGADO_A_VALIDOS.includes(e?.entregado_a) ? e.entregado_a : 'empleado',
              recibido_por: typeof e?.recibido_por === 'string' ? e.recibido_por.slice(0, 120) : null
            }
          );
        }
        resultados.push({
          tipo,
          codigo_entrega: codigoEntrega,
          numero_empleado: numero,
          ok: r.ok,
          // Viaja para que el equipo pueda decir "este pedido es de la otra
          // ruta" en vez de "no existe", que es lo que veía antes.
          zona_esperada: r.zona_esperada || null,
          // Un reintento sobre algo ya entregado viaja como ok con esta marca:
          // la cola del teléfono se vacía y queda constancia de que la hora
          // guardada es la de la primera confirmación, no la de este reintento.
          ya_entregado: r.ya_entregado || false,
          motivo: r.motivo || null,
          nombre: r.pedido?.empleados?.nombre || r.item?.empleado_nombre_snapshot || null,
          entregado_en: r.pedido?.entregado_en || r.item?.entregado_en || null,
          metodo_entrega: r.pedido?.metodo_entrega ?? r.item?.metodo_entrega ?? null,
          // Avisa que la hora guardada NO es la del escaneo sino la del
          // servidor, porque la del equipo no era creíble. La entrega vale
          // igual; lo que no vale es presentar esa hora como exacta ante el
          // cliente sin decirlo.
          hora_estimada: reloj.estimada || false
        });
      } catch (err) {
        resultados.push({ tipo, codigo_entrega: codigoEntrega, numero_empleado: numero, ok: false,
          motivo: String(err.message).includes('comida_no_surtida') ? 'no_surtido' : 'error_servidor', detalle: err.message });
      }
    }

    res.json({ fecha, zona: zona || null, confirmadas: resultados.filter(r => r.ok).length, resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
