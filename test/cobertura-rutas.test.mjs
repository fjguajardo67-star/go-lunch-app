import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { Settings } from 'luxon';
import { hashClave } from '../services/sesion.js';

// HTTP real hasta el router y supabase-js, con datos ficticios locales.
test('panel consulta coberturas por turno y supervisor puede iniciar sesión después del corte',async()=>{
 const ahoraOriginal=Settings.now;
 const variables=['SUPABASE_URL','SUPABASE_KEY','ADMIN_KEY','SUPERVISOR_SESSION_SECRET'];
 const originales=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
 Settings.now=()=>Date.parse('2026-11-06T22:00:00-06:00');
 const empleado={telefono:'TEST-EMPLEADO',numero_empleado:'00001',nombre:'Supervisor de prueba',activo:true};
 const supervisor={id:1,empleado_telefono:empleado.telefono,activo:true,vigente_desde:'2026-01-01',vigente_hasta:null,version_sesion:1,clave_hash:await hashClave('clave-solo-prueba'),empleados:empleado};
 const solicitudes=[{id:10,supervisor_id:1,turno:'turno_a',fecha_servicio:'2026-11-06',estado:'confirmada',total_porciones:1},{id:20,supervisor_id:1,turno:'turno_b',fecha_servicio:'2026-11-06',estado:'confirmada',total_porciones:2}];
 const base=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://prueba');let datos=[];
  if(url.pathname.endsWith('/empleados'))datos=[empleado];
  if(url.pathname.endsWith('/supervisores_cobertura'))datos=[supervisor];
  if(url.pathname.endsWith('/menus_cobertura'))datos=[{fecha:'2026-11-06',activo:true,opcion_1:'Pollo',opcion_2:'Ensalada',opcion_3:'Pescado'}];
  if(url.pathname.endsWith('/solicitudes_cobertura')){
   const turno=url.searchParams.get('turno')?.replace('eq.','');
   datos=solicitudes.filter(s=>!turno||s.turno===turno);
  }
  res.setHeader('content-type','application/json');res.end(JSON.stringify(datos));
 });
 await new Promise(resolve=>base.listen(0,'127.0.0.1',resolve));
 process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;
 process.env.SUPABASE_KEY='solo-prueba';process.env.ADMIN_KEY='admin-solo-prueba';process.env.SUPERVISOR_SESSION_SECRET='secreto-ficticio-solo-para-pruebas';
 let server;
 try{
  const {adminRouter}=await import('../routes/admin.js');
  const {coberturaRouter}=await import('../routes/cobertura.js');
  const app=express();app.use(express.json());app.use('/api',adminRouter);app.use('/cobertura',coberturaRouter);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const consulta=async query=>{
   const r=await fetch(url+'/api/cobertura/solicitudes/2026-11-06'+query,{headers:{'x-admin-key':process.env.ADMIN_KEY}});
   return {status:r.status,body:await r.json()};
  };
  const a=await consulta('?turno=turno_a');
  assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.total_porciones,1);assert.equal(a.body.solicitudes[0].turno,'turno_a');
  assert.deepEqual(a.body.por_turno.map(t=>[t.turno,t.total_porciones]),[['turno_a',1],['turno_b',2]]);
  const b=await consulta('?turno=turno_b');assert.equal(b.status,200);assert.equal(b.body.total_porciones,2);
  const defecto=await consulta('');assert.equal(defecto.body.turno,'turno_b');
  assert.equal((await consulta('?turno=turno_c')).status,400);
  assert.equal((await consulta('?turno=turno_a&turno=turno_b')).status,400);
  assert.equal((await fetch(url+'/api/cobertura/solicitudes/2026-11-06')).status,401);
  const login=await fetch(url+'/cobertura/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({numero_empleado:'00001',clave:'clave-solo-prueba'})});
  const sesion=await login.json();assert.equal(login.status,200,JSON.stringify(sesion));assert.ok(sesion.token);
  for(const turno of ['turno_a','turno_b']){
   const r=await fetch(url+'/cobertura/estado?turno='+turno,{headers:{authorization:'Bearer '+sesion.token}});
   const estado=await r.json();assert.equal(r.status,200,JSON.stringify(estado));
   assert.equal(estado.supervisor.numero_empleado,'00001');assert.equal(estado.turno,turno);
   assert.equal(estado.abierto,false);assert.equal(estado.motivo,'fuera_de_horario');
  }
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await new Promise(resolve=>base.close(resolve));Settings.now=ahoraOriginal;
  for(const k of variables)if(originales[k]===undefined)delete process.env[k];else process.env[k]=originales[k];
 }
});
