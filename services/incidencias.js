import { DateTime } from 'luxon';

export const noSurtida = p => !!p.no_surtido_en;
export const entregada = p => !!p.entregado_en && !noSurtida(p);

export function validarIncidencia(tipo, id, datos) {
  if (!['regular', 'cobertura'].includes(tipo) || !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) {
    throw Object.assign(new Error('Selecciona una comida válida.'), { status: 400 });
  }
  if (typeof datos?.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) || !DateTime.fromISO(datos.fecha).isValid) {
    throw Object.assign(new Error('Consulta una fecha de servicio válida antes de autorizar.'), { status: 400 });
  }
  const motivo = typeof datos?.motivo === 'string' ? datos.motivo.trim() : '';
  if (motivo.length < 5 || motivo.length > 500 || /[\x00-\x1f\x7f]/.test(motivo)) {
    throw Object.assign(new Error('Escribe un motivo de entre 5 y 500 caracteres, en una sola línea.'), { status: 400 });
  }
  if (!Object.hasOwn(datos, 'entregado_esperado') || (datos.entregado_esperado !== null &&
      (typeof datos.entregado_esperado !== 'string' || !DateTime.fromISO(datos.entregado_esperado, { setZone: true }).isValid))) {
    throw Object.assign(new Error('Actualiza el dashboard antes de registrar la incidencia.'), { status: 409 });
  }
  return { tipo, id: Number(id), fecha: datos.fecha, motivo, entregado_esperado: datos.entregado_esperado };
}

export function errorIncidencia(err) {
  const mensajes = {
    estado_entrega_actualizado: [409, 'Cambió el estado de entrega. Actualiza el dashboard y revisa el pedido antes de autorizar.'],
    fecha_servicio_actualizada: [409, 'La comida corresponde a otra fecha. Actualiza el dashboard y revisa el servicio antes de autorizar.'],
    comida_no_encontrada: [404, 'La comida ya no está disponible. Actualiza el dashboard.'],
    solicitud_cancelada: [409, 'El folio está cancelado. Actualiza el dashboard.'],
    servicio_futuro: [409, 'La incidencia solo se registra para servicios de hoy o de fechas anteriores.'],
    motivo_invalido: [400, 'Escribe un motivo válido de entre 5 y 500 caracteres.']
  };
  const clave = Object.keys(mensajes).find(k => String(err.message).includes(k));
  if (clave) return { status: mensajes[clave][0], mensaje: mensajes[clave][1] };
  if (['PGRST202', '42703', '42883'].includes(err.code)) return { status: 503, mensaje: 'Las incidencias aún no están habilitadas en la base de datos. Contacta al administrador.' };
  return { status: err.status || 500, mensaje: err.status ? err.message : 'No se pudo registrar la incidencia. Conserva el motivo y vuelve a intentar.' };
}
