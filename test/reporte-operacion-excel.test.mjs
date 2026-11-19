import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DateTime } from 'luxon';
import { crearExcelOperacion } from '../services/reporte-operacion-excel.js';
import { prepararReportePeriodo } from '../services/reporte-periodo.js';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';

const base = () => {
  const d = datosReportes();
  return unirComidas(d.pedidos, d.solicitudes.map(s => ({ ...s, items: d.items.filter(i => i.solicitud_id === s.id) })));
};
const abrir = async resultado => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(resultado.buffer); return wb;
};
const filas = ws => Array.from({ length: Math.max(0, ws.rowCount - 9) }, (_, n) =>
  Array.from({ length: ws.columnCount }, (_, c) => ws.getRow(n + 10).getCell(c + 1).value));
const resultado = celda => celda.value?.result ?? celda.value;

test('archivo nativo lleva cuatro hojas, logos incrustados y detalle por comida sin perder ceros iniciales', async () => {
  const r = await crearExcelOperacion('2026-11-07', '2026-11-07', base());
  const w = await abrir(r);
  assert.deepEqual(w.worksheets.map(s => s.name), ['Resumen', 'Entregas', 'Pendientes_Registro', 'Incidencias_Sin_Cargo']);
  assert.equal(r.entregadas, 68); assert.equal(r.total, 68);
  assert.equal(filas(w.getWorksheet('Entregas')).length, 68);
  const numeros = filas(w.getWorksheet('Entregas')).map(f => f[1]);
  assert.equal(numeros.filter(n => n === '00001').length, 2);
  assert.ok(numeros.every(n => typeof n === 'string'));
  for (const s of w.worksheets) {
    assert.equal(s.getImages().length, 3);
    assert.match(s.getCell('A6').value, /comidas|Pedidos|Incidencias/);
    assert.match(s.getCell('A7').value, /07\/11\/2026/);
  }
  assert.equal(w.model.media.length, 3);
  assert.ok(w.model.media.every(m => m.extension === 'png' && m.buffer.length > 100));
  assert.equal(w.getWorksheet('Entregas').views[0].xSplit, 3);
  assert.equal(w.getWorksheet('Entregas').views[0].ySplit, 9);
  const horario = w.getWorksheet('Entregas').getCell('I10').value;
  assert.ok(horario instanceof Date); assert.equal(horario.getUTCHours(), 10);
  assert.match(w.getWorksheet('Resumen').getCell('G11').formula, /^SUM/);
  assert.equal(resultado(w.getWorksheet('Resumen').getCell('G11')), 68);
});

test('conciliación incluye la comida sin inventar hora y una incidencia prevalece sobre cualquier entrega', async () => {
  const comidas = base();
  for (const p of [comidas[0], comidas[61]]) {
    p.entregado_en = null; p.entrega_conciliada_en = '2026-11-17T18:00:00Z';
  }
  comidas[1].entregado_en = null;
  comidas[2].no_surtido_en = '2026-11-07T18:00:00Z';
  comidas[2].no_surtido_motivo = 'No salió de cocina'; comidas[2].no_surtido_por = 'admin';
  const r = await crearExcelOperacion('2026-11-07', '2026-11-07', comidas);
  const w = await abrir(r), e = filas(w.getWorksheet('Entregas'));
  assert.equal(r.entregadas, 66);
  assert.equal(e.filter(f => f[10] === 'Conciliada').length, 2);
  assert.ok(e.filter(f => f[10] === 'Conciliada').every(f => f[9] === null && /Hora real no registrada/.test(f[11])));
  assert.equal(filas(w.getWorksheet('Pendientes_Registro')).length, 1);
  assert.equal(filas(w.getWorksheet('Incidencias_Sin_Cargo')).length, 1);
  const s = w.getWorksheet('Resumen');
  assert.equal(resultado(s.getCell('G10')), 66); assert.equal(resultado(s.getCell('H10')), 1); assert.equal(resultado(s.getCell('I10')), 1);
  assert.equal(resultado(s.getCell('D10')), resultado(s.getCell('G10')) + resultado(s.getCell('H10')) + resultado(s.getCell('I10')));
  // Un escaneo original posterior conserva su hora y deja de aparecer sin hora.
  comidas[0].entregado_en = '2026-11-07T16:03:00Z';
  const actualizado = filas((await abrir(await crearExcelOperacion('2026-11-07','2026-11-07',comidas))).getWorksheet('Entregas'));
  assert.equal(actualizado.filter(f => f[10] === 'Conciliada').length, 1);
  assert.ok(actualizado.some(f => f[1] === '00001' && f[10] === 'Registrada' &&
    f[9] instanceof Date && f[9].getUTCHours() === 10 && f[9].getUTCMinutes() === 3));
});

