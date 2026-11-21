import { DateTime } from 'luxon';

const fallo = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
export function validarFechaEntregasAdmin(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      !DateTime.fromISO(fecha, { zone: 'America/Mexico_City' }).isValid) {
    throw fallo('Selecciona una fecha de servicio válida.');
  }
  return fecha;
}

export function validarEntregasAdmin(entrada) {
  const fecha = validarFechaEntregasAdmin(entrada?.fecha);
  const motivo = typeof entrada?.motivo === 'string' ? entrada.motivo.trim() : '';
  if (motivo.length < 10 || motivo.length > 500 || /[\x00-\x1f\x7f]/.test(motivo)) {
    throw fallo('Escribe un motivo de entre 10 y 500 caracteres, en una sola línea.');
  }
  if (entrada.confirmado !== true) throw fallo('Confirma explícitamente que las comidas se entregaron físicamente.');
  if (typeof entrada.idempotencia !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entrada.idempotencia)) {
    throw fallo('La confirmación necesita un identificador de operación válido.');
  }
  if (!Array.isArray(entrada.items) || !entrada.items.length || entrada.items.length > 1000) {
    throw fallo('Selecciona entre 1 y 1000 comidas.');
  }
  const vistos = new Set();
  const items = entrada.items.map(item => {
    if (!['regular', 'cobertura'].includes(item?.tipo) ||
        !/^[1-9]\d*$/.test(String(item.id)) || !Number.isSafeInteger(Number(item.id))) {
      throw fallo('Selecciona comidas válidas.');
    }
    if (typeof item.version !== 'string' || !/^[0-9a-f]{64}$/.test(item.version)) {
      throw fallo('Actualiza la vista previa antes de confirmar.', 409);
    }
    const clave = `${item.tipo}:${item.id}`;
    if (vistos.has(clave)) throw fallo('Una comida aparece más de una vez.');
    vistos.add(clave);
    return { tipo: item.tipo, id: Number(item.id), version: item.version };
  });
  return { fecha, items, motivo, confirmado: true, idempotencia: entrada.idempotencia.toLowerCase() };
}

export function errorEntregasAdmin(err) {
  const mensajes = {
    servicio_futuro: [409, 'Solo puedes confirmar comidas cuya fecha y horario de servicio ya pasaron.'],
    horario_invalido: [409, 'Una comida no tiene un horario de servicio válido. Actualiza la vista previa.'],
    version_entrega_actualizada: [409, 'Cambió una comida seleccionada. Actualiza la vista previa y revisa la selección.'],
    comida_no_encontrada: [409, 'Una comida seleccionada ya no está disponible. Actualiza la vista previa.'],
    comida_no_pendiente: [409, 'Una comida ya tiene entrega o incidencia. Actualiza la vista previa.'],
    solicitud_cancelada: [409, 'Un folio seleccionado está cancelado. Actualiza la vista previa.'],
    fecha_servicio_actualizada: [409, 'Una comida corresponde a otra fecha. Actualiza la vista previa.'],
    idempotencia_entrega_invalida: [409, 'El identificador de operación ya se usó con otra selección o motivo. Actualiza la vista previa.'],
    entrada_entregas_invalida: [400, 'Revisa la selección, el motivo y la confirmación de entrega física.']
  };
  const caso = Object.keys(mensajes).find(k => String(err?.message).includes(k));
  if (caso) return { status: mensajes[caso][0], mensaje: mensajes[caso][1] };
  if (['PGRST202', '42P01', '42703', '42883'].includes(err?.code)) {
    return { status: 503, mensaje: 'La confirmación administrativa aún no está habilitada en la base de datos.' };
  }
  if (['55P03', '40P01', '40001'].includes(err?.code)) {
    return { status: 409, mensaje: 'Otra operación está actualizando estas comidas. Reintenta con la misma solicitud.' };
  }
  return { status: err?.status || 500, mensaje: err?.status ? err.message : 'No se pudo confirmar el lote. Conserva la solicitud para reintentar.' };
}
