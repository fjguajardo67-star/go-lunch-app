import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DateTime } from 'luxon';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas, contarServicios, tardiaComida } from '../services/comidas.js';
import { construirReporte } from '../services/reportes.js';
import { resumirPedidosCocina } from '../services/seleccion-cocina.js';

function comidas(d) {return unirComidas(d.pedidos,d.solicitudes.map(s=>({...s,items:d.items.filter(i=>i.solicitud_id===s.id)})));}

test('el consolidado conserva 68 comidas, 7 QR especiales y los nombres históricos, sin duplicar canceladas',()=>{
 const d=datosReportes(), c=comidas(d), r=construirReporte(d.fecha,d.fecha,c,DateTime.fromISO('2026-11-08T12:00:00-06:00'));
 assert.deepEqual(contarServicios(c),{regulares:61,coberturas:7,total:68});
 assert.equal(new Set(c.map(p=>p.clave_servicio)).size,68);
 assert.equal(c.filter(p=>p.codigo_etiqueta.startsWith('EX|')).length,7);
 assert.equal(c.filter(p=>p.empleados.numero_empleado==='00001').length,2);
 assert.equal(r.total,68);assert.equal(r.regulares+r.coberturas,r.total);
 assert.equal(r.pedidos_por_dia[0].total,68);
 assert.equal(r.porciones_por_platillo.reduce((n,p)=>n+p.porciones,0),68);
 assert.equal(r.entrega.entregados+r.entrega.tardios+r.entrega.indeterminados+r.entrega.no_entregados,68);
 assert.equal(r.rating_elegibles,61);assert.equal(r.rating.sin_responder,61);
 assert.equal(r.rating_por_platillo.reduce((n,p)=>n+p.porciones,0),61);
 const resumen=resumirPedidosCocina(d.fecha,c);
 assert.equal(resumen.grupos.filter(g=>g.turno==='turno_a').reduce((n,g)=>n+g.total,0),52);
 assert.equal(resumen.grupos.filter(g=>g.turno==='turno_b').reduce((n,g)=>n+g.total,0),16);
 assert.equal(resumen.grupos.find(g=>g.horario==='17:30').total,3);
});

test('extraordinarias pendientes y puntualidad se evalúan contra su hora autorizada; datos incompletos no se presumen puntuales',()=>{
 const d=datosReportes(), p=comidas(d).find(p=>p.origen==='extraordinaria');
 p.entregado_en=d.fecha+'T17:45:00-06:00';assert.equal(tardiaComida(p),false);
 p.entregado_en=d.fecha+'T17:45:01-06:00';assert.equal(tardiaComida(p),true);
 p.entregado_en=null;
 const r=construirReporte(d.fecha,d.fecha,[p],DateTime.fromISO(d.fecha+'T17:20:00-06:00'));
 assert.equal(r.entrega.pendientes,1);assert.equal(r.merma.por_turno.length,0);
 p.entregado_en=d.fecha+'T17:45:01-06:00';p.entrega_programada_en='invalida';
 assert.equal(construirReporte(d.fecha,d.fecha,[p]).entrega.indeterminados,1);
});

