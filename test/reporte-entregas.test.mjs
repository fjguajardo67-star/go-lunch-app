import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DateTime } from 'luxon';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';
import { prepararReporteEntregas, htmlReporteEntregas } from '../services/reporte-entregas.js';

const datos = () => {
  const d = datosReportes();
  return { ...d, comidas: unirComidas(d.pedidos, d.solicitudes.map(s => ({ ...s, items: d.items.filter(i => i.solicitud_id === s.id) }))) };
};

test('el reporte concilia solicitado = entregado + pendiente e incluye coberturas, sin contar personas como comidas', () => {
  const d = datos();
  d.comidas[0].entregado_en = null;
  d.comidas.find(c => c.tipo === 'cobertura').entregado_en = null;
  const r = prepararReporteEntregas(d.fecha, [...d.comidas, { ...d.comidas[1], fecha_menu: '2026-11-06' }]);
  assert.deepEqual(r.registradas, { regulares: 61, coberturas: 7, total: 68 });
  assert.deepEqual(r.entregado, { regulares: 60, coberturas: 6, total: 66 });
  assert.equal(r.pendientes, 2);
  assert.equal(r.entregado.total + r.pendientes, r.registradas.total);
  assert.equal(r.grupos.reduce((n, g) => n + g.total, 0), 66);
  assert.equal(r.grupos.filter(g => g.turno === 'turno_b').reduce((n, g) => n + g.total, 0), 15);
  assert.equal(r.paginas.flatMap(p => p.partes.flatMap(s => s.filas)).length, 66);
  const extra = r.grupos.flatMap(g => g.filas).find(f => f.servicio === 'Cobertura extraordinaria');
  assert.equal(extra.horario, '17:30'); assert.equal(extra.hora_registrada, '17:15');
  assert.ok(extra.folio);
});

test('el documento identifica fecha, hora local y responsable sin firma ni datos de acceso, y conserva nombres escapados', () => {
  const d = datos(), comida = { ...d.comidas[0], empleados: { nombre: '<script>persona()</script>', numero_empleado: '00007' } };
  const r = prepararReporteEntregas(d.fecha, [comida], { elaboro: '  Ana <Caja>  ', ahora: DateTime.fromISO('2026-11-08T01:00:00Z') });
  assert.equal(r.generado, '07/11/2026 19:00');
  const html = htmlReporteEntregas(r);
  assert.match(html, /Servicio: 07\/11\/2026/); assert.match(html, /Elaboró: Ana &lt;Caja&gt;/);
  assert.match(html, /&lt;script&gt;persona\(\)&lt;\/script&gt;/); assert.match(html, /<td>00007<\/td>/);
  assert.match(html, /data:image\/svg\+xml;base64/); assert.match(html, /Página 1 de 1/);
  assert.doesNotMatch(html, /<script>|x-admin-key|\?key=|type="password"|Nombre y firma|linea-firma/);
  assert.match(html, /Total diario entregado: 1 comida/);
  const sinEntregar = htmlReporteEntregas(prepararReporteEntregas(d.fecha, [{ ...comida, entregado_en: null }]));
  assert.match(sinEntregar, /No hay entregas registradas/); assert.doesNotMatch(sinEntregar, /<td>00007/);
});

test('paginación de listas largas conserva cada entrega y los subtotales, incluso horarios incompletos o de otro día', () => {
  const d = datos(), base = d.comidas[0];
  const largas = Array.from({ length: 95 }, (_, i) => ({ ...base, empleados: {
    nombre: 'Nombre de prueba largo con dos apellidos y varios nombres ' + i, numero_empleado: String(i).padStart(5, '0')
  }, opcion_texto: 'Platillo de prueba con una descripción larga y guarnición', turno: i < 90 ? 'turno_a' : null,
  zona: i < 90 ? 'zona_refris' : null, entregado_en: i === 94 ? 'invalida' : d.fecha + 'T00:30:00Z' }));
  const r = prepararReporteEntregas(d.fecha, largas);
  const filas = r.paginas.flatMap(p => p.partes.flatMap(s => s.filas));
  assert.equal(filas.length, 95); assert.equal(new Set(filas.map(f => f.numero)).size, 95);
  assert.ok(r.paginas.length > 2);
  assert.equal(r.paginas.flatMap(p => p.partes).filter(s => s.ultima).length, 2);
  assert.equal(filas[0].fecha_registrada, '06/11/2026');
  assert.equal(filas.at(-1).hora_registrada, 'Sin hora válida');
  assert.equal(filas.at(-1).horario, 'Por confirmar');
  const html = htmlReporteEntregas(r);
  assert.equal((html.match(/class="cierre"/g) || []).length, 1);
  assert.equal((html.match(/<td>\d{5}<\/td>/g) || []).length, 95);
  assert.match(html, new RegExp('Página ' + r.paginas.length + ' de ' + r.paginas.length));
  for (const fecha of ['2026-02-30', '07/11/2026']) assert.throws(() => prepararReporteEntregas(fecha, []), e => e.status === 400);
  for (const elaboro of [['dos valores'], 'a'.repeat(121), 'Nombre\nOtro']) assert.throws(() => prepararReporteEntregas(d.fecha, [], { elaboro }), e => e.status === 400);
});

