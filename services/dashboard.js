import { DateTime } from 'luxon';
import { claveEmpleado } from './telefono.js';
import { esEntregaTardia, TOLERANCIA_TARDIA_MIN, ZONA } from './menu.js';
import { noSurtida, entregada as entregaConfirmada } from './incidencias.js';

const numero = valor => String(valor ?? '').trim();
const identidad = (telefono, nro) => {
  const tel = claveEmpleado(telefono);
  return tel ? 'tel:' + tel : numero(nro) ? 'num:' + numero(nro) : null;
};

export function construirDashboard({fecha, empleados, pedidos, coberturas = [], accesos = [], accesosOk = true}) {
  const porTel = new Map(), porNumero = new Map(), accesosPorTel = new Map();
  for (const emp of empleados) {
    const tel = claveEmpleado(emp.telefono);
    if (tel) porTel.set(tel, emp);
    if (numero(emp.numero_empleado)) porNumero.set(numero(emp.numero_empleado), emp);
  }
  for (const acceso of accesos) {
    const tel = claveEmpleado(acceso.empleado_telefono);
    if (tel) accesosPorTel.set(tel, acceso);
  }
  const claveActiva = emp => identidad(emp.telefono, emp.numero_empleado);
  const conPedido = new Set();
  const comidasPorEmpleado = new Map();

  function filaPedido(p, tipo) {
    const especial = tipo === 'cobertura';
    const nro = especial ? p.empleado_numero_snapshot : p.empleados?.numero_empleado;
    const emp = porTel.get(claveEmpleado(p.empleado_telefono)) || porNumero.get(numero(nro));
    if (emp) {
      const clave = claveActiva(emp);
      conPedido.add(clave);
      comidasPorEmpleado.set(clave, (comidasPorEmpleado.get(clave) || 0) + 1);
    }
    const acc = accesosPorTel.get(claveEmpleado(emp?.telefono || p.empleado_telefono));
    const programada = especial ? p.entrega_programada_en || null : null;
    const entregada = p.entregado_en || null;
    let tardia = esEntregaTardia(fecha, p.turno, entregada, p.zona);
    if (programada && entregada) {
      const limite = DateTime.fromISO(programada, {zone:ZONA}).plus({minutes:TOLERANCIA_TARDIA_MIN});
      const hora = DateTime.fromISO(entregada, {zone:ZONA});
      tardia = limite.isValid && hora.isValid ? hora > limite : null;
    }
    return {
      id:p.id, no_surtido_en:p.no_surtido_en || null, no_surtido_motivo:p.no_surtido_motivo || null, no_surtido_por:p.no_surtido_por || null,
      tipo, origen: especial ? p.origen || 'supervisor' : 'regular',
      folio: especial ? p.folio || null : null,
      nombre: (especial ? p.empleado_nombre_snapshot : p.empleados?.nombre) || emp?.nombre || 'Empleado sin nombre',
      numero_empleado: nro || emp?.numero_empleado || null,
      platillo: p.opcion_texto || p.opcion_id,
      zona: p.zona, turno: p.turno,
      entrega_programada_en: programada,
      entregado_en: entregada, motivo_tardia: p.motivo_tardia || null,
      entrega_conciliada_en:p.entrega_conciliada_en || null,
      entrega_conciliada_por:p.entrega_conciliada_por || null,
      entrega_conciliacion_motivo:p.entrega_conciliacion_motivo || null,
      visto_en: acc?.visto_en || null, veces: acc?.veces || 0,
      estado: noSurtida(p) ? 'no_surtido' : !entregaConfirmada(p) ? 'pendiente' : tardia ? 'tardia' : 'entregado'
    };
  }

  const especiales = coberturas.filter(p => p.estado_solicitud !== 'cancelada');
  const comidas = [
    ...pedidos.map(p => filaPedido(p,'regular')),
    ...especiales.map(p => filaPedido(p,'cobertura'))
  ];
  const sinPedido = empleados.filter(emp => !conPedido.has(claveActiva(emp))).map(emp => {
    const acc = accesosPorTel.get(claveEmpleado(emp.telefono));
    return {
      tipo:null, origen:null, folio:null,
      nombre:emp.nombre, numero_empleado:emp.numero_empleado,
      platillo:null, zona:null, turno:null, entrega_programada_en:null,
      entregado_en:null, motivo_tardia:null,
      visto_en:acc?.visto_en || null, veces:acc?.veces || 0,
      estado:acc ? 'vio_no_ordeno' : accesosOk ? 'no_abrio' : 'sin_dato'
    };
  });
  const filas = [...comidas,...sinPedido].sort((a,b) =>
    a.nombre.localeCompare(b.nombre,'es',{sensitivity:'base'}) ||
    numero(a.numero_empleado).localeCompare(numero(b.numero_empleado),'es',{numeric:true}) ||
    String(a.turno || '').localeCompare(String(b.turno || '')) ||
    (a.tipo === 'regular' ? 0 : 1) - (b.tipo === 'regular' ? 0 : 1));
  const cuenta = estado => filas.filter(f => f.estado === estado).length;
  // El detalle de personas usa exclusivamente la plantilla activa. Las
  // comidas históricas y sus nombres originales siguen en filas.
  const personas = empleados.map(emp => {
    const acceso = accesosPorTel.get(claveEmpleado(emp.telefono));
    return {
      nombre:emp.nombre, numero_empleado:emp.numero_empleado,
      comidas:comidasPorEmpleado.get(claveActiva(emp)) || 0,
      ingreso:acceso ? 'registrado' : accesosOk ? 'sin_registro' : 'sin_dato',
      visto_en:acceso?.visto_en || null
    };
  }).sort((a,b) => a.nombre.localeCompare(b.nombre,'es',{sensitivity:'base'}) ||
    numero(a.numero_empleado).localeCompare(numero(b.numero_empleado),'es',{numeric:true}));
  return {
    fecha,
    personas,
    resumen: {
      activos:empleados.length, ordenaron:conPedido.size, no_ordenaron:sinPedido.length,
      total_comidas:comidas.length, regulares:pedidos.length, coberturas:especiales.length,
      vieron_no_ordenaron:cuenta('vio_no_ordeno'), no_abrieron:cuenta('no_abrio'),
      sin_dato:cuenta('sin_dato'), accesos_ok:accesosOk,
      entregados:cuenta('entregado') + cuenta('tardia'), pendientes:cuenta('pendiente'), tardias:cuenta('tardia'), no_surtidos:cuenta('no_surtido')
    },
    filas
  };
}
