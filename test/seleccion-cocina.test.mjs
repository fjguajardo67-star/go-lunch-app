import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizarSeleccionCocina, seleccionarPedidosCocina, resumirPedidosCocina } from '../services/seleccion-cocina.js';

const fecha='2026-11-07';
const pedidos=[
 ['turno_a','zona_vdc','Pollo'],['turno_a','zona_vdc','Pollo'],['turno_a','zona_vdc','Ensalada'],
 ['turno_a','zona_refris','Pollo'],['turno_b','zona_vdc','Pollo'],
 ['turno_b','zona_refris','Ensalada'],['turno_b','zona_refris','Ensalada']
].map(([turno,zona,opcion_texto],i)=>({turno,zona,opcion_texto,empleados:{numero_empleado:String(i+1).padStart(5,'0'),nombre:'Persona de prueba '+i}}));

test('las nueve selecciones cuentan porciones después de filtrar, con subtotales coherentes',()=>{
 for(const [turno,zona,total] of [[null,null,7],['turno_a',null,4],['turno_b',null,3],[null,'zona_vdc',4],[null,'zona_refris',3],['turno_a','zona_vdc',3],['turno_a','zona_refris',1],['turno_b','zona_vdc',1],['turno_b','zona_refris',2]]){
  const r=resumirPedidosCocina(fecha,pedidos,{turno,zona});
  assert.equal(r.total,total,`${turno}/${zona}`);
  assert.equal(r.resumen.reduce((n,x)=>n+x.porciones,0),total);
  for(const p of r.resumen){
   assert.equal(Object.values(p.por_turno).reduce((n,x)=>n+x,0),p.porciones);
   assert.equal(Object.values(p.por_zona).reduce((n,x)=>n+x,0),p.porciones);
  }
 }
 const lote=resumirPedidosCocina(fecha,pedidos,{turno:'turno_a',zona:'zona_vdc'});
 assert.deepEqual(lote.resumen.map(p=>[p.platillo,p.porciones,p.porcentaje]),[['Pollo',2,67],['Ensalada',1,33]]);
 assert.equal(pedidos.length,7);
});
test('todos conserva registros sin asignación; una selección puntual no los mezcla',()=>{
 const datos=[...pedidos,{opcion_texto:'Sin asignación'}];
 assert.equal(seleccionarPedidosCocina(datos).length,8);
 assert.equal(seleccionarPedidosCocina(datos,{turno:'turno_a'}).length,4);
 assert.deepEqual(resumirPedidosCocina(fecha,[],{zona:'zona_vdc'}).resumen,[]);
});
test('rechaza filtros desconocidos o repetidos, sin convertirlos en todos',()=>{
 assert.deepEqual(normalizarSeleccionCocina({turno:'todos',zona:'todas'}),{turno:null,zona:null});
 for(const f of [{turno:'turno_c'},{zona:'otra'},{turno:['turno_a','turno_b']},{zona:{nombre:'ASLA'}},{turno:'__proto__'}])assert.throws(()=>normalizarSeleccionCocina(f),e=>e.status===400);
});
test('servicios reales comparten selección y generan la misma cantidad de etiquetas y porciones',async()=>{
 let consultas=0;
 const server=http.createServer((req,res)=>{consultas++;res.setHeader('content-type','application/json');res.end(JSON.stringify(pedidos))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 process.env.SUPABASE_URL=`http://127.0.0.1:${server.address().port}`;
 process.env.SUPABASE_KEY='solo-prueba';
 try{
  const {resumenCocina,etiquetas,htmlComanda,htmlEtiquetas}=await import('../services/cocina.js');
  const filtros={turno:'turno_a',zona:'zona_refris'};
  const resumen=await resumenCocina(fecha,filtros);
  const datos=await etiquetas(fecha,filtros);
  assert.equal(resumen.total,1);assert.equal(datos.pedidos.length,resumen.total);
  const comanda=htmlComanda(resumen,{ancho:58});
  assert.match(comanda,/Turno A · REFIS \(LZCR\)/);
  assert.doesNotMatch(comanda,/Turno B|Ensalada|ASLA/);
  assert.match(comanda,/<span>TOTAL PORCIONES<\/span><span>1<\/span>/);
  const html=htmlEtiquetas(datos);
  assert.equal((html.match(/class="etiqueta"/g)||[]).length,1);
  assert.match(html,/data-codigo="00004\|2026-11-07"/);
  assert.doesNotMatch(html,/data-codigo="00001\|/);
  assert.match(html,/Turno A · REFIS \(LZCR\)/);
  assert.match(html,/1 comida\(s\)/);
  const ayuda=html.match(/<div class="ayuda">([\s\S]*?)<\/div>/)[1];
  assert.doesNotMatch(ayuda,/grid-template|padding:|@media/);
  const ninguna=htmlEtiquetas({fecha,pedidos:[],filtros});
  assert.match(ninguna,/Sin pedidos para esta fecha y selección/);
  assert.doesNotMatch(ninguna,/class="etiqueta"/);
  const previas=consultas;
  await assert.rejects(()=>resumenCocina(fecha,{zona:'invalida'}),e=>e.status===400);
  await assert.rejects(()=>etiquetas(fecha,{turno:['turno_a']}),e=>e.status===400);
  assert.equal(consultas,previas,'Un filtro inválido se rechaza antes de consultar la base');
  assert.equal((await resumenCocina(fecha)).total,7,'Sin filtros se conserva el día completo');
 }finally{await new Promise(resolve=>server.close(resolve))}
});