test('API admite admin y gerente por header, nunca genera un reporte parcial si falla la consulta de coberturas', async () => {
  let falla = false, consultas = 0;
  const d = datosReportes();
  const base = http.createServer((req, res) => {
    assert.equal(req.method, 'GET'); consultas++;
    const u = new URL(req.url, 'http://prueba'), tabla = u.pathname.split('/').at(-1);
    res.setHeader('content-type', 'application/json');
    if (falla && tabla === 'solicitudes_cobertura') { res.statusCode = 500; res.end('{"message":"Fallo de prueba"}'); return; }
    let filas = ({ pedidos: d.pedidos, solicitudes_cobertura: d.solicitudes, solicitudes_cobertura_items: d.items })[tabla] || [];
    filas = filas.filter(f => [...u.searchParams].every(([k, v]) => v.startsWith('gte.') ? String(f[k]) >= v.slice(4) : v.startsWith('lte.') ? String(f[k]) <= v.slice(4) : v.startsWith('in.(') ? v.slice(4, -1).split(',').includes(String(f[k])) : true));
    res.end(JSON.stringify(filas.slice(Number(u.searchParams.get('offset') || 0), Number(u.searchParams.get('offset') || 0) + Number(u.searchParams.get('limit') || 1000))));
  });
  await new Promise(r => base.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${base.address().port}`; process.env.SUPABASE_KEY = 'solo-prueba';
  process.env.ADMIN_KEY = 'admin-reporte-prueba'; process.env.GERENTE_KEY = 'gerente-reporte-prueba';
  const { adminRouter } = await import('../routes/admin.js');
  const app = express(); app.use('/api', adminRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/reporte-entregas/`;
  try {
    assert.equal((await fetch(url + d.fecha)).status, 401);
    assert.equal((await fetch(url + d.fecha + '?key=admin-reporte-prueba')).status, 401); assert.equal(consultas, 0);
    for (const clave of [process.env.ADMIN_KEY, process.env.GERENTE_KEY]) {
      const res = await fetch(url + d.fecha + '?elaboro=Responsable%20de%20prueba', { headers: { 'x-admin-key': clave } });
      assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text(); assert.match(html, /Total diario entregado: 68 comidas/);
      assert.match(html, /Regulares entregadas: 61 \+ Coberturas entregadas: 7/);
      assert.doesNotMatch(html, /admin-reporte-prueba|gerente-reporte-prueba/);
    }
    const semanal = `http://127.0.0.1:${server.address().port}/api/reporte-periodo`;
    assert.equal((await fetch(semanal + '?ini=' + d.fecha + '&fin=' + d.fecha)).status, 401);
    for (const clave of [process.env.ADMIN_KEY, process.env.GERENTE_KEY]) {
      const res = await fetch(semanal + '?ini=' + d.fecha + '&fin=' + d.fecha + '&servicio=cobertura', { headers: { 'x-admin-key': clave } });
      assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
      const html = await res.text(); assert.match(html, /Total diario entregado: 7 comidas/);
      assert.doesNotMatch(html, /Quién no recoge|Merma|Tiempos de ruta|admin-reporte-prueba/);
    }
    for (const q of ['ini=' + d.fecha, 'ini=2026-11-08&fin=2026-11-07', 'ini=' + d.fecha + '&fin=' + d.fecha + '&zona=invalida']) {
      const antes = consultas;
      assert.equal((await fetch(semanal + '?' + q, { headers: { 'x-admin-key': process.env.ADMIN_KEY } })).status, 400);
      assert.equal(consultas, antes);
    }
    const anteriores = consultas;
    for (const ruta of ['2026-02-30', d.fecha + '?elaboro=A&elaboro=B']) {
      assert.equal((await fetch(url + ruta, { headers: { 'x-admin-key': process.env.ADMIN_KEY } })).status, 400);
    }
    assert.equal(consultas, anteriores);
    falla = true;
    const parcial = await fetch(semanal + '?ini=' + d.fecha + '&fin=' + d.fecha, { headers: { 'x-admin-key': process.env.ADMIN_KEY } });
    assert.equal(parcial.status, 500); assert.match((await parcial.json()).error, /reporte completo/);
    const res = await fetch(url + d.fecha, { headers: { 'x-admin-key': process.env.ADMIN_KEY } });
    assert.equal(res.status, 500); assert.match((await res.json()).error, /reporte completo/);
  } finally { await new Promise(r => server.close(r)); await new Promise(r => base.close(r)); }
});
