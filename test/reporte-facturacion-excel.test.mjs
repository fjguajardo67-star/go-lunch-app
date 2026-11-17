import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DateTime } from 'luxon';
import { crearExcelFacturacion, validarCostoFacturacion } from '../services/reporte-facturacion-excel.js';
import { crearExcelOperacion } from '../services/reporte-operacion-excel.js';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';

const base = () => {
  const d = datosReportes();
  return unirComidas(d.pedidos, d.solicitudes.map(s => ({ ...s, items: d.items.filter(i => i.solicitud_id === s.id) })));
};
const abrir = async resultado => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(resultado.buffer); return wb;
};
const resultado = c => c.result ?? c.value;

test('facturación lleva logos, títulos, selección y nombres/números sin perder comidas de la misma persona', async () => {
  const w = await abrir(await crearExcelFacturacion('2026-11-07','2026-11-07',118,base()));
  assert.deepEqual(w.worksheets.map(s => s.name), ['Resumen_Facturacion','Auditoria_Detalle']);
  for (const s of w.worksheets) {
    assert.equal(s.getImages().length,3); assert.match(s.getCell('A6').value,/facturación/);
    assert.match(s.getCell('A7').value,/07\/11\/2026/); assert.match(s.getCell('A8').value,/Regulares y coberturas/);
  }
  const a=w.getWorksheet('Auditoria_Detalle'),s=w.getWorksheet('Resumen_Facturacion');
  const filas=Array.from({length:68},(_,i)=>a.getRow(i+10));
  assert.equal(filas.filter(r=>r.getCell(2).value==='00001').length,2);
  assert.ok(filas.every(r=>typeof r.getCell(2).value==='string' && r.getCell(3).value));
  assert.equal(s.getCell('B10').result,61);assert.equal(s.getCell('C10').result,7);
  assert.equal(s.getCell('D10').result,68);assert.equal(s.getCell('E10').value,118);
  assert.equal(s.getCell('F10').formula,'D10*E10');assert.equal(s.getCell('F10').result,8024);
  assert.equal(s.getCell('F11').formula,'SUM(F10:F10)');assert.equal(s.getCell('F11').result,8024);
  assert.equal(s.getCell('G10').result,68);assert.equal(s.getCell('H10').result,0);
  assert.doesNotMatch(a.getRow(9).values.join(' '),/Teléfono|Telefono|QR/);
});

test('incidencia prevalece, pendiente mantiene cargo y conciliación cuenta entregada sin inventar hora', async () => {
  const comidas=base().slice(0,4);
  comidas[0].entregado_en=null;
  comidas[1].entregado_en=null;comidas[1].entrega_conciliada_en='2026-11-17T18:00:00Z';
  comidas[1].entrega_conciliada_por='Admin QA';comidas[1].entrega_conciliacion_motivo='Entrega verificada';
  Object.assign(comidas[2],{no_surtido_en:'2026-11-07T18:00:00Z',no_surtido_motivo:'No salió de cocina',no_surtido_por:'gerente'});
  const r=await crearExcelFacturacion('2026-11-07','2026-11-07',118,comidas),w=await abrir(r);
  assert.equal(r.conCargo,3);assert.equal(r.entregadas,2);assert.equal(r.sinCargo,1);assert.equal(r.subtotal,354);
  const a=w.getWorksheet('Auditoria_Detalle');
  const filas=Array.from({length:4},(_,i)=>a.getRow(i+10));
  const conciliada=filas.find(f=>f.getCell(10).value.includes('Conciliado'));
  assert.equal(conciliada.getCell(11).value,null);assert.equal(conciliada.getCell(12).value.getUTCHours(),12);
  assert.equal(conciliada.getCell(13).value,'Admin QA');assert.equal(conciliada.getCell(15).value,1);
  const incidencia=filas.find(f=>f.getCell(15).value===0);assert.ok(incidencia.getCell(11).value instanceof Date);
  assert.equal(incidencia.getCell(16).value,'No salió de cocina');assert.equal(incidencia.getCell(17).value,'gerente');
  const s=w.getWorksheet('Resumen_Facturacion');assert.equal(s.getCell('H10').result,1);assert.equal(s.getCell('I10').result,1);
  assert.equal(s.getCell('D10').result,s.getCell('G10').result+s.getCell('H10').result);
});

