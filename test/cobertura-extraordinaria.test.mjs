import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { Settings } from 'luxon';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fecha='2026-11-07';
const entrada={fecha,turno:'turno_b',zona:'zona_refris',hora_entrega:'18:20',responsable_numero:'00003',motivo:'Hay ventana de entrega disponible',items:[{numero_empleado:'00002',opcion_id:'especial_1'}],idempotencia:'00000000-0000-4000-8000-000000000001'};

function formularioExtraordinaria(cambios={}) {
 const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
 const nombres=['avisoExtraordinaria','limpiarErrorExtraordinaria','errorCampoExtraordinaria','normalizarHoraExtraordinaria','guardarExtraordinaria'];
 const funciones=nombres.map(nombre=>html.match(new RegExp('(?:async )?function '+nombre+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
 const campos={};let foco=null,desplazado=null,ids=0;const enviados=[];
 const valores={'extra-turno':'turno_b','extra-zona':'zona_refris','extra-hora':'17:30','extra-responsable':'00003','extra-motivo':'Hay ventana para preparar y entregar',...cambios};
 for(const id of [...Object.keys(valores),'extra-guardar','extra-aviso',...Object.keys(valores).map(k=>k+'-error')]) {
  campos[id]={id,value:valores[id]||'',disabled:false,hidden:true,textContent:'',atributos:{},
   setAttribute(k,v){this.atributos[k]=v},removeAttribute(k){delete this.atributos[k]},
   focus(){foco=id},scrollIntoView(){desplazado=id}};
 }
 const filas=[{numero_empleado:'00006',opcion_id:'especial_1'},{numero_empleado:'00007',opcion_id:'especial_2'}];
 const c=vm.createContext({document:{getElementById:id=>campos[id]},EXTRA_CONFIG:{fecha},EXTRA_FILAS:filas,EXTRA_INTENTO:null,
  empleadoExtraordinaria:n=>n==='00003'?{activo:true}:null,crypto:{randomUUID:()=>{ids++;return entrada.idempotencia}},
  api:async(url,opciones)=>{enviados.push({url,body:JSON.parse(opciones.body)});throw new Error('Sin conexión de prueba')}});
 vm.runInContext(funciones,c);
 return {c,campos,filas,enviados,get foco(){return foco},get desplazado(){return desplazado},get ids(){return ids},
  async enviar(){let prevenido=false;await c.guardarExtraordinaria({preventDefault(){prevenido=true}});assert.equal(prevenido,true)}};
}

test('la captura de hora usa 24 horas y rechaza valores incompletos o ambiguos',()=>{
 const {c}=formularioExtraordinaria();
 for(const [texto,hora] of [['17:30','17:30'],['7:05','07:05'],[' 17:30 ','17:30'],['00:00','00:00'],['23:59','23:59']])assert.equal(c.normalizarHoraExtraordinaria(texto),hora);
 for(const texto of ['',null,undefined,'5:3','24:00','17:60','5:30pm','17.30','-1:30','17:30:10'])assert.equal(c.normalizarHoraExtraordinaria(texto),null,String(texto));
});

test('errores de captura señalan el campo, conservan empleados y no envían la autorización',async()=>{
 for(const [id,valor] of [['extra-turno','otro'],['extra-zona',''],['extra-hora','5:3'],['extra-hora','24:00'],['extra-responsable','no-existe'],['extra-motivo','   '],['extra-motivo','x'.repeat(501)]]) {
  const f=formularioExtraordinaria({[id]:valor});const antes=structuredClone(f.filas);
  await f.enviar();assert.equal(f.enviados.length,0);assert.deepEqual(f.filas,antes);
  assert.equal(f.foco,id);assert.equal(f.desplazado,id);assert.equal(f.campos[id].atributos['aria-invalid'],'true');
  assert.equal(f.campos[id+'-error'].hidden,false);assert.ok(f.campos[id+'-error'].textContent.length>10);
  f.c.limpiarErrorExtraordinaria(f.campos[id]);assert.equal(f.campos[id].atributos['aria-invalid'],undefined);assert.equal(f.campos[id+'-error'].hidden,true);
 }
});

test('17:30 se envía como tal y un fallo de conexión conserva filas y clave de reintento',async()=>{
 const f=formularioExtraordinaria();const antes=structuredClone(f.filas);
 await f.enviar();await f.enviar();assert.equal(f.enviados.length,2);
 for(const {url,body} of f.enviados){assert.equal(url,'/api/cobertura/extraordinarias');assert.equal(body.hora_entrega,'17:30');assert.equal(body.idempotencia,entrada.idempotencia);assert.equal(body.items.length,2)}
 assert.deepEqual(f.filas,antes);assert.equal(f.campos['extra-guardar'].disabled,false);assert.equal(f.ids,1);
 assert.match(f.campos['extra-aviso'].textContent,/Puedes reintentar/);
});

test('gerente autoriza un folio adicional; la clave de supervisor y la captura pública conservan el corte',async()=>{
 const variables=['SUPABASE_URL','SUPABASE_KEY','ADMIN_KEY','GERENTE_KEY','SUPERVISOR_SESSION_SECRET'];
 const originales=Object.fromEntries(variables.map(k=>[k,process.env[k]]));const reloj=Settings.now;
 Settings.now=()=>Date.parse(fecha+'T16:00:00-06:00');
 let guardado=null,llamadas=0;const solicitudes=[{id:1,fecha_servicio:fecha,turno:'turno_b',zona:'zona_refris',origen:'supervisor',estado:'entregada',total_porciones:4,folio:'ORIGINAL'}];
 const base=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://prueba');res.setHeader('content-type','application/json');let datos=[];
  if(url.pathname.endsWith('/menus_cobertura'))datos=[{fecha,activo:true,opcion_1:'Pollo',opcion_2:'Ensalada',opcion_3:'Pescado'}];
  if(url.pathname.endsWith('/solicitudes_cobertura'))datos=solicitudes;
  if(url.pathname.endsWith('/solicitudes_cobertura_items')) {
   datos=Array.from({length:4},(_,i)=>({solicitud_id:1,empleado_numero_snapshot:String(i+10),opcion_texto:'Platillo original',codigo_entrega:'qr-original-'+i,opcion_id:'especial_2'}));
   if(guardado)datos.push({solicitud_id:2,empleado_numero_snapshot:'00002',empleado_nombre_snapshot:'Persona de prueba',opcion_texto:'Pollo',codigo_entrega:'qr-extra',opcion_id:'especial_1'});
   const filtro=url.searchParams.get('solicitud_id');if(filtro?.startsWith('eq.'))datos=datos.filter(i=>String(i.solicitud_id)===filtro.slice(3));
  }
  if(url.pathname.endsWith('/rpc/autorizar_cobertura_extraordinaria')){
   let body='';for await(const chunk of req)body+=chunk;const p=JSON.parse(body);llamadas++;
   if(p.p_entrega_programada_en<fecha+'T16:00:00-06:00'){res.statusCode=400;res.end(JSON.stringify({code:'P0001',message:'entrega_extraordinaria_invalida'}));return;}
   guardado=p;
   datos=[{id:2,fecha_servicio:fecha,turno:p.p_turno,zona:p.p_zona,folio:p.p_folio,origen:'extraordinaria',autorizado_por:p.p_autorizado_por,entrega_programada_en:p.p_entrega_programada_en,motivo_autorizacion:p.p_motivo,total_porciones:1,estado:'confirmada'}];
   if(solicitudes.length===1)solicitudes.push(datos[0]);
  }
  res.end(JSON.stringify(datos));
 });
 await new Promise(resolve=>base.listen(0,'127.0.0.1',resolve));
 process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;process.env.SUPABASE_KEY='solo-prueba';process.env.ADMIN_KEY='admin-prueba';process.env.GERENTE_KEY='gerente-prueba';process.env.SUPERVISOR_SESSION_SECRET='secreto-solo-prueba';
 let server;
 try{
  const {adminRouter}=await import('../routes/admin.js');const {guardarSolicitud}=await import('../services/cobertura.js');
  const {entregaRouter}=await import('../routes/entrega.js');
  const app=express();app.use(express.json());app.use('/api/entrega',entregaRouter);app.use('/api',adminRouter);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  const pedir=async(body,key='gerente-prueba',usuario='gerente')=>{
   const r=await fetch(url+'/api/cobertura/extraordinarias',{method:body?'POST':'GET',headers:{'content-type':'application/json','x-admin-key':key,'x-panel-user':usuario},...(body?{body:JSON.stringify(body)}:{})});
   return {status:r.status,body:await r.json()};
  };
  const config=await pedir();assert.equal(config.status,200);assert.equal(config.body.fecha,fecha);assert.equal(config.body.opciones.length,3);
  assert.equal((await pedir(entrada,'','')).status,401);
  assert.equal((await pedir(entrada,'clave-supervisor','')).status,401);
  assert.equal(llamadas,0);
  const r=await pedir({...entrada,autorizado_por:'admin',supervisor_id:1,ignorar_corte:true});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.solicitud.total_porciones,1);assert.equal(r.body.solicitud.items.length,1);
  assert.equal(guardado.p_autorizado_por,'gerente');assert.equal(guardado.p_fecha,fecha);assert.match(guardado.p_folio,/^CE-X-/);
  assert.equal(guardado.p_supervisor_id,undefined);assert.equal(guardado.ignorar_corte,undefined);
  assert.equal(solicitudes[0].estado,'entregada');assert.equal(solicitudes[0].total_porciones,4);
  for(const cambio of [{fecha:'2026-11-06'},{fecha:'2026-11-08'},{motivo:'x'},{turno:'otro'},{zona:'otra'},{hora_entrega:'25:00'},{idempotencia:'mal'},{items:[entrada.items[0],entrada.items[0]]}]){
   const mala=await pedir({...entrada,...cambio});assert.equal(mala.status,400,JSON.stringify(cambio)+' '+JSON.stringify(mala));
  }
  assert.equal(llamadas,1);
  assert.equal((await pedir({...entrada,hora_entrega:'15:00'})).status,409);
  assert.equal((await pedir(entrada,'admin-prueba','admin')).status,200);
  await assert.rejects(()=>guardarSolicitud(1,{...entrada,ignorar_corte:true}),e=>e.status===409&&e.motivo==='fuera_de_horario');
  const consulta=await fetch(url+'/api/cobertura/solicitudes/'+fecha+'?turno=turno_b',{headers:{'x-admin-key':'gerente-prueba','x-panel-user':'gerente'}});
  const panel=await consulta.json();assert.equal(panel.total_porciones,5);
  const turno=panel.por_turno.find(t=>t.turno==='turno_b');assert.equal(turno.porciones_corte,4);assert.equal(turno.total_porciones,5);
  const {resumenCobertura,etiquetasCobertura,htmlComandaCobertura,htmlEtiquetasCobertura}=await import('../services/cocina-cobertura.js');
  const resumen=await resumenCobertura(fecha,'turno_b',{solicitud:'2'});assert.equal(resumen.solicitudes,1);assert.equal(resumen.total,1);
  assert.equal(resumen.resumen[0].horario,'6:20 PM');
  const comanda=htmlComandaCobertura(resumen,{ancho:58});assert.match(comanda,/COBERTURA EXTRAORDINARIA/);assert.match(comanda,/6:20 PM/);assert.doesNotMatch(comanda,/ORIGINAL|Salida máxima/);
  const etiquetas=htmlEtiquetasCobertura(await etiquetasCobertura(fecha,{turno:'turno_b',solicitud:'2'}));
  assert.match(etiquetas,/REFIS · 6:20 PM/);assert.match(etiquetas,/EX\|qr-extra\|2026-11-07/);assert.match(etiquetas,/transform:scale\(0\.85\)/);
  assert.equal((await resumenCobertura(fecha,'turno_b',{origen:'supervisor'})).total,4);
  const reparto=await fetch(url+'/api/entrega/'+fecha,{headers:{'x-admin-key':'gerente-prueba'}});
  const repartoDatos=await reparto.json();assert.equal(reparto.status,200,JSON.stringify(repartoDatos));
  const extra=repartoDatos.pedidos.find(p=>p.codigo_entrega==='qr-extra');
  assert.equal(extra.origen,'extraordinaria');assert.match(extra.entrega_programada_en,/18:20/);
 }finally{
  if(server)await new Promise(r=>server.close(r));await new Promise(r=>base.close(r));Settings.now=reloj;
  for(const k of variables)if(originales[k]===undefined)delete process.env[k];else process.env[k]=originales[k];
 }
});

