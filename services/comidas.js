// Una fila por comida. Las coberturas conservan su identidad y horario propios.
import { DateTime } from 'luxon';
import { ZONA, horaTexto, horaEntrega, limiteEntrega, TOLERANCIA_TARDIA_MIN } from './menu.js';

export function validarPeriodo(ini, fin = ini) {
  const valida = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) &&
    DateTime.fromISO(f, { zone: ZONA }).isValid;
  if (!valida(ini) || !valida(fin) || ini > fin) {
    throw Object.assign(new Error('Selecciona un periodo válido: fecha inicial y final en formato YYYY-MM-DD.'), { status: 400 });
  }
}

export function unirComidas(pedidos, coberturas) {
  return [
    ...pedidos.map(p => ({ ...p, tipo: 'regular', origen: 'regular', folio: null,
      entrega_programada_en: null, rating_elegible: true,
      clave_servicio: `regular:${p.id}`, codigo_etiqueta: `${p.empleados?.numero_empleado || ''}|${p.fecha_menu}` })),
    ...coberturas.filter(s => s.estado !== 'cancelada').flatMap(s => (s.items || []).map(i => ({
      ...i, tipo: 'cobertura', origen: s.origen || 'supervisor', folio: s.folio,
      clave_servicio: `cobertura:${i.id}`, fecha_menu: s.fecha_servicio,
      turno: s.turno, zona: s.zona, entrega_programada_en: s.entrega_programada_en || null,
      responsable_nombre: s.responsable_nombre_snapshot, responsable_numero: s.responsable_numero_snapshot,
      empleados: { nombre: i.empleado_nombre_snapshot, numero_empleado: i.empleado_numero_snapshot,
        telefono: i.empleado_telefono },
      rating: null, rating_elegible: false, codigo_etiqueta: `EX|${i.codigo_entrega}|${s.fecha_servicio}`
    })))
  ];
}

export function contarServicios(comidas) {
  const coberturas = comidas.filter(p => p.tipo === 'cobertura').length;
  return { regulares: comidas.length - coberturas, coberturas, total: comidas.length };
}

export function horaComida(p, fecha = p.fecha_menu) {
  if (p.entrega_programada_en) {
    const h = DateTime.fromISO(p.entrega_programada_en, { zone: ZONA });
    return h.isValid ? h.setZone(ZONA).toFormat('HH:mm') : 'Por confirmar';
  }
  return horaEntrega(p.turno, p.zona, fecha) || 'Por confirmar';
}

export function horarioComida(p, fecha = p.fecha_menu) {
  return p.entrega_programada_en ? horaComida(p, fecha) : (horaTexto(p.turno, p.zona, fecha) || 'Por confirmar');
}

export function limiteComida(p) {
  if (!p.entrega_programada_en) return limiteEntrega(p.fecha_menu, p.turno, p.zona);
  const d = DateTime.fromISO(p.entrega_programada_en, { zone: ZONA });
  return d.isValid ? d.plus({ minutes: TOLERANCIA_TARDIA_MIN }) : null;
}

export function tardiaComida(p) {
  const limite = limiteComida(p), entregada = p.entregado_en && DateTime.fromISO(p.entregado_en, { zone: ZONA });
  return limite && entregada?.isValid ? entregada > limite : null;
}