test('mismo periodo y filtros que operación, fechas locales y exportación vacía correcta', async () => {
  const comidas=[...base(),{...base()[0],fecha_menu:'2026-11-08'}];
  for(const filtros of [{},{servicio:'regular'},{servicio:'cobertura',zona:'zona_refris',turno:'turno_b'}]){
    const opciones={filtros,ahora:DateTime.fromISO('2026-11-07T01:30:00Z')};
    const r=await crearExcelFacturacion('2026-11-07','2026-11-07','100.25',comidas,opciones);
    const op=await crearExcelOperacion('2026-11-07','2026-11-07',comidas,opciones),w=await abrir(r);
    assert.equal(r.conCargo,op.total);assert.equal(r.entregadas,op.entregadas);assert.equal(r.subtotal,op.total*100.25);
    assert.match(w.getWorksheet('Resumen_Facturacion').getCell('A7').value,/06\/11\/2026 19:30/);
  }
  const w=await abrir(await crearExcelFacturacion('2026-11-07','2026-11-07',100,[]));
  assert.equal(resultado(w.getWorksheet('Resumen_Facturacion').getCell('F10')),0);
  assert.match(w.getWorksheet('Auditoria_Detalle').getCell('A10').value,/Sin registros/);
  const p=base()[0];p.empleados.nombre='=HYPERLINK("https://ejemplo.test","QA")';
  const seguro=await abrir(await crearExcelFacturacion('2026-11-07','2026-11-07',100,[p]));
  assert.equal(seguro.getWorksheet('Auditoria_Detalle').getCell('C10').type,ExcelJS.ValueType.String);
  for(const c of [undefined,null,'',' ','1abc',0,-1,NaN,Infinity,[],{},true])assert.throws(()=>validarCostoFacturacion(c),/costo unitario/);
});

test('panel descarga archivo protegido sin caché, evita duplicados y recupera botón tras error', async () => {
  const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
  const funcion=html.match(/  async function excelFacturacion\(boton\) \{[\s\S]*?\n  \}\n/)[0];
  let bien=true,clicks=0,ultima,timer,revocadas=0,costo='118',avisos=[];
  const boton={disabled:false,setAttribute(){},removeAttribute(){}};
  class URLPrueba extends URL {static createObjectURL(){return 'blob:prueba';} static revokeObjectURL(){revocadas++;}}
  const ctx=vm.createContext({val:id=>id==='r-costo'?costo:'2026-11-07',API_BASE:'',ADMIN_KEY:'clave-qa',PANEL_USUARIO:'admin',
    URLSearchParams,URL:URLPrueba,parametrosServicio:()=> 'servicio=cobertura',aviso:(...args)=>avisos.push(args),
    fetch:async(url,options)=>{ultima={url,options};return bien?new Response('excel',{headers:{'X-Comidas-Entregadas':'7','X-Servicios-Con-Cargo':'7','X-Servicios-Sin-Cargo':'0'}}):new Response('{"error":"Falla de consulta"}',{status:500});},
    document:{createElement:()=>({click(){clicks++;},remove(){}}),body:{appendChild(){}}},
    setTimeout:(fn,ms)=>{assert.equal(ms,60000);timer=fn;}});
  vm.runInContext(funcion,ctx);await ctx.excelFacturacion(boton);
  assert.equal(clicks,1);assert.equal(boton.disabled,false);assert.equal(revocadas,0);timer();assert.equal(revocadas,1);
  assert.equal(ultima.options.cache,'no-store');assert.equal(ultima.options.headers['x-admin-key'],'clave-qa');
  assert.doesNotMatch(ultima.url,/clave-qa|key=/);assert.match(ultima.url,/costo=118&servicio=cobertura/);
  bien=false;await ctx.excelFacturacion(boton);assert.equal(clicks,1);assert.equal(boton.disabled,false);assert.match(avisos.at(-1)[1],/Falla de consulta/);
  boton.disabled=true;await ctx.excelFacturacion(boton);assert.equal(clicks,1);
  boton.disabled=false;costo='118mal';ultima=null;await ctx.excelFacturacion(boton);assert.equal(ultima,null);
});

