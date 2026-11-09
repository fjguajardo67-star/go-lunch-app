import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DateTime, Settings } from 'luxon';
import { ventanaLoteCobertura } from '../services/ventana-cobertura.js';
import { emitirTokenSupervisor } from '../services/sesion.js';

test('los lotes conservan horario propio y cierran cambios exactamente dos horas antes, sin reabrir entregas', () => {
  const s = {fecha_servicio:'2026-11-09',turno:'turno_a',zona:'zona_refris',origen:'supervisor',estado:'confirmada',entrega_programada_en:'2026-11-09T17:30:00-06:00',items:[]};
  const reloj = iso => DateTime.fromISO('2026-11-09T' + iso + '-06:00');
  assert.equal(ventanaLoteCobertura(s,reloj('15:30:00')).editable,true);
  assert.equal(ventanaLoteCobertura(s,reloj('15:30:00.001')).editable,false);
  assert.equal(ventanaLoteCobertura({...s,items:[{entregado_en:'2026-11-09T12:00:00-06:00'}]},reloj('12:00:00')).editable,false);
  for (const estado of ['cancelada','entregada']) assert.equal(ventanaLoteCobertura({...s,estado},reloj('12:00:00')).editable,false);
  const legado = ventanaLoteCobertura({...s,entrega_programada_en:null,turno:'turno_b',zona:'zona_vdc'},reloj('15:00:00'));
  assert.equal(legado.entrega_programada_en,'2026-11-09T18:00:00.000-06:00');
  assert.equal(legado.limite_cambios_en,'2026-11-09T16:00:00.000-06:00');
  assert.equal(ventanaLoteCobertura({...s,origen:'extraordinaria'},reloj('12:00:00')).editable,false);
});

test('API de supervisor conserva varios folios propios y deriva la identidad de la sesión, con autorización y errores de anticipación', async () => {
  const originalAhora=Settings.now;Settings.now=()=>Date.parse('2026-11-09T15:00:00-06:00');
  process.env.SUPERVISOR_SESSION_SECRET='secreto-local-solo-prueba';
  const empleado={telefono:'qa-super',numero_empleado:'00001',nombre:'Supervisor de prueba',activo:true};
  const supervisor={id:1,empleado_telefono:empleado.telefono,activo:true,vigente_desde:'2026-01-01',vigente_hasta:null,version_sesion:1,empleados:empleado};
  const solicitudes=[
    {id:10,supervisor_id:1,fecha_servicio:'2026-11-09',origen:'supervisor',estado:'confirmada',turno:'turno_a',zona:'zona_refris',entrega_programada_en:'2026-11-09T17:00:00-06:00',actualizado_en:'2026-11-09T14:00:00-06:00',total_porciones:1},
    {id:11,supervisor_id:1,fecha_servicio:'2026-11-09',origen:'supervisor',estado:'confirmada',turno:'turno_b',zona:'zona_vdc',entrega_programada_en:'2026-11-09T18:30:00-06:00',actualizado_en:'2026-11-09T14:00:00-06:00',total_porciones:1},
    {id:12,supervisor_id:2,fecha_servicio:'2026-11-09',origen:'supervisor',estado:'confirmada',turno:'turno_a',zona:'zona_refris',total_porciones:1}
  ];
  let rpc=null, rechazo=false, lecturas=0;
  const base=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://prueba'),tabla=u.pathname.split('/').at(-1);res.setHeader('content-type','application/json');
    if(req.method==='POST'){
      let body='';for await(const c of req)body+=c;rpc={nombre:tabla,datos:JSON.parse(body)};
      if(rechazo){res.statusCode=400;res.end('{"code":"P0001","message":"anticipacion_cobertura_insuficiente"}');return;}
      res.end(JSON.stringify([{...solicitudes[1],folio:'CE-PRUEBA-11'}]));return;
    }
    lecturas++;
    let filas=({supervisores_cobertura:[supervisor],menus_cobertura:[{fecha:'2026-11-09',activo:true,opcion_1:'Pollo QA',opcion_2:'Pescado QA',opcion_3:'Ensalada QA'}],solicitudes_cobertura:solicitudes,solicitudes_cobertura_items:[]})[tabla]||[];
    filas=filas.filter(f=>[...u.searchParams].every(([k,v])=>v.startsWith('eq.')?String(f[k])===v.slice(3):v.startsWith('in.(')?v.slice(4,-1).split(',').includes(String(f[k])):true));
    res.end(JSON.stringify(filas));
  });
  await new Promise(r=>base.listen(0,'127.0.0.1',r));
  process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;process.env.SUPABASE_KEY='solo-prueba';
  const {coberturaRouter}=await import('../routes/cobertura.js');
  const {validarEntradaLote}=await import('../services/lotes-cobertura.js');
  const app=express();app.use(express.json());app.use('/cobertura',coberturaRouter);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/cobertura`,token=emitirTokenSupervisor(supervisor);
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const entrada={fecha:'2026-11-09',turno:'turno_b',zona:'zona_vdc',hora_entrega:'18:30',responsable_numero:'00001',items:[{numero_empleado:'00002',opcion_id:'especial_1'}],idempotencia:'00000000-0000-4000-8000-000000000001'};
  try{
    assert.equal((await fetch(url+'/lotes')).status,401);assert.equal(lecturas,0);
    let res=await fetch(url+'/lotes',{headers});assert.equal(res.status,200);
    const estado=await res.json();assert.equal(estado.solicitudes.length,2);assert.equal(estado.abierto,true);assert.equal(estado.hora_minima,'17:00');
    assert.deepEqual(estado.solicitudes.map(s=>s.id),[10,11]);
    for(const [ruta,method] of [['/lotes','POST'],['/lotes/11','PUT'],['/lotes/11','DELETE']]){
      res=await fetch(url+ruta,{method,headers,body:JSON.stringify({...entrada,supervisor_id:2,ignorar_anticipacion:true,version:solicitudes[1].actualizado_en})});
      assert.equal(res.status,200,await res.text());assert.equal(rpc.datos.p_supervisor_id,1);assert.equal(rpc.datos.ignorar_anticipacion,undefined);
      if(method==='PUT')assert.equal(rpc.datos.p_solicitud_id,11);
    }
    rechazo=true;res=await fetch(url+'/lotes',{method:'POST',headers,body:JSON.stringify(entrada)});assert.equal(res.status,409);assert.match((await res.json()).error,/dos horas/);
    for(const cambio of [{fecha:'2026-11-10'},{hora_entrega:'5:30'},{turno:'otro'},{idempotencia:'sin-id'},{items:[...entrada.items,...entrada.items]}])assert.throws(()=>validarEntradaLote({...entrada,...cambio}));
    Settings.now=()=>Date.parse('2026-11-09T22:01:00-06:00');
    res=await fetch(url+'/lotes',{headers});const tarde=await res.json();assert.equal(tarde.abierto,false);assert.equal(tarde.motivo,'sin_ventana_hoy');assert.equal(tarde.solicitudes.length,2);
  }finally{Settings.now=originalAhora;await new Promise(r=>server.close(r));await new Promise(r=>base.close(r));}
});
