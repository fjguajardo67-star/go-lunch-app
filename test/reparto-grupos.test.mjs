import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {pedidosDelGrupo,pendientesDelCierre,validarGrupo} from '../services/reparto-grupos.js';
import http from 'node:http';
import express from 'express';
import {Settings} from 'luxon';

const fecha='2026-11-07',zona='zona_refris';
const pedidos=[
 {tipo:'regular',numero_empleado:'001',zona,turno:'turno_a',entregado_en:null},
 {tipo:'regular',numero_empleado:'002',zona,turno:'turno_a',entregado_en:fecha+'T10:00:00-06:00'},
 {tipo:'regular',numero_empleado:'003',zona,turno:'turno_b',entregado_en:null},
 {tipo:'regular',numero_empleado:'004',zona:'zona_vdc',turno:'turno_a',entregado_en:null},
 {tipo:'cobertura',numero_empleado:'005',zona,turno:'turno_a',codigo_entrega:'A-EX',entregado_en:null},
 {tipo:'cobertura',numero_empleado:'006',zona,turno:'turno_b',codigo_entrega:'B-EX',entregado_en:null},
 {numero_empleado:'007',zona,turno:'turno_a',entregado_en:null}
];

test('la lista y el cierre se limitan al grupo; coberturas y tipos desconocidos no entran al cierre',()=>{
 assert.deepEqual(pedidosDelGrupo(pedidos,zona,'turno_a').map(p=>p.numero_empleado),['001','002','005','007']);
 assert.deepEqual(pendientesDelCierre(pedidos,zona,'turno_a').map(p=>p.numero_empleado),['001']);
 assert.deepEqual(pendientesDelCierre(pedidos,zona,'turno_b').map(p=>p.numero_empleado),['003']);
 for(const turno of ['',null,'turno_c'])assert.deepEqual(pendientesDelCierre(pedidos,zona,turno),[]);
 assert.equal(validarGrupo(pedidos[2],zona,'turno_a').motivo,'turno_incorrecto');
 assert.equal(validarGrupo(pedidos[3],zona,'turno_a').motivo,'zona_incorrecta');
});

