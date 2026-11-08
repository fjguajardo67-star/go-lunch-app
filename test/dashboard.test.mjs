import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {construirDashboard} from '../services/dashboard.js';
import {datosDashboard} from './fixtures/dashboard.mjs';

test('61 regulares y 4 coberturas suman 65 comidas de 62 empleados, sin sobrescribir filas',()=>{
  const d=datosDashboard(), r=construirDashboard(d);
  assert.deepEqual({...r.resumen},{activos:131,ordenaron:62,no_ordenaron:69,total_comidas:65,regulares:61,coberturas:4,
    vieron_no_ordenaron:12,no_abrieron:57,sin_dato:0,accesos_ok:true,entregados:65,pendientes:0,tardias:3});
  assert.equal(r.filas.length,134);
  for(const numero of ['00001','00002','00003'])assert.deepEqual(r.filas.filter(f=>f.numero_empleado===numero).map(f=>f.tipo),['regular','cobertura']);
  assert.equal(r.filas.filter(f=>f.numero_empleado==='00062').length,1);
});

test('cada servicio conserva estado propio y las canceladas no cuentan',()=>{
  const d=datosDashboard();d.coberturas[0].entregado_en=null;
  d.coberturas.push({...d.coberturas[0],estado_solicitud:'cancelada'});
  const r=construirDashboard(d);
  assert.equal(r.resumen.total_comidas,65);assert.equal(r.resumen.coberturas,4);
  assert.equal(r.resumen.entregados,64);assert.equal(r.resumen.pendientes,1);assert.equal(r.resumen.ordenaron,62);
  const persona=r.filas.filter(f=>f.numero_empleado==='00001');
  assert.equal(persona.find(f=>f.tipo==='regular').estado,'tardia');assert.equal(persona.find(f=>f.tipo==='cobertura').estado,'pendiente');
});

test('las extraordinarias usan la hora autorizada y conservan el nombre capturado',()=>{
  const d=datosDashboard(), p=d.coberturas[0];
  Object.assign(p,{origen:'extraordinaria',entrega_programada_en:d.fecha+'T18:20:00-06:00',entregado_en:d.fecha+'T18:35:00-06:00',empleado_nombre_snapshot:'Nombre al solicitar'});
  let r=construirDashboard(d), f=r.filas.find(f=>f.folio===p.folio&&f.numero_empleado===p.empleado_numero_snapshot);
  assert.equal(f.estado,'entregado');assert.equal(f.nombre,'Nombre al solicitar');assert.equal(f.origen,'extraordinaria');
  p.entregado_en=d.fecha+'T18:35:01-06:00';
  r=construirDashboard(d);assert.equal(r.filas.find(f=>f.tipo==='cobertura'&&f.numero_empleado===p.empleado_numero_snapshot).estado,'tardia');
});

test('las comidas históricas siguen aunque la persona esté inactiva; los accesos fallidos no se inventan',()=>{
  const d=datosDashboard();d.empleados=d.empleados.filter(e=>e.numero_empleado!=='00001');d.accesos=[];d.accesosOk=false;
  const r=construirDashboard(d);
  assert.equal(r.resumen.activos,130);assert.equal(r.resumen.ordenaron,61);assert.equal(r.resumen.total_comidas,65);
  assert.equal(r.filas.filter(f=>f.numero_empleado==='00001').length,2);
  assert.equal(r.resumen.no_abrieron,0);assert.equal(r.resumen.sin_dato,69);assert.equal(r.resumen.accesos_ok,false);
  const sinActivos=construirDashboard({...d,empleados:[]});assert.equal(sinActivos.resumen.total_comidas,65);assert.equal(sinActivos.filas.length,65);
});

test('variantes telefónicas y coberturas sin teléfono se unen al empleado correcto',()=>{
  const fecha='2026-11-07',emp={telefono:'5215512345678',numero_empleado:'00001',nombre:'Persona',activo:true};
  const r=construirDashboard({fecha,empleados:[emp],pedidos:[{empleado_telefono:'525512345678',empleados:emp,turno:'turno_a',zona:'zona_refris'}],
    coberturas:[{empleado_numero_snapshot:'00001',empleado_nombre_snapshot:'Persona',turno:'turno_b',zona:'zona_refris'}]});
  assert.equal(r.resumen.ordenaron,1);assert.equal(r.resumen.total_comidas,2);assert.equal(r.filas.length,2);
});

test('API integra ambas fuentes para gerente y admin; no oculta fallos de coberturas',async()=>{
  const d=datosDashboard(), claves=['SUPABASE_URL','SUPABASE_KEY','ADMIN_KEY','GERENTE_KEY'];
  const prev=Object.fromEntries(claves.map(k=>[k,process.env[k]]));let falla=false;
  const base=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://prueba'), tabla=u.pathname.split('/').at(-1);res.setHeader('content-type','application/json');
    if(falla&&tabla==='solicitudes_cobertura'){res.statusCode=500;res.end(JSON.stringify({message:'No se pudieron leer coberturas'}));return;}
    let filas=tabla==='empleados'?d.empleados:tabla==='pedidos'?d.pedidos:tabla==='solicitudes_cobertura'?[d.solicitud]:tabla==='solicitudes_cobertura_items'?d.items:tabla==='accesos'?d.accesos:[];
    filas=filas.filter(f=>[...u.searchParams].every(([k,v])=>v.startsWith('eq.')?String(f[k])===v.slice(3):v.startsWith('in.(')?v.slice(4,-1).split(',').includes(String(f[k])):true));
    res.end(JSON.stringify(filas));
  });
  await new Promise(r=>base.listen(0,'127.0.0.1',r));process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;
  process.env.SUPABASE_KEY='solo-prueba';process.env.ADMIN_KEY='admin-solo-prueba';process.env.GERENTE_KEY='gerente-solo-prueba';let servidor;
  try {
    const {adminRouter}=await import('../routes/admin.js');const app=express();app.use('/api',adminRouter);servidor=app.listen(0,'127.0.0.1');await new Promise(r=>servidor.once('listening',r));
    const url=`http://127.0.0.1:${servidor.address().port}/api/dashboard/`;
    for(const [usuario,clave] of [['admin',process.env.ADMIN_KEY],['gerente',process.env.GERENTE_KEY]]){
      const r=await fetch(url+d.fecha,{headers:{'x-panel-user':usuario,'x-admin-key':clave}});assert.equal(r.status,200);
      const b=await r.json();assert.equal(b.resumen.total_comidas,65);assert.equal(b.resumen.ordenaron,62);assert.equal(b.resumen.coberturas,4);
    }
    assert.equal((await fetch(url+d.fecha)).status,401);
    const otro=await fetch(url+'2026-11-08',{headers:{'x-admin-key':process.env.ADMIN_KEY}});assert.equal((await otro.json()).resumen.total_comidas,0);
    falla=true;const roto=await fetch(url+d.fecha,{headers:{'x-admin-key':process.env.ADMIN_KEY}});assert.equal(roto.status,500);
  } finally {
    if(servidor)await new Promise(r=>servidor.close(r));await new Promise(r=>base.close(r));
    for(const k of claves)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];
  }
});
