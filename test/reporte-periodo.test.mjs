import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';
import { prepararReportePeriodo, htmlReportePeriodo } from '../services/reporte-periodo.js';

const datos = () => {
  const d = datosReportes();
  return unirComidas(d.pedidos, d.solicitudes.map(s => ({ ...s, items: d.items.filter(i => i.solicitud_id === s.id) })));
};

test('periodo concilia servicios y estados sin atribuir faltas de recogida ni desperdicio', () => {
  const base = datos(), comidas = ['2026-11-09', '2026-11-10', '2026-11-11'].flatMap(fecha => base.map(p => ({ ...p, fecha_menu: fecha })));
  comidas[0].entregado_en = null;
  comidas[1].no_surtido_en = '2026-11-09T16:00:00Z'; comidas[1].no_surtido_motivo = 'No disponible';
  const d = prepararReportePeriodo('2026-11-09', '2026-11-11', comidas, { elaboro: 'Ana <Caja>' });
  assert.equal(d.resumen.total, 204); assert.equal(d.resumen.sin_confirmacion.length, 1);
  assert.equal(d.resumen.no_surtidos, 1); assert.equal(d.resumen.merma, undefined); assert.equal(d.resumen.sin_recoger, undefined);
  assert.equal(d.dias.reduce((n, dia) => n + dia.entregado.total, 0), 202);
  assert.equal(d.dias.reduce((n, dia) => n + dia.entregado.total + dia.no_surtidos + dia.pendientes, 0), 204);
  const html = htmlReportePeriodo(d), paginas = [...html.matchAll(/Página (\d+) de (\d+)/g)];
  assert.ok(paginas.length > 3);
  assert.deepEqual(paginas.map(m => Number(m[1])), paginas.map((_, i) => i + 1));
  assert.ok(paginas.every(m => Number(m[2]) === paginas.length));
  assert.equal((html.match(/class="cierre"/g) || []).length, 3);
  assert.match(html, /Ana &lt;Caja&gt;/); assert.match(html, /09\/11\/2026 al 11\/11\/2026/);
  assert.match(html, /Hora prevista/); assert.match(html, /Entrega registrada/); assert.match(html, /Sin confirmación/);
  assert.doesNotMatch(html, /Quién no recoge|Merma|Tiempos de ruta|x-admin-key|<script>/);
});

test('resumen y detalle respetan los mismos filtros, fechas y ceros iniciales', () => {
  const comidas = datos(), filtros = { turno: 'turno_b', zona: 'zona_refris', servicio: 'cobertura' };
  const d = prepararReportePeriodo('2026-11-07', '2026-11-07', [...comidas, { ...comidas[0], fecha_menu: '2026-11-08' }], { filtros });
  const esperadas = comidas.filter(p => p.turno === filtros.turno && p.zona === filtros.zona && p.tipo === filtros.servicio);
  assert.equal(d.resumen.total, esperadas.length); assert.equal(d.resumen.regulares, 0);
  assert.equal(d.dias.flatMap(dia => dia.grupos.flatMap(g => g.filas)).length, esperadas.length);
  const html = htmlReportePeriodo(d);
  assert.match(html, /Turno B · REFIS \(LZCR\) · Coberturas/);
  assert.match(html, /<td>00001<\/td>/);
  assert.equal(d.resumen.rating_elegibles, 0);
});

test('sin escaneos ni opiniones el documento no inventa entregas o aprobación', () => {
  const comidas = datos().map(p => ({ ...p, entregado_en: null }));
  const d = prepararReportePeriodo('2026-11-07', '2026-11-07', comidas, { ahora: DateTime.fromISO('2026-11-20') });
  assert.equal(d.resumen.sin_confirmacion.length, 68);
  assert.equal(d.resumen.entrega.pendientes, 0);
  assert.equal(d.dias[0].entregado.total, 0);
  assert.match(htmlReportePeriodo(d), /No hay entregas registradas/);
  const vacio = prepararReportePeriodo('2026-11-09', '2026-11-11', comidas);
  assert.equal(vacio.resumen.total, 0); assert.equal(vacio.dias.length, 0);
  assert.match(htmlReportePeriodo(vacio), /Sin registros para esta selección/);
  for (const [ini, fin] of [['2026-11-10','2026-11-09'], ['2026-02-30','2026-03-01'], ['2026-11-09',undefined]]) {
    assert.throws(() => prepararReportePeriodo(ini, fin, []), e => e.status === 400);
  }
});

test('paginación del resumen conserva todos los platillos largos y escapa contenido', () => {
  const comidas = Array.from({ length: 80 }, (_, i) => ({ ...datos()[0], opcion_texto: 'Platillo <especial> con guarnición y descripción larga ' + i }));
  const d = prepararReportePeriodo('2026-11-07','2026-11-07',comidas), html = htmlReportePeriodo(d);
  assert.equal(d.resumen.porciones_por_platillo.length, 80);
  assert.equal((html.match(/Platillo &lt;especial&gt; con guarnición y descripción larga /g) || []).length, 240);
  assert.doesNotMatch(html, /<especial>/);
});