test('PDF y Excel concilian exactamente periodo, servicio, turno, zona y horas locales', async () => {
  const comidas = [...base(), { ...base()[0], fecha_menu: '2026-11-08' }];
  for (const filtros of [{}, { servicio: 'regular' }, { servicio: 'cobertura', turno: 'turno_b', zona: 'zona_refris' }]) {
    const opciones = { filtros, ahora: DateTime.fromISO('2026-11-07T01:30:00Z') };
    const pdf = prepararReportePeriodo('2026-11-07', '2026-11-07', comidas, opciones);
    const r = await crearExcelOperacion('2026-11-07','2026-11-07',comidas,opciones), w = await abrir(r);
    assert.equal(r.total, pdf.resumen.total);
    assert.equal(r.entregadas, pdf.dias.reduce((n, d) => n + d.entregado.total, 0));
    const e = filas(w.getWorksheet('Entregas'));
    assert.ok(e.every(f => f[0].toISOString() === '2026-11-07T00:00:00.000Z'));
    assert.match(w.getWorksheet('Resumen').getCell('A7').value, /Generado: 06\/11\/2026 19:30/);
    assert.equal(w.getWorksheet('Resumen').getCell('A8').value, pdf.seleccion);
    assert.deepEqual(e.map(f => [f[1], f[2], f[3], f[5]]), pdf.dias.flatMap(d => d.grupos.flatMap(g => g.filas.map(f => [f.numero, f.nombre, f.platillo, f.folio]))));
  }
});

test('vacío, pendientes y texto con apariencia de fórmula no se convierten en entregas ni fórmulas', async () => {
  const vacio = await abrir(await crearExcelOperacion('2026-11-07','2026-11-07',[]));
  assert.equal(resultado(vacio.getWorksheet('Resumen').getCell('G10')), 0);
  const comidas = base().slice(0, 2); comidas[0].entregado_en = null;
  comidas[1].empleados.nombre = '=HYPERLINK("https://ejemplo.test","Empleado")';
  comidas[1].opcion_texto = 'Platillo con descripción '.repeat(10);
  const r = await crearExcelOperacion('2026-11-07','2026-11-07',comidas), w = await abrir(r);
  assert.equal(r.entregadas,1);
  assert.equal(w.getWorksheet('Entregas').getCell('C10').type, ExcelJS.ValueType.String);
  assert.match(w.getWorksheet('Entregas').getCell('C10').value, /^=HYPERLINK/);
  assert.ok(w.getWorksheet('Entregas').getRow(10).height > 50);
});

test('descarga de panel usa autorización por cabecera, evita duplicados y recupera el botón si falla', async () => {
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const funcion = html.match(/  async function excelOperacion\(boton\) \{[\s\S]*?\n  \}\n/)[0];
  let correcto = true, clicks = 0, ultima, borrada = 0, temporizador, avisos = [];
  const boton = { disabled: false, setAttribute() {}, removeAttribute() {} };
  class URLPrueba extends URL {
    static createObjectURL() { return 'blob:excel'; }
    static revokeObjectURL() { borrada++; }
  }
  const ctx = vm.createContext({
    val: id => id === 'op-ini' ? '2026-11-07' : '2026-11-15',
    API_BASE: '', ADMIN_KEY: 'clave-solo-prueba', PANEL_USUARIO: 'admin', URLSearchParams, URL: URLPrueba,
    parametrosServicio: () => 'servicio=cobertura', aviso: (...args) => avisos.push(args),
    fetch: async (url, options) => { ultima = { url, options }; return correcto ? new Response('excel', { headers: { 'X-Comidas-Entregadas': '6', 'X-Comidas-Solicitadas': '6' } }) : new Response('{"error":"Falla de consulta"}', { status:500 }); },
    document: { createElement: () => ({ click() { clicks++; }, remove() {} }), body: { appendChild() {} } },
    setTimeout: (fn, ms) => { assert.equal(ms, 60000); temporizador = fn; }
  });
  vm.runInContext(funcion, ctx);
  await ctx.excelOperacion(boton);
  assert.equal(clicks,1); assert.equal(boton.disabled,false); assert.equal(borrada,0);
  assert.equal(ultima.options.cache,'no-store');
  assert.equal(ultima.options.headers['x-admin-key'],'clave-solo-prueba');
  assert.doesNotMatch(ultima.url,/clave-solo-prueba|key=/);
  assert.match(ultima.url,/servicio=cobertura/); temporizador(); assert.equal(borrada,1);
  correcto=false; await ctx.excelOperacion(boton);
  assert.equal(clicks,1); assert.equal(boton.disabled,false); assert.match(avisos.at(-1)[1],/Falla de consulta/);
  boton.disabled=true; await ctx.excelOperacion(boton); assert.equal(clicks,1);
});

