import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prepararChecklistReparto, htmlChecklistReparto } from '../services/checklist-reparto.js';

const fecha='2026-11-07';
const pedido=(i,turno='turno_a',zona='zona_vdc',nombre='Persona '+String(i).padStart(3,'0'))=>({turno,zona,empleados:{numero_empleado:String(i).padStart(5,'0'),nombre}});

test('cada zona y turno genera su propio lote, con horario correcto',()=>{
 const pedidos=[pedido(4,'turno_b','zona_vdc'),pedido(2,'turno_a','zona_refris'),pedido(3,'turno_b','zona_refris'),pedido(1)];
 const datos=prepararChecklistReparto(fecha,pedidos);
 assert.equal(datos.total,4);assert.equal(datos.lotes.length,4);assert.equal(datos.paginas.length,4);
 assert.deepEqual(datos.lotes.map(l=>[l.turno,l.zona,l.horario]),[['turno_a','zona_refris','10:00 AM'],['turno_a','zona_vdc','10:00 AM'],['turno_b','zona_refris','5:00 PM'],['turno_b','zona_vdc','6:00 PM']]);
 const uno=prepararChecklistReparto(fecha,pedidos,{turno:'turno_b',zona:'zona_vdc'});
 assert.equal(uno.total,1);assert.equal(uno.paginas[0].filas[0].numero,'00004');
 assert.equal(pedidos[0].empleados.numero_empleado,'00004');
});
test('paginar conserva todas las filas y una sola firma por lote',()=>{
 const pedidos=Array.from({length:43},(_,i)=>pedido(i));
 const datos=prepararChecklistReparto(fecha,pedidos);
 assert.deepEqual(datos.paginas.map(p=>p.filas.length),[14,14,14,1]);
 assert.deepEqual(datos.paginas.map(p=>[p.hoja,p.hojas,p.ultima]),[[1,4,false],[2,4,false],[3,4,false],[4,4,true]]);
 assert.deepEqual(datos.paginas.flatMap(p=>p.filas.map(f=>f.numero)),pedidos.map(p=>p.empleados.numero_empleado));
 const html=htmlChecklistReparto(datos);
 assert.equal((html.match(/class="firma-salida"/g)||[]).length,1);
 assert.equal((html.match(/class="casilla"/g)||[]).length,43);
 assert.equal((html.match(/Servicio: <b>07\/11\/2026<\/b>/g)||[]).length,4);
 assert.match(html,/Hoja 4 de 4/);assert.match(html,/Total del lote: <b>43<\/b>/);
 assert.match(html,/@page\{size:letter portrait;margin:14mm\}/);
});
test('la lista usa solo pedidos, conserva ceros iniciales y escapa HTML de los nombres',()=>{
 const datos=prepararChecklistReparto(fecha,[pedido(7,'turno_a','zona_vdc','</td><script>ataque()</script>')]);
 const html=htmlChecklistReparto(datos);
 assert.match(html,/<td>00007<\/td>/);assert.match(html,/&lt;script&gt;ataque\(\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script>|Firma del empleado/);
 const vacio=htmlChecklistReparto(prepararChecklistReparto(fecha,[]));
 assert.match(vacio,/Sin pedidos para esta fecha y selección/);
 assert.doesNotMatch(vacio,/class="firma-salida"|class="casilla"/);
 const sinZona=prepararChecklistReparto(fecha,[{empleados:{numero_empleado:'001',nombre:'Sin asignación'}}]);
 assert.equal(sinZona.total,1);assert.equal(sinZona.lotes[0].horario,'Por confirmar');
});
test('ordena por opción, número numérico y nombre sin perder ceros iniciales',()=>{
 const datos=prepararChecklistReparto(fecha,[
  {...pedido(1,'turno_a','zona_vdc','Primero por nombre pero opción B'),opcion_id:'fija_b',opcion_texto:'Arroz'},
  {...pedido(10,'turno_a','zona_vdc','Ana'),opcion_id:'fija_a',opcion_texto:'Zanahoria'},
  {...pedido(2,'turno_a','zona_vdc','Zulema'),opcion_id:'fija_a',opcion_texto:'Zanahoria'},
  {...pedido(2,'turno_a','zona_vdc','Alba'),opcion_id:'fija_a',opcion_texto:'Zanahoria'},
  {...pedido(1,'turno_a','zona_vdc','Primero pero variable'),opcion_id:'var_1',opcion_texto:'Pollo'}
 ]);
 assert.deepEqual(datos.lotes[0].filas.map(f=>[f.opcion_id,f.numero,f.nombre]),[
  ['fija_a','00002','Alba'],['fija_a','00002','Zulema'],['fija_a','00010','Ana'],
  ['fija_b','00001','Primero por nombre pero opción B'],['var_1','00001','Primero pero variable']
 ]);
 const html=htmlChecklistReparto(datos);
 assert.match(html,/<th scope="col">Opción del menú<\/th><th scope="col">N.º empleado<\/th><th scope="col">Nombre del empleado/);
 assert.equal((html.match(/class="opcion-grupo"/g)||[]).length,3);
 assert.match(html,/Opción A · Zanahoria/);assert.match(html,/Total de esta opción: 3/);
 assert.equal((html.match(/class="firma-salida"/g)||[]).length,1);
});
test('conserva platillos originales distintos de una misma opción y repite el grupo al continuar',()=>{
 const pedidos=Array.from({length:20},(_,i)=>({...pedido(i),opcion_id:'fija_a',opcion_texto:i<10?'Pollo & arroz':'Pollo con verduras'}));
 const datos=prepararChecklistReparto(fecha,pedidos);
 assert.equal(Object.keys(datos.lotes[0].por_opcion).length,2);
 assert.deepEqual(Object.values(datos.lotes[0].por_opcion),[10,10]);
 const html=htmlChecklistReparto(datos);
 assert.match(html,/Pollo &amp; arroz/);assert.match(html,/Pollo con verduras/);
 assert.equal(datos.paginas.flatMap(p=>p.filas).length,20);
 for(const pagina of datos.paginas){
  assert.ok(pagina.filas.length);
  assert.equal(pagina.lote.por_opcion[pagina.filas[0].opcion_clave],10);
 }
});
test('fecha y selección inválidas se rechazan',()=>{
 for(const dia of ['2026-02-30','07/11/2026','2026-13-01',null])assert.throws(()=>prepararChecklistReparto(dia,[]),e=>e.status===400);
 assert.throws(()=>prepararChecklistReparto(fecha,[],{turno:['turno_a']}),e=>e.status===400);
});
test('endpoint exige clave, acepta gerente y filtra el lote antes de imprimir',async()=>{
 let consultas=0;
 const base=http.createServer((q,r)=>{consultas++;assert.match(q.url,/^\/rest\/v1\/pedidos\?/);r.setHeader('content-type','application/json');r.end(JSON.stringify([pedido(1),pedido(2,'turno_b','zona_refris')]))});
 await new Promise(resolve=>base.listen(0,'127.0.0.1',resolve));
 process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;process.env.SUPABASE_KEY='solo-prueba';
 process.env.ADMIN_KEY='admin-prueba';process.env.GERENTE_KEY='gerente-prueba';
 let server;
 try{
  const {checklistRepartoRouter}=await import('../routes/checklist-reparto.js');
  const app=express();app.use('/checklist-reparto',checklistRepartoRouter);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/checklist-reparto/`;
  assert.equal((await fetch(url+fecha)).status,401);assert.equal(consultas,0);
  for(const clave of ['admin-prueba','gerente-prueba']){
   const r=await fetch(url+fecha+'?key='+clave+'&turno=turno_b&zona=zona_refris');
   assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);
   const html=await r.text();assert.match(html,/<td>00002<\/td>/);assert.doesNotMatch(html,/<td>00001<\/td>/);
   assert.match(html,/REFIS \(LZCR\)/);assert.match(html,/5:00 PM/);
   assert.equal((html.match(/class="firma-salida"/g)||[]).length,1);
  }
  const previas=consultas;
  for(const ruta of ['2026-02-30?key=admin-prueba',fecha+'?key=admin-prueba&turno=no-existe',fecha+'?key=admin-prueba&zona=zona_vdc&zona=zona_refris'])assert.equal((await fetch(url+ruta)).status,400);
  assert.equal(consultas,previas);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>base.close(resolve))}
});