test('API, cocina, checklist y etiquetas comparten filtros y no entregan totales parciales al fallar coberturas',async()=>{
 let d=datosReportes(), falla=false, consultas=0;
 const base=http.createServer((req,res)=>{
  assert.equal(req.method,'GET','Las pruebas no escriben datos');consultas++;
  const u=new URL(req.url,'http://prueba'), t=u.pathname.split('/').at(-1);res.setHeader('content-type','application/json');
  if(falla&&t==='solicitudes_cobertura'){res.statusCode=500;res.end('{"message":"Fallo de cobertura simulado"}');return;}
  let filas=({pedidos:d.pedidos,empleados:d.empleados,accesos:d.accesos,solicitudes_cobertura:d.solicitudes,solicitudes_cobertura_items:d.items})[t]||[];
  filas=filas.filter(f=>[...u.searchParams].every(([k,v])=>v.startsWith('eq.')?String(f[k])===v.slice(3):v.startsWith('gte.')?String(f[k])>=v.slice(4):v.startsWith('lte.')?String(f[k])<=v.slice(4):v.startsWith('in.(')?v.slice(4,-1).split(',').includes(String(f[k])):true));
  const desde=Number(u.searchParams.get('offset')||0),limite=Number(u.searchParams.get('limit')||1000);
  res.end(JSON.stringify(filas.slice(desde,desde+limite)));
 });
 await new Promise(r=>base.listen(0,'127.0.0.1',r));
 process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;process.env.SUPABASE_KEY='solo-prueba';
 process.env.ADMIN_KEY='admin-prueba';process.env.GERENTE_KEY='gerente-prueba';
 const {adminRouter}=await import('../routes/admin.js');const {entregaRouter}=await import('../routes/entrega.js');
 const {resumenCocina,etiquetas,htmlEtiquetas,checklistReparto,htmlComanda}=await import('../services/cocina.js');
 const app=express();app.use('/api/entrega',entregaRouter);app.use('/api',adminRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const get=(p,clave=process.env.ADMIN_KEY)=>fetch(`http://127.0.0.1:${server.address().port}/api`+p,{headers:{'x-admin-key':clave}});
 try{
  for(const ruta of ['/comidas/'+d.fecha,'/comidas?ini='+d.fecha+'&fin='+d.fecha]){
   const req=await get(ruta,process.env.GERENTE_KEY);assert.equal(req.status,200);assert.equal((await req.json()).count,68);
   assert.equal((await get(ruta,'')).status,401);
  }
  for(const turno of ['', 'turno_a','turno_b'])for(const zona of ['', 'zona_refris','zona_vdc'])for(const servicio of ['', 'regular','cobertura']){
   const filtros={turno,zona,servicio}, q=new URLSearchParams(filtros), resumen=await resumenCocina(d.fecha,filtros);
   const esperado=resumirPedidosCocina(d.fecha,comidas(d),filtros).total;
   const r=await get('/reportes?ini='+d.fecha+'&fin='+d.fecha+'&'+q);assert.equal(r.status,200);assert.equal((await r.json()).total,esperado);
   assert.equal(resumen.total,esperado);assert.equal((await checklistReparto(d.fecha,filtros)).total,esperado);
   assert.equal((await etiquetas(d.fecha,filtros)).pedidos.length,esperado);
  }
  const etiquetasHTML=htmlEtiquetas(await etiquetas(d.fecha));
  assert.equal((etiquetasHTML.match(/class="etiqueta"/g)||[]).length,68);
  assert.equal((etiquetasHTML.match(/data-codigo="EX\|/g)||[]).length,7);
  assert.equal((etiquetasHTML.match(/transform:scale\(0\.85\)/g)||[]).length,7);
  assert.match(etiquetasHTML,/@page \{ size: 100mm 62mm/);
  assert.match(etiquetasHTML,/data-codigo="00001\|2026-11-07"/);
  assert.match(htmlComanda(await resumenCocina(d.fecha)),/Regulares: 61 \+ Coberturas: 7 = 68/);
  const antes=consultas;
  for(const ruta of ['/comidas/2026-02-30','/reportes?ini=2026-11-08&fin=2026-11-07','/comidas/'+d.fecha+'?servicio=no-existe'])assert.equal((await get(ruta)).status,400);
  assert.equal(consultas,antes);
  falla=true;
  for(const ruta of ['/comidas/'+d.fecha,'/reportes?ini='+d.fecha+'&fin='+d.fecha,'/resumen-cocina/'+d.fecha])assert.equal((await get(ruta)).status,500);
  assert.equal((await get('/entrega/'+d.fecha)).status,503);
  falla=false;
  // Más de 1000 filas por tabla: la API debe leer todas las páginas.
  const semilla=d.pedidos[0], item=d.items[0];
  d={...d,pedidos:Array.from({length:1001},(_,i)=>({...semilla,id:i+1})),solicitudes:[d.solicitudes[0]],items:Array.from({length:1001},(_,i)=>({...item,id:i+1}))};
  const grande=await (await get('/comidas/'+d.fecha)).json();assert.equal(grande.count,2002);
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>base.close(r));}
});