test('selección de impresos rechaza folios ajenos y mantiene horario regular',async()=>{
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_KEY='solo-prueba';
 const {seleccionarSolicitudesCobertura,horaTextoCobertura}=await import('../services/impresos-cobertura.js');
 const solicitudes=[{id:1,estado:'entregada',turno:'turno_a',zona:'zona_refris'},{id:2,estado:'confirmada',origen:'extraordinaria',entrega_programada_en:fecha+'T18:20:00-06:00'}];
 for(const solicitud of ['0','-1','otro',['1'],1.5])assert.throws(()=>seleccionarSolicitudesCobertura(solicitudes,{solicitud}),e=>e.status===400);
 assert.throws(()=>seleccionarSolicitudesCobertura(solicitudes,{solicitud:'3'}),e=>e.status===404);
 assert.throws(()=>seleccionarSolicitudesCobertura(solicitudes,{origen:['supervisor']}),e=>e.status===400);
 assert.deepEqual(seleccionarSolicitudesCobertura(solicitudes,{origen:'supervisor'}).map(s=>s.id),[1]);
 assert.equal(horaTextoCobertura(solicitudes[0],fecha),'10:00 AM');assert.equal(horaTextoCobertura(solicitudes[1],fecha),'6:20 PM');
});

test('reparto conserva el horario extraordinario y tolerancia al trabajar sin señal',()=>{
 const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
 const funciones=['limiteDelTurno','limiteDelPedido','esTardia'].map(nombre=>html.match(new RegExp('function '+nombre+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
 const contexto=vm.createContext({});vm.runInContext(readFileSync(new URL('../public/operacion.js',import.meta.url),'utf8'),contexto);
 vm.runInContext(`const FECHA='${fecha}',ZONA='zona_refris',TOLERANCIA_MIN=15;${funciones}`,contexto);
 const pedido={turno:'turno_b',zona:'zona_refris',entrega_programada_en:fecha+'T18:20:00-06:00',entregado_en:fecha+'T18:35:00-06:00'};
 contexto.pedido=pedido;assert.equal(vm.runInContext('esTardia(pedido)',contexto),false);
 pedido.entregado_en=fecha+'T18:35:01-06:00';assert.equal(vm.runInContext('esTardia(pedido)',contexto),true);
});
