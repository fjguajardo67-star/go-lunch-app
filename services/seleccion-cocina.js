// Selección compartida para etiquetas y comanda: filtrar antes de contar.
import { TURNOS, ZONAS } from './menu.js';

export function normalizarSeleccionCocina({ turno, zona } = {}) {
  const valido = (valor, opciones, todos, nombre) => {
    if (valor === undefined || valor === null || valor === '' || valor === todos) return null;
    if (typeof valor === 'string' && Object.hasOwn(opciones, valor)) return valor;
    const error = new Error(`Filtro de ${nombre} inválido.`);
    error.status = 400;
    throw error;
  };
  return {
    turno: valido(turno, TURNOS, 'todos', 'turno'),
    zona: valido(zona, ZONAS, 'todas', 'zona')
  };
}

export function seleccionarPedidosCocina(pedidos, seleccion = {}) {
  const { turno, zona } = normalizarSeleccionCocina(seleccion);
  return pedidos.filter(p => (!turno || p.turno === turno) && (!zona || p.zona === zona));
}

export function textoSeleccionCocina(seleccion = {}) {
  const { turno, zona } = normalizarSeleccionCocina(seleccion);
  return `${turno === 'turno_a' ? 'Turno A' : turno === 'turno_b' ? 'Turno B' : 'Todos los turnos'} · ${zona ? ZONAS[zona] : 'Todas las zonas'}`;
}

export function resumirPedidosCocina(fecha, pedidos, seleccion = {}) {
  const filtros = normalizarSeleccionCocina(seleccion);
  const elegidos = seleccionarPedidosCocina(pedidos, filtros);
  const total = elegidos.length;
  const grupos = new Map();
  for (const p of elegidos) {
    const platillo = p.opcion_texto || p.opcion_id;
    if (!grupos.has(platillo)) grupos.set(platillo, { porciones: 0, por_turno: {}, por_zona: {} });
    const grupo = grupos.get(platillo);
    const turno = TURNOS[p.turno] || p.turno || 'Sin turno';
    const zona = ZONAS[p.zona] || p.zona || 'Sin zona';
    grupo.porciones++;
    grupo.por_turno[turno] = (grupo.por_turno[turno] || 0) + 1;
    grupo.por_zona[zona] = (grupo.por_zona[zona] || 0) + 1;
  }
  const resumen = [...grupos.entries()].map(([platillo, grupo]) => ({
    platillo, ...grupo, porcentaje: total ? Math.round(grupo.porciones / total * 100) : 0
  })).sort((a, b) => b.porciones - a.porciones);
  return { fecha, filtros, total, resumen };
}
