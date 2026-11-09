import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { ZONA } from './menu.js';
import { ahoraCobertura, validarSolicitudEntrada, validarTurnoCobertura, traducirErrorBD } from './cobertura.js';
import { ANTICIPACION_COBERTURA_MIN, ventanaLoteCobertura } from './ventana-cobertura.js';

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
export function idLote(valor) {
  if (!/^[1-9]\d*$/.test(String(valor)) || !Number.isSafeInteger(Number(valor))) throw error('Folio de solicitud inválido.');
  return Number(valor);
}

export function validarEntradaLote(entrada) {
  const ahora = ahoraCobertura();
  if (entrada.fecha !== ahora.toISODate()) throw error('Los pedidos de cobertura solo pueden registrarse para hoy.');
  if (!entrada.turno) throw error('Selecciona Turno A o Turno B.');
  const turno = validarTurnoCobertura(entrada.turno);
  const valida = validarSolicitudEntrada(entrada);
  if (valida.error) throw error(valida.error);
  if (typeof entrada.hora_entrega !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entrada.hora_entrega)) throw error('Escribe la hora de entrega en formato de 24 horas, por ejemplo 17:30.');
  if (typeof entrada.idempotencia !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entrada.idempotencia)) throw error('Actualiza tus pedidos y vuelve a intentarlo.');
  if (entrada.version != null && (typeof entrada.version !== 'string' || !DateTime.fromISO(entrada.version).isValid)) throw error('Actualiza el folio antes de modificarlo.');
  return { fecha: entrada.fecha, turno, zona: entrada.zona, responsable_numero: String(entrada.responsable_numero).trim(),
    items: valida.items, idempotencia: entrada.idempotencia, version: entrada.version || null,
    entrega_programada_en: DateTime.fromISO(entrada.fecha + 'T' + entrada.hora_entrega, { zone: ZONA }).toISO() };
}

function traducir(err) {
  if (['PGRST202', '42883'].includes(err.code)) return error('La actualización de coberturas aún no está disponible. Avisa a administración.', 503);
  const casos = [
    ['anticipacion_cobertura_insuficiente', 'Se requieren al menos dos horas antes de la entrega. Para cambiar un folio, debe haber margen tanto en su horario actual como en el nuevo.'],
    ['solicitud_cobertura_no_encontrada', 'No se encontró ese folio entre tus pedidos.'],
    ['version_cobertura_desactualizada', 'Este folio cambió en otra sesión. Actualiza tus pedidos antes de editarlo.'],
    ['idempotencia_cobertura_invalida', 'Este intento ya se registró con otros datos. Actualiza tus pedidos antes de crear otro.']
  ];
  const caso = casos.find(([clave]) => String(err.message).includes(clave));
  return caso ? error(caso[1], caso[0] === 'solicitud_cobertura_no_encontrada' ? 404 : 409) : traducirErrorBD(err);
}

export async function estadoLotesSupervisor(supervisorId) {
  const ahora = ahoraCobertura(), fecha = ahora.toISODate();
  const [menu, solicitudes] = await Promise.all([db.getMenuCobertura(fecha), db.listLotesSupervisor(supervisorId, fecha)]);
  const minima = ahora.plus({ minutes: ANTICIPACION_COBERTURA_MIN });
  const redondeada = minima.startOf('minute').plus({ minutes: minima.second || minima.millisecond ? 1 : 0 });
  return { fecha, ahora: ahora.toISO(), anticipacion_minutos: ANTICIPACION_COBERTURA_MIN,
    abierto: menu?.activo === true && redondeada.toISODate() === fecha,
    motivo: !menu?.activo ? 'sin_menu_especial' : redondeada.toISODate() !== fecha ? 'sin_ventana_hoy' : null,
    hora_minima: redondeada.toISODate() === fecha ? redondeada.toFormat('HH:mm') : null,
    menu: menu?.activo ? { opciones: [1, 2, 3].map(i => ({ id: 'especial_' + i, texto: menu['opcion_' + i] })) } : null,
    solicitudes: solicitudes.map(s => ({ ...s, ...ventanaLoteCobertura(s, ahora) })) };
}

export async function guardarLoteSupervisor(supervisorId, entrada, solicitudId = null) {
  const datos = validarEntradaLote(entrada);
  try {
    return await db.guardarLoteSupervisor({ ...datos, supervisor_id: supervisorId,
      solicitud_id: solicitudId == null ? null : idLote(solicitudId),
      folio: 'CE-' + datos.fecha.replaceAll('-', '') + '-' + crypto.randomBytes(4).toString('hex').toUpperCase() });
  } catch (err) { throw traducir(err); }
}

export async function cancelarLoteSupervisor(supervisorId, solicitudId, version) {
  if (version != null && (typeof version !== 'string' || !DateTime.fromISO(version).isValid)) throw error('Actualiza el folio antes de cancelarlo.');
  try { return await db.cancelarLoteSupervisor(supervisorId, idLote(solicitudId), version || null); }
  catch (err) { throw traducir(err); }
}