test('API protege el archivo, consulta cambios recientes y falla completa ante un error de cobertura', async () => {
  const d = datosReportes(); let consultas = 0, falla = false;
  const base = http.createServer((req,res) => {
    assert.equal(req.method,'GET'); consultas++;
    const u = new URL(req.url,'http://prueba'), tabla = u.pathname.split('/').at(-1);
    res.setHeader('Content-Type','application/json');
    if (falla && tabla === 'solicitudes_cobertura') { res.statusCode=500; res.end('{"message":"Fallo de prueba"}'); return; }
    res.end(JSON.stringify(({pedidos:d.pedidos,solicitudes_cobertura:d.solicitudes,solicitudes_cobertura_items:d.items})[tabla] || []));
  });
  await new Promise(r=>base.listen(0,'127.0.0.1',r));
  process.env.SUPABASE_URL=`http://127.0.0.1:${base.address().port}`;process.env.SUPABASE_KEY='prueba';
  process.env.ADMIN_KEY='admin-excel-prueba';process.env.GERENTE_KEY='gerente-excel-prueba';
  const {adminRouter}=await import('../routes/admin.js'); const app=express();app.use('/api',adminRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/reportes/operacion.xlsx`;
  try {
    assert.equal((await fetch(url+'?ini='+d.fecha+'&fin='+d.fecha)).status,401);
    assert.equal((await fetch(url+'?key=admin-excel-prueba')).status,401);assert.equal(consultas,0);
    for(const clave of [process.env.ADMIN_KEY,process.env.GERENTE_KEY]){
      const r=await fetch(url+'?ini='+d.fecha+'&fin='+d.fecha,{headers:{'x-admin-key':clave}});
      assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
      assert.match(r.headers.get('content-type'),/spreadsheetml/);assert.match(r.headers.get('content-disposition'),/attachment;.*\.xlsx/);
      const wb=await abrir({buffer:Buffer.from(await r.arrayBuffer())});assert.equal(filas(wb.getWorksheet('Entregas')).length,68);
    }
    d.items[0].entregado_en=null;
    const actualizado=await fetch(url+'?ini='+d.fecha+'&fin='+d.fecha+'&servicio=cobertura',{headers:{'x-admin-key':process.env.ADMIN_KEY}});
    assert.equal(actualizado.headers.get('x-comidas-entregadas'),'6');
    for(const q of ['ini='+d.fecha,'ini=2026-11-08&fin=2026-11-07','ini='+d.fecha+'&fin='+d.fecha+'&zona=invalida']){
      const antes=consultas;assert.equal((await fetch(url+'?'+q,{headers:{'x-admin-key':process.env.ADMIN_KEY}})).status,400);assert.equal(consultas,antes);
    }
    falla=true;
    const parcial=await fetch(url+'?ini='+d.fecha+'&fin='+d.fecha,{headers:{'x-admin-key':process.env.ADMIN_KEY}});
    assert.equal(parcial.status,500);assert.match((await parcial.json()).error,/Excel completo/);
    assert.match(parcial.headers.get('content-type'),/json/);
  } finally {await new Promise(r=>server.close(r));await new Promise(r=>base.close(r));}
});
