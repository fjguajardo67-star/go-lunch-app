import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';
import { prepararReportePeriodo, htmlReportePeriodo } from '../services/reporte-periodo.js';
import { validarEstimacion, calcularEstimacion } from '../services/caratula-estimacion.js';

test('carátula opcional calcula centavos exactos sobre el conteo automático y numera el PDF completo', () => {
  const comidas = datos().slice(0, 3).map(p => ({ ...p, entregado_en: null }));
  const opciones = { elaboro: 'Diana <Alefer>', estimacion: { numero: '001 <Glovis>', servicios: '99999' } };
  const d = prepararReportePeriodo('2026-11-07', '2026-11-07', comidas, opciones);
  assert.deepEqual(d.estimacion, { numero: '001 <Glovis>', servicios: 3, subtotal: 35400, iva: 5664, total: 41064 });
  const html = htmlReportePeriodo(d);
  assert.match(html, /001 &lt;Glovis&gt;/); assert.match(html, /Diana &lt;Alefer&gt;/);
  assert.match(html, /\$354\.00/); assert.match(html, /\$56\.64/); assert.match(html, /\$410\.64/);
  assert.equal((html.match(/\$118\.00/g) || []).length, 1);
  assert.match(html, /Aprobó para facturación/); assert.doesNotMatch(html, /Este reporte no requiere firma/);
  assert.ok(html.indexOf('Estimación de servicios') < html.indexOf('Reporte de servicio del periodo'));
  const paginas = [...html.matchAll(/Página (\d+) de (\d+)/g)];
  assert.deepEqual(paginas.map(m => Number(m[1])), paginas.map((_, i) => i + 1));
  assert.ok(paginas.every(m => Number(m[2]) === paginas.length));
  assert.equal(d.resumen.total, 3); assert.equal(d.dias[0].entregado.total, 0);
  const simple = htmlReportePeriodo(prepararReportePeriodo('2026-11-07', '2026-11-07', comidas));
  assert.doesNotMatch(simple, /class="estimacion"|Aprobó para facturación/);
  assert.equal(calcularEstimacion(validarEstimacion({ numero: '1' }, 'Ana'), 1).total, 13688);
});

test('estimación valida metadatos y usa cero cuando no hay servicios con cargo', () => {
  assert.equal(validarEstimacion(null), null);
  for (const numero of ['', ' ', 'a'.repeat(41), ['001'], '001\n002']) {
    assert.throws(() => validarEstimacion({ numero }, 'Ana'), e => e.status === 400);
  }
  assert.throws(() => validarEstimacion({ numero: '001' }, ' '), e => e.status === 400);
  const d = prepararReportePeriodo('2026-11-07', '2026-11-07', [], { elaboro: 'Ana', estimacion: { numero: '001' } });
  assert.equal(d.estimacion.servicios, 0); assert.equal(d.estimacion.total, 0);
  assert.match(htmlReportePeriodo(d), /\$0\.00/);
});

test('conteo automático respeta periodo, turno, zona, servicio y exclusiones sin cargo', () => {
  const comidas = datos();
  comidas[0].no_surtido_en = '2026-11-07T16:00:00Z';
  const opciones = { elaboro: 'Ana', estimacion: { numero: '001', servicios: -200 } };
  const total = prepararReportePeriodo('2026-11-07', '2026-11-07', comidas, opciones);
  assert.equal(total.estimacion.servicios, 67);
  assert.equal(total.estimacion.total, 67 * 13688);
  const soloSinCargo = prepararReportePeriodo('2026-11-07', '2026-11-07', [comidas[0]], opciones);
  assert.equal(soloSinCargo.estimacion.total, 0);
  for (const filtros of [{ servicio: 'regular' }, { servicio: 'cobertura' }, { turno: 'turno_b', zona: 'zona_refris', servicio: 'cobertura' }]) {
    const d = prepararReportePeriodo('2026-11-07', '2026-11-07', [...comidas, { ...comidas[1], fecha_menu: '2026-11-08' }], { ...opciones, filtros });
    const esperadas = comidas.filter(p => !p.no_surtido_en && (!filtros.servicio || p.tipo === filtros.servicio) && (!filtros.turno || p.turno === filtros.turno) && (!filtros.zona || p.zona === filtros.zona));
    assert.equal(d.estimacion.servicios, esperadas.length);
    assert.equal(d.estimacion.servicios, d.resumen.total - d.resumen.no_surtidos);
  }
});

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

test('gráfica del periodo usa las respuestas filtradas y el pie identifica las partes y quien elaboró en cada hoja', () => {
  const comidas = datos().map((p, i) => ({ ...p, rating: i < 17 ? 'si' : i < 29 ? 'tal_vez' : i < 34 ? 'no' : null }));
  const d = prepararReportePeriodo('2026-11-07', '2026-11-07', comidas, { elaboro: 'Diana <Operación>' });
  const html = htmlReportePeriodo(d), hojas = (html.match(/class="hoja"/g) || []).length;
  assert.match(html, /aria-label="Me gustó mucho: 17\. Estuvo bien: 12\. No me gustó: 5"/);
  assert.match(html, /34 opiniones/);
  assert.equal((html.match(/class="pie-institucional"/g) || []).length, hojas);
  assert.equal((html.match(/Elaboró: Diana &lt;Operación&gt;/g) || []).length, hojas);
  assert.equal((html.match(/alt="Alefer"/g) || []).length, hojas);
  assert.equal((html.match(/Servicio de Comedor y Catering Alefer, S.A. de C.V./g) || []).length, hojas);
  assert.equal((html.match(/Hyundai Glovis México, S. de R.L. de C.V./g) || []).length, hojas);
  const cobertura = htmlReportePeriodo(prepararReportePeriodo('2026-11-07', '2026-11-07', comidas, { filtros: { servicio: 'cobertura' } }));
  assert.match(cobertura, /Aún no hay opiniones registradas/);
  assert.doesNotMatch(cobertura, /34 opiniones|Me gustó mucho: 17/);
  assert.match(cobertura, /Elaboró: _+/);
});
