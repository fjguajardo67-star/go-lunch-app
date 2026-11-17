import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/reportes-excel.js';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';
import { resumirPedidosCocina } from '../services/seleccion-cocina.js';

// Adaptador mínimo de la API de celdas de SheetJS, sin instalar otra copia.
const X={utils:{book_new:()=>({Sheets:{},SheetNames:[]}),book_append_sheet:(wb,ws,n)=>{wb.Sheets[n]=ws;wb.SheetNames.push(n);},aoa_to_sheet:filas=>{
 const ws={};filas.forEach((fila,r)=>fila.forEach((v,c)=>{ws[String.fromCharCode(65+c)+(r+1)]={t:typeof v==='number'?'n':'s',v};}));return ws;
}}};
const f={zona:z=>z,turno:t=>t,servicio:p=>p.tipo,horario:p=>p.entrega_programada_en?'17:30':'10:00',telefono:t=>t||'',filtros:()=> 'Todos los turnos · Todas las zonas · Regulares y coberturas'};
const d=datosReportes(), comidas=unirComidas(d.pedidos,d.solicitudes.map(s=>({...s,items:d.items.filter(i=>i.solicitud_id===s.id)}))),
 resumen=resumirPedidosCocina(d.fecha,comidas);

test('Excel de cocina conserva 61 regulares + 7 coberturas, folios y números con ceros iniciales',()=>{
 const c=GoLunchReportesExcel.cocina(X,f,d.fecha,resumen,comidas), detalle=c.Sheets.Etiquetas;
 assert.equal(detalle.C2.v,'00001');assert.equal(detalle.A63.v,'cobertura');assert.equal(detalle.B63.v,'CE-PRUEBA-4');
 assert.match(detalle.M63.v,/^EX\|/);assert.equal(detalle.C69.v,'00006');assert.equal(detalle.C70,undefined);
 const filas=Object.keys(c.Sheets.Resumen_Cocina).filter(k=>/^A\d+$/.test(k));
 const ultima=filas.find(k=>c.Sheets.Resumen_Cocina[k].v==='TOTAL GENERAL').slice(1);
 assert.equal(c.Sheets.Resumen_Cocina['E'+ultima].v,61);assert.equal(c.Sheets.Resumen_Cocina['F'+ultima].v,7);assert.equal(c.Sheets.Resumen_Cocina['G'+ultima].v,68);
 assert.equal(c.Sheets.Filtros.B1.v,d.fecha+' a '+d.fecha);
});

test('cocina rechaza descargar un detalle que cambió entre consultas',()=>{
 assert.throws(()=>GoLunchReportesExcel.cocina(X,f,d.fecha,resumen,comidas.slice(1)),/conteo cambió/);
});
