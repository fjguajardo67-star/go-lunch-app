import { DateTime } from 'luxon';
import { ZONA, horaEntrega } from './menu.js';

export const ANTICIPACION_COBERTURA_MIN = 120;

export function ventanaLoteCobertura(solicitud, ahora = DateTime.now().setZone(ZONA)) {
  const texto = solicitud.entrega_programada_en || (horaEntrega(solicitud.turno, solicitud.zona, solicitud.fecha_servicio)
    ? solicitud.fecha_servicio + 'T' + horaEntrega(solicitud.turno, solicitud.zona, solicitud.fecha_servicio) : '');
  const entrega = DateTime.fromISO(texto, { zone: ZONA });
  const limite = entrega.minus({ minutes: ANTICIPACION_COBERTURA_MIN });
  const iniciada = solicitud.estado === 'entregada' || (solicitud.items || []).some(i => i.entregado_en || i.no_surtido_en);
  return {
    entrega_programada_en: entrega.isValid ? entrega.toISO() : null,
    limite_cambios_en: limite.isValid ? limite.toISO() : null,
    editable: solicitud.origen !== 'extraordinaria' && solicitud.estado === 'confirmada' && !iniciada &&
      solicitud.fecha_servicio === ahora.setZone(ZONA).toISODate() && limite.isValid && ahora <= limite
  };
}
