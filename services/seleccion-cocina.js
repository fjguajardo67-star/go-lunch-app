// Selección compartida para etiquetas y comanda: filtrar antes de contar.
import { TURNOS, ZONAS } from './menu.js';
import { contarServicios, horaComida } from './comidas.js';

export function normalizarSeleccionCocina({ turno, zona, servicio } = {}) {
  const valido = (valor, opciones, todos, nombre) => {
    if (valor === undefined || valor === null || valor === '' || valor === todos) return null;
    if (typeof valor === 'string' && Object.hasOwn(opciones, valor)) return valor;
    const error = new Error(`Filtro de ${nombre} inválido.`);
    error.status = 400;
    throw error;
  };
  return {
    turno: valido(turno, TURNOS, 'todos', 'turno'),
    zona: valido(zona, ZONAS, 'todas', 'zona'),
    servicio: valido(servicio, { regular: 'Regulares', cobertura: 'Coberturas' }, 'todos', 'servicio')
  };
}

export function seleccionarPedidosCocina(pedidos, seleccion = {}) {
  const { turno, zona, servicio } = normalizarSeleccionCocina(seleccion);
  return pedidos.filter(p => (!turno || p.turno === turno) && (!zona || p.zona === zona) &&
    (!servicio || (p.tipo || 'regular') === servicio));
}

export function textoSeleccionCocina(seleccion = {}) {
  const { turno, zona, servicio } = normalizarSeleccionCocina(seleccion);
  return `${turno === 'turno_a' ? 'Turno A' : turno === 'turno_b' ? 'Turno B' : 'Todos los turnos'} · ${zona ? ZONAS[zona] : 'Todas las zonas'} · ${servicio === 'regular' ? 'Regulares' : servicio === 'cobertura' ? 'Coberturas' : 'Regulares y coberturas'}`;
}

export function resumirPedidosCocina(fecha, pedidos, seleccion = {}) {
  const filtros = normalizarSeleccionCocina(seleccion);
  const elegidos = seleccionarPedidosCocina(pedidos, filtros);
  const total = elegidos.length;
  const grupos = new Map();
  for (const p of elegidos) {
    const platillo = p.opcion_texto || p.opcion_id;
    if (!grupos.has(platillo)) grupos.set(platillo, { porciones: 0, regulares: 0, coberturas: 0, por_turno: {}, por_zona: {} });
    const grupo = grupos.get(platillo);
    const turno = TURNOS[p.turno] || p.turno || 'Sin turno';
    const zona = ZONAS[p.zona] || p.zona || 'Sin zona';
    grupo.porciones++;
    grupo[p.tipo === 'cobertura' ? 'coberturas' : 'regulares']++;
    grupo.por_turno[turno] = (grupo.por_turno[turno] || 0) + 1;
    grupo.por_zona[zona] = (grupo.por_zona[zona] || 0) + 1;
  }
  const resumen = [...grupos.entries()].map(([platillo, grupo]) => ({
    platillo, ...grupo, porcentaje: total ? Math.round(grupo.porciones / total * 100) : 0
  })).sort((a, b) => b.porciones - a.porciones);
  const porLote = new Map();
  for (const p of elegidos) {
    const turno = Object.hasOwn(TURNOS, p.turno) ? p.turno : null;
    const horario = horaComida(p, fecha), clave = JSON.stringify([turno, p.zona || null, horario]);
    if (!porLote.has(clave)) porLote.set(clave, { turno, zona: p.zona, horario, comidas: [] });
    porLote.get(clave).comidas.push(p);
  }
  const lotes = [...porLote.values()].sort((a, b) => String(a.turno || 'z').localeCompare(String(b.turno || 'z')) ||
    String(a.zona || '').localeCompare(String(b.zona || '')) || a.horario.localeCompare(b.horario));
  const detalle = lotes.map(({ comidas, ...lote }) => {
    const platos = new Map();
    for (const p of comidas) {
      const platillo = p.opcion_texto || p.opcion_id;
      if (!platos.has(platillo)) platos.set(platillo, { platillo, porciones: 0, regulares: 0, coberturas: 0 });
      const r = platos.get(platillo); r.porciones++; r[p.tipo === 'cobertura' ? 'coberturas' : 'regulares']++;
    }
    return { ...lote, ...contarServicios(comidas), resumen: [...platos.values()].sort((a,b) => b.porciones-a.porciones) };
  });
  return { fecha, filtros, ...contarServicios(elegidos), total, resumen, grupos: detalle };
}
