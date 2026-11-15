import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const codigo = readFileSync(new URL('../public/fechas-comedor.js', import.meta.url), 'utf8');
function fechas(Temporal) {
  const contexto = vm.createContext({ Temporal, Intl });
  vm.runInContext(codigo, contexto);
  return contexto.GoLunchFechas;
}

const modos = [['Safari sin Temporal', undefined]];
if (globalThis.Temporal) modos.push(['Temporal nativo', globalThis.Temporal]);
for (const [modo, temporal] of modos) {
  test(`${modo}: después de las 18:00 no anuncia falsamente que mañana no hay servicio`, () => {
    const f = fechas(temporal);
    for (const hora of ['00:00', '17:59', '18:00', '20:59', '23:59']) {
      const ahora = Date.parse(`2026-11-15T${hora}:00-06:00`);
      assert.equal(f.fechaComedor(ahora), '2026-11-15');
      assert.equal(f.notaServicio('2026-11-16', true, ahora), '', hora);
    }
  });

  test(`${modo}: distingue un salto de servicio y limpia el aviso al actualizar`, () => {
    const f = fechas(temporal), ahora = Date.parse('2026-11-13T20:00:00-06:00');
    assert.match(f.notaServicio('2026-11-16', true, ahora), /Mañana no hay servicio/);
    assert.equal(f.notaServicio('2026-11-14', true, ahora), '');
    assert.equal(f.notaServicio('2026-11-16', false, ahora), '');
    assert.equal(f.fechaComedor(Date.parse('2026-11-14T00:00:00-06:00')), '2026-11-14');
  });

  test(`${modo}: conserva el día civil al cruzar mes, año y febrero bisiesto`, () => {
    const f = fechas(temporal);
    for (const [fecha, n, esperado] of [
      ['2026-12-31', 1, '2027-01-01'], ['2026-03-01', -1, '2026-02-28'],
      ['2028-02-28', 1, '2028-02-29'], ['2028-02-29', 1, '2028-03-01'],
      ['2026-10-31', 7, '2026-11-07']
    ]) assert.equal(f.sumarDias(fecha, n), esperado);
    assert.throws(() => f.sumarDias('2026-02-30', 1));
  });
}

test('la fecha del comedor permanece igual con el equipo en otra zona horaria', () => {
  const previo = process.env.TZ;
  try {
    const instante = Date.parse('2026-11-16T02:30:00Z');
    for (const zona of ['America/Mexico_City', 'UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = zona;
      const f = fechas(undefined);
      assert.equal(f.fechaComedor(instante), '2026-11-15', zona);
      assert.equal(f.sumarDias(f.fechaComedor(instante), 1), '2026-11-16', zona);
    }
  } finally {
    if (previo === undefined) delete process.env.TZ; else process.env.TZ = previo;
  }
});
