import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { horaEntrega, limiteEntrega, esEntregaTardia, ZONAS } from '../services/menu.js';

const fecha = '2026-11-07';
const asla = 'zona_vdc';
const refis = 'zona_refris';

test('dos patios, con mañana común y tarde por zona', () => {
  assert.deepEqual(Object.values(ZONAS), ['ASLA (LZCA)', 'REFIS (LZCR)']);
  for (const zona of [asla, refis]) assert.equal(horaEntrega('turno_a', zona, fecha), '10:00');
  assert.equal(horaEntrega('turno_b', asla, fecha), '18:00');
  assert.equal(horaEntrega('turno_b', refis, fecha), '17:00');
});

test('puntualidad por patio, con límite inclusivo de 15 minutos', () => {
  for (const [zona, hora] of [[asla, '18'], [refis, '17']]) {
    assert.equal(limiteEntrega(fecha, 'turno_b', zona).toFormat('HH:mm'), `${hora}:15`);
    assert.equal(esEntregaTardia(fecha, 'turno_b', `${fecha}T${hora}:15:00-06:00`, zona), false);
    assert.equal(esEntregaTardia(fecha, 'turno_b', `${fecha}T${hora}:15:01-06:00`, zona), true);
  }
  assert.equal(esEntregaTardia(fecha, 'turno_b', `${fecha}T17:30:00-06:00`, asla), false);
  assert.equal(esEntregaTardia(fecha, 'turno_b', `${fecha}T17:30:00-06:00`, refis), true);
  assert.equal(esEntregaTardia(fecha, 'turno_a', `${fecha}T10:15:01-06:00`, asla), true);
});

test('historial anterior conserva el horario original y datos incompletos no se califican', () => {
  assert.equal(horaEntrega('turno_b', asla, '2026-11-06'), '17:00');
  assert.equal(esEntregaTardia('2026-11-06', 'turno_b', '2026-11-06T17:30:00-06:00', asla), true);
  assert.equal(limiteEntrega(fecha, 'turno_b', 'desconocida'), null);
  assert.equal(limiteEntrega(fecha, 'turno_c', asla), null);
  assert.equal(limiteEntrega('fecha-invalida', 'turno_b', asla), null);
  assert.equal(esEntregaTardia(fecha, 'turno_b', null, asla), null);
});

test('reparto sin conexión usa la zona aunque la caché antigua diga 17:00', () => {
  const html = readFileSync(new URL('../public/entrega.html', import.meta.url), 'utf8');
  const fn = html.match(/function limiteDelTurno\([\s\S]*?\n  }/)[0];
  const browser = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../public/operacion.js', import.meta.url), 'utf8'), browser);
  vm.runInContext(`const FECHA='${fecha}', ZONA='${asla}', TOLERANCIA_MIN=15;
    const TURNO_HORA={turno_a:'10:00',turno_b:'17:00'}; ${fn}`, browser);
  assert.equal(vm.runInContext("limiteDelTurno('turno_b').getHours()", browser), 18);
  assert.equal(vm.runInContext("limiteDelTurno('turno_b', 'zona_refris').getHours()", browser), 17);
  assert.equal(vm.runInContext("limiteDelTurno('turno_b').getMinutes()", browser), 15);
});

test('etiquetas y comandas muestran el patio y hora sin alterar los QR', async () => {
  // Solo se ejercitan renderizadores puros: nunca conectar a una base real.
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'test-only-not-a-real-key';
  const { htmlEtiquetas, htmlComanda } = await import('../services/cocina.js');
  const { htmlEtiquetasCobertura } = await import('../services/cocina-cobertura.js');
  const pedidos = [asla, refis].map((zona, i) => ({ zona, turno: 'turno_b', opcion_texto: 'Pollo', empleados: { numero_empleado: String(i + 1), nombre: 'Ejemplo' } }));
  const etiquetas = htmlEtiquetas({ fecha, ancho: 57, alto: 32, modo: 'hoja', pedidos });
  assert.match(etiquetas, /ASLA &nbsp;·&nbsp; 18:00/);
  assert.match(etiquetas, /REFIS &nbsp;·&nbsp; 17:00/);
  assert.match(etiquetas, /1\|2026-11-07/);
  assert.doesNotMatch(etiquetas, /VDC/);
  const comanda = htmlComanda({ fecha, total: 0, resumen: [] });
  assert.match(comanda, /REFIS 5:00 PM · ASLA 6:00 PM/);
  const items = pedidos.map((p, i) => ({ empleado_nombre_snapshot: 'Ejemplo', empleado_numero_snapshot: String(i+1), codigo_entrega: `codigo-${i}`, secuencia: 1,
    solicitud: { zona: p.zona, folio: `F${i}`, total_porciones: 1 } }));
  const cobertura = htmlEtiquetasCobertura({ fecha, ancho: 57, alto: 32, modo: 'hoja', items });
  assert.match(cobertura, /COBERTURA · 6:00 PM · ASLA/);
  assert.match(cobertura, /COBERTURA · 5:00 PM · REFIS/);
  assert.match(cobertura, /EX\|codigo-0\|2026-11-07/);
});
