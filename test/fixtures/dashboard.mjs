export function datosDashboard() {
  const fecha = '2026-11-07';
  const empleados = Array.from({length:131},(_,i) => ({
    telefono:'emp_' + (i+1).toString(16).padStart(4,'0'),
    numero_empleado:String(i+1).padStart(5,'0'), nombre:'Empleado de prueba ' + String(i+1).padStart(3,'0'), activo:true
  }));
  const pedidos = empleados.slice(0,61).map((emp,i) => ({
    id:i+1, fecha_menu:fecha, empleado_telefono:emp.telefono, empleados:emp,
    opcion_texto:'Platillo regular de prueba', turno:i<52 ? 'turno_a' : 'turno_b', zona:'zona_refris',
    entregado_en:fecha + (i<3 ? 'T10:16:00-06:00' : 'T10:00:00-06:00')
  }));
  const solicitud = {id:1, folio:'CE-PRUEBA-4', fecha_servicio:fecha, turno:'turno_b', zona:'zona_refris',
    origen:'supervisor', estado:'entregada', total_porciones:4, responsable_numero_snapshot:'00080',responsable_nombre_snapshot:'Responsable de prueba'};
  const items = [0,1,2,61].map((i,n) => ({
    id:n+1, solicitud_id:1, fecha_servicio:fecha, codigo_entrega:'EX-PRUEBA-'+n,
    empleado_telefono:empleados[i].telefono, empleado_numero_snapshot:empleados[i].numero_empleado,
    empleado_nombre_snapshot:empleados[i].nombre, opcion_texto:'Especial de prueba', entregado_en:fecha+'T10:07:00-06:00'
  }));
  const coberturas = items.map(i => ({...i,folio:solicitud.folio,zona:solicitud.zona,turno:solicitud.turno,origen:'supervisor',estado_solicitud:solicitud.estado}));
  const accesos = empleados.slice(62,74).map(emp => ({empleado_telefono:emp.telefono,fecha_menu:fecha,visto_en:fecha+'T08:00:00-06:00',veces:1}));
  return {fecha, empleados, pedidos, solicitud, items, coberturas, accesos};
}
