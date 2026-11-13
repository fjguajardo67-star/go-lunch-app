import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { ZONA } from './menu.js';
import { ahoraCobertura, validarSolicitudEntrada, validarTurnoCobertura, traducirErrorBD } from './cobertura.js';

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
export function validarExtraordinaria(entrada, rol) {
  if (!['admin', 'gerente'].includes(rol)) throw error('Solo gerente o administrador puede autorizar.', 403);
  const ahora = ahoraCobertura();
  if (entrada.fecha !== ahora.toISODate()) throw error('Los pedidos extraordinarios solo pueden registrarse para hoy.');
  if (!entrada.turno) throw error('Selecciona el turno de servicio.');
  const turno = validarTurnoCobertura(entrada.turno);
  const valida = validarSolicitudEntrada(entrada);
  if (valida.error) throw error(valida.error);
  const motivo = typeof entrada.motivo === 'string' ? entrada.motivo.trim() : '';
  if (motivo.length < 5 || motivo.length > 500) throw error('Indica un motivo de entre 5 y 500 caracteres.');
  if (typeof entrada.hora_entrega !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entrada.hora_entrega)) {
    throw error('Indica la hora de entrega autorizada.');
  }
  if (typeof entrada.idempotencia !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entrada.idempotencia)) {
    throw error('Actualiza el formulario e intenta de nuevo.');
  }
  return {
    fecha: ahora.toISODate(), turno, zona: entrada.zona,
    responsable_numero: String(entrada.responsable_numero).trim(), items: valida.items,
    motivo, autorizado_por: rol, idempotencia: entrada.idempotencia,
    menu_version: typeof entrada.menu_version === 'string' && DateTime.fromISO(entrada.menu_version).isValid ? entrada.menu_version : null,
    entrega_programada_en: DateTime.fromISO(entrada.fecha + 'T' + entrada.hora_entrega, { zone: ZONA }).toISO()
  };
}

export async function estadoExtraordinaria() {
  const ahora = ahoraCobertura();
  const menu = await db.getMenuCobertura(ahora.toISODate());
  return { fecha: ahora.toISODate(), ahora: ahora.toISO(), menu_version:menu?.activo ? menu.actualizado_en : null, opciones: menu?.activo
    ? [1, 2, 3].map(i => ({ id: 'especial_' + i, texto: menu['opcion_' + i] })) : [] };
}

export async function autorizarExtraordinaria(entrada, rol) {
  const datos = validarExtraordinaria(entrada, rol);
  try {
    return await db.guardarExtraordinariaCobertura({ ...datos,
      folio: 'CE-X-' + datos.fecha.replaceAll('-', '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase() });
  } catch (err) {
    if (['PGRST202', '42883'].includes(err.code)) {
      throw error('La autorización extraordinaria aún no está activada. Avisa a administración.', 503);
    }
    const casos = [
      ['entrega_extraordinaria_invalida', 409, 'La hora autorizada debe ser posterior a la hora actual y corresponder a hoy.'],
      ['autorizacion_extraordinaria_invalida', 403, 'Se necesita autorización de gerente o administrador.'],
      ['motivo_extraordinario_invalido', 400, 'Indica un motivo de entre 5 y 500 caracteres.'],
      ['idempotencia_extraordinaria_invalida', 409, 'Este intento ya se usó con otros datos. Actualiza el formulario.']
    ];
    const caso = casos.find(([marca]) => String(err.message).includes(marca));
    if (caso) throw error(caso[2], caso[1]);
    throw traducirErrorBD(err);
  }
}
