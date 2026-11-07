import { DateTime } from 'luxon';
import { ZONA, horaTexto } from './menu.js';

export function horaTextoCobertura(solicitud, fecha) {
  if (solicitud.entrega_programada_en) {
    return DateTime.fromISO(solicitud.entrega_programada_en).setZone(ZONA).toFormat('h:mm a');
  }
  return horaTexto(solicitud.turno || 'turno_b', solicitud.zona, fecha);
}

export function seleccionarSolicitudesCobertura(solicitudes, { solicitud, origen } = {}) {
  if (origen !== undefined && origen !== 'supervisor') {
    throw Object.assign(new Error('Origen de impresión inválido.'), { status: 400 });
  }
  let elegidas = solicitudes;
  if (solicitud !== undefined) {
    if (!['string', 'number'].includes(typeof solicitud) || !/^[1-9]\d*$/.test(String(solicitud)) || !Number.isSafeInteger(Number(solicitud))) {
      throw Object.assign(new Error('Solicitud de impresión inválida.'), { status: 400 });
    }
    elegidas = elegidas.filter(s => String(s.id) === String(solicitud));
    if (!elegidas.length) throw Object.assign(new Error('No se encontró ese folio para la fecha y turno elegidos.'), { status: 404 });
  }
  return elegidas.filter(s => s.estado !== 'cancelada' && (origen !== 'supervisor' || s.origen !== 'extraordinaria'));
}