test('finalizar reparto detiene la sesión sin marcar pendientes ni cambiar la cola',()=>{
 const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
 const funciones=['finalizarReparto','cerrarEscaneoDeServicio'].map(nombre=>
  html.match(new RegExp('function '+nombre+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
 const captura={};const copia=structuredClone(pedidos);
 const cola=[{numero_empleado:'002',entregado_en:pedidos[1].entregado_en}];
 const contexto=vm.createContext({PEDIDOS:copia,COLA:structuredClone(cola),SERVICIO_INICIADO:true,SERVICIO_MANUAL:false,
  SUPERVISOR_ACTUAL:'Responsable QA',escaneando:true,RECEPTOR_PENDIENTE:null,
  comidasEnPantalla:()=>copia.filter(p=>p.zona===zona&&p.turno==='turno_a'),
  confirm:mensaje=>{captura.prompt=mensaje;return true;},detenerCamara:()=>{captura.camara=true;},
  cancelarManual:()=>{},recordarServicio:()=>{},pintar:()=>{}});
 vm.runInContext(funciones+';finalizarReparto()',contexto);
 assert.equal(contexto.SERVICIO_INICIADO,false);assert.equal(contexto.SUPERVISOR_ACTUAL,'');assert.equal(captura.camara,true);
 assert.deepEqual(contexto.COLA,cola);assert.deepEqual(copia,pedidos);assert.match(captura.prompt,/3 comida\(s\) pendientes/);
});

test('el servicio se restaura solo en su fecha, zona y usuario sin adelantarlo por pendientes',()=>{
 const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
 const fn=html.match(/function restaurarServicio\([\s\S]*?\n  }/)[0];
 const servicio={id:'regular|turno_a',turno:'turno_a',pendientes:0};
 const guardado={fecha,zona,id:servicio.id,usuario:10,iniciado:true,supervisor:'Supervisora QA'};
 const c=vm.createContext({TURNO:'',SERVICIO_ID:'',SERVICIO_INICIADO:false,SUPERVISOR_ACTUAL:'',
  FECHA:fecha,ZONA:zona,SESION:{repartidor:{id:10}},LS:{servicio:'servicio'},leerLS:()=>guardado,
  agenda:()=>[servicio,{id:'regular|turno_b',turno:'turno_b',pendientes:8}],servicioActual:()=>servicio});
 vm.runInContext(fn+';restaurarServicio()',c);
 assert.equal(c.TURNO,'turno_a');assert.equal(c.SERVICIO_ID,servicio.id);assert.equal(c.SERVICIO_INICIADO,true);
 for(const cambio of [{ZONA:'zona_vdc'},{FECHA:'2026-11-08'},{SESION:{repartidor:{id:11}}}]){
  Object.assign(c,{TURNO:'',SERVICIO_ID:'',SERVICIO_INICIADO:false,FECHA:fecha,ZONA:zona,SESION:{repartidor:{id:10}}},cambio);
  vm.runInContext('restaurarServicio()',c);assert.equal(c.SERVICIO_ID,'');assert.equal(c.SERVICIO_INICIADO,false);
 }
});

test('un rechazo de un lote no borra la cola del otro turno si ese envío falla',async()=>{
 const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
 const fn=html.match(/async function sincronizarJornada\([\s\S]*?\n  }/)[0];
 const cola=['turno_a','turno_b'].map(turno=>({tipo:'regular',numero_empleado:turno,fecha,zona,turno}));
 const c=vm.createContext({COLA:cola,LLEGADAS:[],FECHA:fecha,ZONA:zona,EPOCA_ZONA:0,FECHA_REPARTO:'hoy',
  navigator:{onLine:true},API_BASE:'',LS:{cola:'cola'},zonaDeElemento:e=>e.zona,cabecerasAuth:x=>x,
  guardar:()=>{},mostrarAviso:()=>{},marcarListaVieja:()=>{},listaDeHoy:()=>true,estadoConexion:()=>{},
  fetch:async(_url,opciones)=>{
   if(opciones?.method==='POST'&&JSON.parse(opciones.body).turno==='turno_a')return {ok:false,json:async()=>({definitivo:true,error:'Fecha futura'})};
   throw new Error('Sin conexión');
  }});
 await vm.runInContext(fn+';sincronizarJornada()',c);
 assert.equal(c.COLA.length,1);assert.equal(c.COLA[0].turno,'turno_b');
});

test('la lógica de grupos se sirve desde la caché del service worker sin conexión',async()=>{
 const eventos={};let respuesta;
 const c=vm.createContext({URL,Request,Response,console,self:{location:{origin:'http://prueba'},addEventListener:(n,fn)=>eventos[n]=fn},
  fetch:async()=>{throw new Error('Sin conexión');},caches:{match:async r=>r.url.endsWith('/reparto-grupos.js')?new Response('grupo disponible sin señal'):undefined}});
 vm.runInContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),c);
 eventos.fetch({request:new Request('http://prueba/reparto-grupos.js'),respondWith:r=>respuesta=r});
 assert.ok(respuesta);assert.equal(await (await respuesta).text(),'grupo disponible sin señal');
});

test('API valida grupo real, rechaza cierre masivo y permite entrega individual al supervisor',async()=>{
 const variables=['SUPABASE_URL','SUPABASE_KEY','ADMIN_KEY'];const prev=Object.fromEntries(variables.map(k=>[k,process.env[k]]));const reloj=Settings.now;
 Settings.now=()=>Date.parse(fecha+'T16:00:00-06:00');
 const empleados=pedidos.map((p,i)=>({telefono:'QA-'+i,numero_empleado:p.numero_empleado,nombre:'Persona '+p.numero_empleado,activo:true}));
 const regulares=pedidos.filter(p=>p.tipo==='regular').map((p,i)=>({...p,id:i+1,fecha_menu:fecha,empleado_telefono:empleados.find(e=>e.numero_empleado===p.numero_empleado).telefono,opcion_texto:'Pollo'}));
 const solicitud={id:10,folio:'COBERTURA',turno:'turno_b',zona,fecha_servicio:fecha,estado:'confirmada',responsable_numero_snapshot:'999',responsable_nombre_snapshot:'Responsable'};
 const item={id:20,solicitud_id:10,codigo_entrega:'B-EX',fecha_servicio:fecha,empleado_numero_snapshot:'006',empleado_nombre_snapshot:'Persona 006',opcion_texto:'Pescado',entregado_en:null};
 let escrituras=0,cambiarGrupo=false;
 const base=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://prueba');res.setHeader('content-type','application/json');
  const tabla=u.pathname.split('/').at(-1);let datos=tabla==='empleados'?empleados:tabla==='pedidos'?regulares:tabla==='solicitudes_cobertura'?[solicitud]:tabla==='solicitudes_cobertura_items'?[item]:[];
  if(req.method==='PATCH'&&tabla==='pedidos'&&cambiarGrupo){regulares[0].turno='turno_b';cambiarGrupo=false;}
  datos=datos.filter(p=>[...u.searchParams].every(([k,v])=>v.startsWith('eq.')?String(p[k])===v.slice(3):v==='is.null'?p[k]==null:true));
  if(req.method==='PATCH'){
   let texto='';for await(const t of req)texto+=t;const cambios=JSON.parse(texto);
   for(const p of datos){Object.assign(p,cambios);escrituras++;}
  }
  res.setHeader('content-range','0-'+Math.max(0,datos.length-1)+'/'+datos.length);
  const salida=tabla==='pedidos'?datos.map(p=>({...p,empleados:empleados.find(e=>e.telefono===p.empleado_telefono)})):datos;
  res.end(JSON.stringify(salida));
 });
 await new Promise(r=>base.listen(0,'127.0.0.1',r));process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;process.env.SUPABASE_KEY='solo-prueba';process.env.ADMIN_KEY='admin-prueba';
 let server;
 try{
  const {entregaRouter}=await import('../routes/entrega.js');const app=express();app.use(express.json());app.use('/api/entrega',entregaRouter);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}`;
  const post=async(e,turno='turno_a')=>{const r=await fetch(url+'/api/entrega',{method:'POST',headers:{'content-type':'application/json','x-admin-key':'admin-prueba'},body:JSON.stringify({fecha,zona,turno,entregas:[{numero_empleado:'003',tipo:'regular',zona,turno,entregado_en:fecha+'T10:00:00-06:00',...e}]})});return r.json()};
  assert.equal((await post({})).resultados[0].motivo,'turno_incorrecto');
  assert.equal((await post({turno:'turno_b'})).resultados[0].motivo,'turno_incorrecto');
  assert.equal((await post({turno:undefined})).resultados[0].motivo,'grupo_requerido');
  assert.equal((await post({numero_empleado:'004'})).resultados[0].motivo,'zona_incorrecta');
  assert.equal((await post({tipo:'cobertura',codigo_entrega:'B-EX',numero_empleado:'006',turno:'turno_b',accion:'cierre_ruta',entregado_a:'supervisor'},'turno_b')).resultados[0].motivo,'entrega_requiere_revision');
  assert.equal((await post({tipo:'cobertura',codigo_entrega:'B-EX',numero_empleado:'006'})).resultados[0].motivo,'turno_incorrecto');
  assert.equal(escrituras,0);
  const legadoConfirmado=await post({numero_empleado:'002',turno:undefined});
  assert.equal(legadoConfirmado.resultados[0].ya_entregado,true);assert.equal(escrituras,0);
  const cierre=await post({numero_empleado:'001',accion:'cierre_ruta',entregado_a:'supervisor',recibido_por:'Responsable QA'});
  assert.equal(cierre.resultados[0].ok,false);assert.equal(cierre.resultados[0].motivo,'entrega_requiere_revision');
  assert.equal(escrituras,0);assert.equal(regulares[0].entregado_en,null);
  const individual=await post({numero_empleado:'001',accion:'entrega',metodo_entrega:'lector',entregado_a:'supervisor',recibido_por:'Responsable QA'});
  assert.equal(individual.resultados[0].ok,true);assert.equal(regulares[0].entregado_a,'supervisor');assert.equal(regulares[0].metodo_entrega,'lector');
  assert.equal(regulares.find(p=>p.numero_empleado==='003').entregado_en,null);assert.equal(item.entregado_en,null);
  const horaOriginal=regulares[0].entregado_en;
  assert.equal((await post({numero_empleado:'001',entregado_en:fecha+'T11:00:00-06:00'})).resultados[0].ya_entregado,true);
  assert.equal(regulares[0].entregado_en,horaOriginal);
  regulares[0].entregado_en=null;cambiarGrupo=true;
  assert.equal((await post({numero_empleado:'001'})).resultados[0].motivo,'grupo_actualizado');
  assert.equal(regulares[0].entregado_en,null);
  const listado=await fetch(url+'/api/entrega/'+fecha+'?zona='+zona+'&turno=turno_b',{headers:{'x-admin-key':'admin-prueba'}});const cuerpo=await listado.json();
  assert.equal(listado.status,200);assert.ok(cuerpo.pedidos.every(p=>p.turno==='turno_b'&&p.zona===zona));
 }finally{
  if(server)await new Promise(r=>server.close(r));await new Promise(r=>base.close(r));Settings.now=reloj;
  for(const k of variables)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];
 }
});