test('API valida antes de consultar, permite panel autorizado y no genera archivos parciales ni obsoletos', async () => {
  const d=datosReportes();let consultas=0,falla=false;
  const db=http.createServer((req,res)=>{
    assert.equal(req.method,'GET');consultas++;const tabla=new URL(req.url,'http://qa').pathname.split('/').at(-1);
    res.setHeader('Content-Type','application/json');
    if(falla&&tabla==='solicitudes_cobertura'){res.statusCode=500;res.end('{"message":"Fallo QA"}');return;}
    res.end(JSON.stringify(({pedidos:d.pedidos,solicitudes_cobertura:d.solicitudes,solicitudes_cobertura_items:d.items})[tabla]||[]));
  });
  await new Promise(r=>db.listen(0,'127.0.0.1',r));
  process.env.SUPABASE_URL=`http://127.0.0.1:${db.address().port}`;process.env.SUPABASE_KEY='qa';
  process.env.ADMIN_KEY='admin-qa';process.env.GERENTE_KEY='gerente-qa';
  const {adminRouter}=await import('../routes/admin.js');const app=express();app.use('/api',adminRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/reportes/facturacion.xlsx`;
  const q=`?ini=${d.fecha}&fin=${d.fecha}&costo=118`;
  try {
    assert.equal((await fetch(url+q)).status,401);assert.equal(consultas,0);
    for(const query of [q.replace('118','1abc'),q.replace('118','0'),q.replace('118','Infinity'),q+'&zona=invalida','?costo=118',q.replace('fin='+d.fecha,'fin=2026-11-06')]){
      assert.equal((await fetch(url+query,{headers:{'x-admin-key':'admin-qa'}})).status,400);assert.equal(consultas,0);
    }
    for(const clave of ['admin-qa','gerente-qa']){
      const res=await fetch(url+q,{headers:{'x-admin-key':clave}});assert.equal(res.status,200);
      assert.equal(res.headers.get('cache-control'),'no-store');assert.match(res.headers.get('content-type'),/spreadsheetml/);
      assert.match(res.headers.get('content-disposition'),/CICSA_Facturacion.*\.xlsx/);assert.equal(res.headers.get('x-comidas-entregadas'),'68');
      const w=await abrir({buffer:Buffer.from(await res.arrayBuffer())});assert.equal(w.getWorksheet('Resumen_Facturacion').getCell('F11').result,8024);
    }
    Object.assign(d.items[0],{no_surtido_en:'2026-11-07T18:00:00Z',no_surtido_motivo:'No salió de cocina'});
    const nueva=await fetch(url+q+'&servicio=cobertura',{headers:{'x-admin-key':'admin-qa'}});
    assert.equal(nueva.headers.get('x-servicios-con-cargo'),'6');assert.equal(nueva.headers.get('x-servicios-sin-cargo'),'1');
    falla=true;const parcial=await fetch(url+q,{headers:{'x-admin-key':'admin-qa'}});
    assert.equal(parcial.status,500);assert.match((await parcial.json()).error,/Excel completo/);assert.match(parcial.headers.get('content-type'),/json/);
  } finally {await new Promise(r=>server.close(r));await new Promise(r=>db.close(r));}
});
