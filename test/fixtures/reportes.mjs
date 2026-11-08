import { datosDashboard } from './dashboard.mjs';

export function datosReportes() {
  const d = datosDashboard();
  d.pedidos.forEach((p,i) => { p.opcion_id='var_1';p.zona=i<18||i>=52&&i<59?'zona_refris':'zona_vdc'; });
  const extraordinaria = { ...d.solicitud, id:2, folio:'CE-X-PRUEBA-3', origen:'extraordinaria', total_porciones:3,
    entrega_programada_en:d.fecha+'T17:30:00-06:00' };
  const adicionales = [3,4,5].map((i,n) => ({...d.items[0],id:n+5,solicitud_id:2,
    codigo_entrega:'EX-ADICIONAL-'+n, empleado_telefono:d.empleados[i].telefono,
    empleado_numero_snapshot:d.empleados[i].numero_empleado, empleado_nombre_snapshot:d.empleados[i].nombre,
    opcion_texto:'Especial extraordinario', entregado_en:d.fecha+'T17:15:00-06:00'}));
  const cancelada={...extraordinaria,id:3,estado:'cancelada',total_porciones:1};
  return {...d,solicitudes:[d.solicitud,extraordinaria,cancelada],items:[...d.items,...adicionales,{...adicionales[0],id:8,solicitud_id:3}]};
}
