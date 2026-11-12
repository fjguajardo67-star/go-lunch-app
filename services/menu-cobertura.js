import { DateTime } from 'luxon';

export function validarVigenciaMenu(body = {}) {
  body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const inicio = body.fecha_inicio ?? body.fecha;
  const final = body.fecha_final ?? body.fecha;
  const fechaValida = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v,{zone:'UTC'}).isValid;
  if (!fechaValida(inicio) || !fechaValida(final)) return {error:'Indica una fecha de inicio y una fecha final válidas.'};
  const dias = DateTime.fromISO(final,{zone:'UTC'}).diff(DateTime.fromISO(inicio,{zone:'UTC'}),'days').days+1;
  if(dias<1) return {error:'La fecha final no puede ser anterior a la fecha de inicio.'};
  if(dias>366) return {error:'La vigencia no puede superar 366 días. Publica un periodo más corto.'};
  const opciones = [body.opcion_1,body.opcion_2,body.opcion_3];
  if(opciones.some(v=>typeof v!=='string'||!v.trim())) return {error:'Completa las tres opciones del menú especial.'};
  const limpias=opciones.map(v=>v.trim());
  if(new Set(limpias.map(v=>v.toLocaleUpperCase('es-MX'))).size!==3) return {error:'Las tres opciones del menú deben ser distintas.'};
  if(body.periodo_id != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.periodo_id)) return {error:'El periodo no es válido. Vuelve a cargar el menú.'};
  return {menu:{fecha_inicio:inicio,fecha_final:final,opcion_1:limpias[0],opcion_2:limpias[1],opcion_3:limpias[2],activo:body.activo!==false,periodo_id:body.periodo_id??null}};
}

export function errorPublicarMenu(error) {
  const mensaje=String(error?.message||'');
  if(mensaje.includes('menu_con_solicitudes:')) return {status:409,error:`Ya hay solicitudes confirmadas el ${mensaje.split('menu_con_solicitudes:')[1].slice(0,10)}. No se cambió ninguna fecha: conserva ese menú o elige otro periodo.`};
  if(mensaje.includes('vigencia_solapada')) return {status:409,error:'El periodo se cruza con otro menú especial publicado. Consulta una fecha de ese periodo para editarlo, o elige fechas libres.'};
  if(mensaje.includes('periodo_no_encontrado')) return {status:409,error:'El periodo ya no está disponible. Vuelve a cargar el menú antes de guardar.'};
  if(error?.code==='PGRST202'||error?.code==='42703') return {status:503,error:'Falta actualizar la vigencia de menús en la base de datos. Contacta al administrador.'};
  return {status:500,error:'No se pudo publicar el periodo. Intenta de nuevo; si persiste, contacta al administrador.'};
}

export async function guardarPeriodoMenu(client, menu) {
  const {data,error}=await client.rpc('publicar_menu_cobertura_periodo',{
    p_desde:menu.fecha_inicio,p_hasta:menu.fecha_final,
    p_opcion_1:menu.opcion_1,p_opcion_2:menu.opcion_2,p_opcion_3:menu.opcion_3,
    p_activo:menu.activo,p_periodo_id:menu.periodo_id
  });
  if(error)throw error;
  return data;
}

export function estadoEdicionMenuFecha(menu, solicitudes, fecha, ahora = DateTime.now()) {
  if (!fecha || fecha <= ahora.setZone('America/Mexico_City').toISODate())
    return {permitido:false,motivo:'Solo se pueden cambiar fechas futuras; hoy y el historial se conservan.'};
  if (!menu?.activo) return {permitido:false,motivo:'No hay menú publicado para esta fecha. Usa Publicar menú para el periodo.'};
  if (solicitudes > 0) return {permitido:false,motivo:'Esta fecha tiene pedidos activos o entregados. No se pueden cambiar sus opciones.'};
  return {permitido:true,motivo:'Sin pedidos activos. Puedes cambiar las tres opciones únicamente para esta fecha.'};
}

export function validarMenuFecha(fecha, body = {}) {
  const validacion=validarVigenciaMenu({...body,fecha_inicio:fecha,fecha_final:fecha,periodo_id:null,activo:true});
  if(validacion.error)return validacion;
  if(!estadoEdicionMenuFecha({activo:true},0,fecha).permitido)
    return {error:'Solo se pueden cambiar fechas futuras.'};
  if(typeof body?.version !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(body.version) || !DateTime.fromISO(body.version).isValid)
    return {error:'Vuelve a consultar el menú antes de guardar.'};
  return {menu:{...validacion.menu,fecha,version:body.version}};
}

export async function guardarMenuFecha(client, menu) {
  const {data,error}=await client.rpc('cambiar_menu_cobertura_fecha',{
    p_fecha:menu.fecha,p_opcion_1:menu.opcion_1,p_opcion_2:menu.opcion_2,
    p_opcion_3:menu.opcion_3,p_version:menu.version
  });
  if(error)throw error;
  return data;
}

export function errorCambiarMenuFecha(error) {
  const mensajes={
    menu_fecha_no_futura:'Solo se pueden cambiar fechas futuras; hoy y el historial se conservan.',
    menu_fecha_no_publicada:'El menú ya no está publicado. Vuelve a consultar la fecha.',
    menu_fecha_con_pedidos:'Ya hay pedidos activos o entregados para esta fecha. No se cambió el menú.',
    menu_fecha_version_obsoleta:'El menú cambió desde que lo abriste. Vuelve a consultar antes de editar.',
    opciones_incompletas:'Completa las tres opciones.',opciones_repetidas:'Las tres opciones deben ser distintas.'
  };
  if(mensajes[error?.message])return {status:409,error:mensajes[error.message]};
  return {status:503,error:'No se pudo confirmar el cambio. Vuelve a consultar la fecha antes de reintentar.'};
}
