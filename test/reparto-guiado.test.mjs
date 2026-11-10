import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../public/operacion.js';
import '../public/reparto-guiado.js';

const { detectarPunto, servicios, sugerirServicio, esDelServicio } = globalThis.GoLunchGuiado;
const fecha = '2026-11-10', asla = 'zona_vdc', refis = 'zona_refris';
const ahoraMs = Date.parse(`${fecha}T10:00:00-06:00`);
const latitud = metros => metros / 6371000 * 180 / Math.PI;
const punto = (zona = asla, metros = 0, extra = {}) => ({ zona, lat: latitud(metros), lon: 0, ...extra });
const posicion = (metros = 0, extra = {}) => ({ lat: latitud(metros), lon: 0, precision_m: 10, ts: ahoraMs, ...extra });
const detectar = (pos, puntos = [punto()], permitidas = [asla, refis]) => detectarPunto(pos, puntos, permitidas, ahoraMs);
const regular = (numero = '001', turno = 'turno_a', zona = asla, extra = {}) => ({
  tipo: 'regular', numero_empleado: numero, turno, zona, entregado_en: null, ...extra
});
const cobertura = (folio, codigo, hora = '17:30', zona = asla, extra = {}) => ({
  tipo: 'cobertura', folio, codigo_entrega: codigo, numero_empleado: '001', turno: 'turno_b', zona,
  entrega_programada_en: `${fecha}T${hora}:00-06:00`, entregado_en: null, ...extra
});
const iso = hora => `${fecha}T${hora}-06:00`;
function congelar(valor) {
  if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor)) congelar(v);
    Object.freeze(valor);
  }
  return valor;
}

test('mismo contrato global en Node y navegador, cargando operación antes', () => {
  const nombres = ['detectarPunto', 'esDelServicio', 'servicios', 'sugerirServicio'];
  assert.deepEqual(Object.keys(globalThis.GoLunchGuiado).sort(), nombres);
  assert.ok(Object.isFrozen(globalThis.GoLunchGuiado));
  // Contexto sin DOM, red, almacenamiento ni APIs de Node.
  const navegador = vm.createContext({});
  for (const archivo of ['operacion.js', 'reparto-guiado.js']) {
    vm.runInContext(readFileSync(new URL('../public/' + archivo, import.meta.url), 'utf8'), navegador);
  }
  assert.deepEqual(Object.keys(navegador.GoLunchGuiado).sort(), nombres);
  const [servicio] = navegador.GoLunchGuiado.servicios([regular()], asla, fecha);
  assert.equal(servicio.id, 'regular|turno_a');
  assert.equal(servicio.hora, '10:00');
});

test('GPS vigente dentro de un punto registrado propone únicamente su zona autorizada', () => {
  const pos = congelar(posicion());
  const puntos = congelar([punto(), punto(refis, 1000)]);
  assert.deepEqual(detectar(pos, puntos), { zona: asla, motivo: '' });
  assert.equal(detectar(pos, puntos, [refis]).motivo, 'zona_no_permitida');
  assert.equal(detectar(pos, puntos, []).zona, '');
  assert.equal(detectarPunto(pos, puntos, undefined, ahoraMs).zona, '');
});

test('GPS ausente o con coordenadas inválidas nunca asigna zona', () => {
  for (const pos of [null, undefined]) assert.equal(detectar(pos).motivo, 'sin_posicion');
  for (const extra of [
    { lat: null }, { lon: undefined }, { lat: '0' }, { lon: '0' },
    { lat: NaN }, { lon: Infinity }, { lat: 90.001 }, { lat: -91 }, { lon: 181 }, { lon: -181 }
  ]) assert.equal(detectar(posicion(0, extra)).motivo, 'coordenadas_invalidas', JSON.stringify(extra));
});

test('GPS rechaza fixes de más de 90 segundos, timestamps ausentes, inválidos o futuros', () => {
  assert.equal(detectar(posicion(0, { ts: ahoraMs - 90000 })).zona, asla);
  for (const ts of [ahoraMs - 90001, ahoraMs + 1, undefined, null, NaN, Infinity, '2026-11-10']) {
    assert.equal(detectar(posicion(0, { ts })).motivo, 'posicion_vieja');
  }
  // El frontend puede llamar con los tres argumentos del contrato.
  const actual = posicion(0, { ts: Date.now() });
  assert.equal(detectarPunto(actual, [punto()], [asla]).zona, asla);
  assert.equal(detectarPunto({ ...actual, ts: actual.ts - 91000 }, [punto()], [asla]).zona, '');
});

test('GPS acepta precisión de 100 m inclusive, pero rechaza mala precisión y datos incompletos', () => {
  assert.equal(detectar(posicion(0, { precision_m: 100 })).zona, asla);
  assert.equal(detectar(posicion(0, { precision_m: 0 })).zona, asla);
  for (const precision_m of [100.01, -1, null, undefined, NaN, Infinity, '10']) {
    assert.equal(detectar(posicion(0, { precision_m })).motivo, 'precision_invalida');
  }
});

test('usa el radio registrado y 150 m sólo si falta; no supone coordenadas ni radios inválidos', () => {
  assert.equal(detectar(posicion(120), [punto()]).zona, asla);
  assert.equal(detectar(posicion(120), [punto(asla, 0, { radio_m: null })]).zona, asla);
  assert.equal(detectar(posicion(120), [punto(asla, 0, { radio_m: 100 })]).motivo, 'fuera_de_radio');
  assert.equal(detectar(posicion(40), [punto(asla, 0, { radio_m: 60 })]).zona, asla);
  for (const radio_m of [0, -100, NaN, Infinity, '150']) {
    assert.equal(detectar(posicion(), [punto(asla, 0, { radio_m })]).motivo, 'sin_puntos');
  }
  for (const puntos of [[], null, [punto(asla, 0, { lat: null })], [punto(asla, 0, { lon: 181 })]]) {
    assert.equal(detectar(posicion(), puntos).zona, '');
  }
});

test('no agranda el radio con el error GPS: la incertidumbre debe quedar dentro', () => {
  assert.equal(detectar(posicion(100, { precision_m: 40 })).zona, asla);
  assert.equal(detectar(posicion(140, { precision_m: 20 })).motivo, 'precision_cruza_borde');
  assert.equal(detectar(posicion(160, { precision_m: 20 })).motivo, 'precision_cruza_borde');
  assert.equal(detectar(posicion(171, { precision_m: 20 })).motivo, 'fuera_de_radio');
});

test('radios solapados o incertidumbre que alcanza otra zona no producen una falsa elección', () => {
  const puntos = [punto(asla), punto(refis, 200)];
  assert.equal(detectar(posicion(100), puntos).motivo, 'zona_ambigua');
  assert.equal(detectar(posicion(0, { precision_m: 60 }), puntos).motivo, 'zona_ambigua');
  assert.equal(detectar(posicion(0, { precision_m: 60 }), puntos, [asla]).zona, '');
  assert.equal(detectar(posicion(), puntos).zona, asla);
  assert.equal(detectar(posicion(5000), puntos).zona, '');
  // Más de un punto de la misma zona sigue siendo una zona inequívoca.
  assert.equal(detectar(posicion(), [punto(), punto(asla, 20)]).zona, asla);
});

test('agenda regular usa horaEntrega por zona, fecha y turno, y expone los campos del frontend', () => {
  const pedidos = congelar([
    regular('001'), regular('002', 'turno_a', asla, { entregado_en: iso('10:01:00') }),
    regular('003', 'turno_b'), regular('004', 'turno_b', refis)
  ]);
  const agenda = servicios(pedidos, asla, fecha);
  assert.deepEqual(agenda.map(s => [s.id, s.hora, s.turno, s.zona, s.pendientes, s.total]), [
    ['regular|turno_a', '10:00', 'turno_a', asla, 1, 2],
    ['regular|turno_b', '18:00', 'turno_b', asla, 1, 1]
  ]);
  assert.deepEqual(Object.keys(agenda[0]).sort(), ['hora', 'id', 'pedidos', 'pendientes', 'titulo', 'total', 'turno', 'zona']);
  assert.match(agenda[0].titulo, /Turno A/);
  assert.ok(Array.isArray(agenda[0].pedidos));
  assert.equal(agenda[0].pedidos[0], pedidos[0]);
  assert.equal(servicios(pedidos, refis, fecha)[0].hora, '17:00');
  assert.equal(servicios(pedidos, asla, '2026-11-06')[1].hora, '17:00');
});

test('cada folio tiene su servicio y su horario de cobertura, independiente del turno regular', () => {
  const pedidos = congelar([
    cobertura('F-2', 'EX-2', '19:15'), regular('001', 'turno_b'),
    cobertura('F-1', 'EX-1', '16:20', asla, { turno: 'turno_a' }),
    cobertura('F-1', 'EX-3', '16:20', asla, { turno: 'turno_a', entregado_en: iso('16:20:00') }),
    cobertura('F-OTRO', 'EX-4', '16:20', refis)
  ]);
  const agenda = servicios(pedidos, asla, fecha);
  assert.deepEqual(agenda.map(s => [s.id, s.hora, s.turno, s.pendientes, s.total]), [
    ['cobertura|F-1', '16:20', 'turno_a', 1, 2],
    ['regular|turno_b', '18:00', 'turno_b', 1, 1],
    ['cobertura|F-2', '19:15', 'turno_b', 1, 1]
  ]);
  assert.deepEqual(agenda[0].pedidos.map(p => p.codigo_entrega), ['EX-1', 'EX-3']);
  assert.match(agenda[0].titulo, /F-1/);
  assert.equal(servicios(pedidos, refis, fecha)[0].hora, '16:20');
});

test('hora propia de cobertura se convierte a México aunque UTC esté en otro día', () => {
  const pedidos = [cobertura('NOCHE', 'EX-N', '17:30', asla, { entrega_programada_en: '2026-11-11T01:25:00Z' })];
  const [servicio] = servicios(pedidos, asla, fecha);
  assert.equal(servicio.hora, '19:25');
  assert.equal(sugerirServicio([servicio], '2026-11-11T01:24:00Z', fecha), 'cobertura|NOCHE');
  assert.deepEqual(servicios(pedidos, asla, '2026-11-11'), []);
});

test('cobertura antigua sin programación conserva fallback; programación presente inválida no se inventa', () => {
  const antigua = cobertura('LEGADO', 'EX-L');
  delete antigua.entrega_programada_en;
  assert.equal(servicios([antigua], asla, fecha)[0].hora, '18:00');
  assert.equal(servicios([{ ...antigua, zona: refis }], refis, fecha)[0].hora, '17:00');
  assert.equal(servicios([{ ...antigua, turno: 'turno_a' }], asla, fecha)[0].hora, '10:00');
  assert.equal(servicios([antigua], asla, '2026-11-06')[0].hora, '17:00');
  assert.equal(servicios([{ ...antigua, entrega_programada_en: null }], asla, fecha)[0].hora, '18:00');
  for (const entrega_programada_en of ['', 'mal', `${fecha}T18:00:00`, '2026-02-30T18:00:00-06:00', `${fecha}T24:00:00-06:00`, 0, false]) {
    const agenda = servicios([{ ...antigua, entrega_programada_en }], asla, fecha);
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].hora, '');
    assert.equal(sugerirServicio(agenda, iso('18:00:00'), fecha), '');
  }
});

test('filtra no surtidos y fechas ajenas sin borrar servicios terminados', () => {
  const pedidos = [
    regular('001', 'turno_a', asla, { entregado_en: iso('10:01:00') }),
    regular('002', 'turno_a', asla, { no_surtido_en: iso('09:00:00') }),
    regular('003', 'turno_b', asla, { estado: 'no_surtido' }),
    cobertura('LISTO', 'EX-1', '19:00', asla, { entregado_en: iso('19:00:00') }),
    cobertura('LISTO', 'EX-2', '19:00', asla, { no_surtido_en: iso('17:00:00') }),
    cobertura('NO-SURTIDO', 'EX-3', '19:00', asla, { no_surtido_en: iso('17:00:00') }),
    regular('004', 'turno_b', asla, { fecha_menu: '2026-11-09' }),
    cobertura('AYER', 'EX-4', '19:00', asla, { fecha_servicio: '2026-11-09' })
  ];
  assert.deepEqual(servicios(pedidos, asla, fecha).map(s => [s.id, s.pendientes, s.total]), [
    ['regular|turno_a', 0, 1], ['cobertura|LISTO', 0, 1]
  ]);
});

test('datos incompletos no crean folios, turnos o fechas ficticios', () => {
  assert.deepEqual(servicios([null, {}, regular('1', 'turno_c'), cobertura('', 'EX')], asla, fecha), []);
  for (const f of ['', undefined, '2026-02-30', '2026-13-10']) assert.deepEqual(servicios([regular()], asla, f), []);
  assert.deepEqual(servicios(null, asla, fecha), []);
  assert.deepEqual(servicios([regular()], '', fecha), []);
  const legado = regular(); delete legado.tipo;
  assert.equal(servicios([legado], asla, fecha)[0].id, 'regular|turno_a');
});

test('un folio con datos discordantes queda visible sin sugerir una hora arbitraria', () => {
  const [servicio] = servicios([cobertura('F', '1', '17:00'), cobertura('F', '2', '19:00')], asla, fecha);
  assert.equal(servicio.hora, '');
  assert.equal(servicio.total, 2);
  assert.equal(sugerirServicio([servicio], iso('17:00:00'), fecha), '');
});

test('sugiere horario más cercano sin ventanas ni saltar el servicio A terminado', () => {
  const agenda = congelar(servicios([
    regular('001', 'turno_a', asla, { entregado_en: iso('10:00:00') }), regular('002', 'turno_b')
  ], asla, fecha));
  for (const hora of ['00:00:00', '09:59:00', '10:30:00', '13:59:59']) {
    assert.equal(sugerirServicio(agenda, iso(hora), fecha), 'regular|turno_a', hora);
  }
  assert.equal(sugerirServicio(agenda, iso('14:00:00'), fecha), '');
  assert.equal(sugerirServicio(agenda, iso('14:00:01'), fecha), 'regular|turno_b');
  assert.equal(sugerirServicio(agenda, iso('23:59:59'), fecha), 'regular|turno_b');
});

test('ambos servicios completos permanecen en agenda y se sugieren por hora', () => {
  const agenda = servicios([
    regular('001', 'turno_a', refis, { entregado_en: iso('10:00:00') }),
    regular('002', 'turno_b', refis, { entregado_en: iso('17:00:00') })
  ], refis, fecha);
  assert.equal(agenda.length, 2);
  assert.deepEqual(agenda.map(s => s.pendientes), [0, 0]);
  assert.equal(sugerirServicio(agenda, iso('10:01:00'), fecha), 'regular|turno_a');
  assert.equal(sugerirServicio(agenda, iso('17:01:00'), fecha), 'regular|turno_b');
  assert.equal(sugerirServicio(agenda, iso('13:30:00'), fecha), '');
});

test('empate de distancia o varios servicios a la hora más cercana requiere selección manual', () => {
  const agenda = servicios([regular('1', 'turno_b'), cobertura('F1', 'EX-1', '18:00'), cobertura('F2', 'EX-2', '18:00')], asla, fecha);
  assert.equal(sugerirServicio(agenda, iso('18:00:00'), fecha), '');
  assert.equal(sugerirServicio([...agenda].reverse(), iso('17:00:00'), fecha), '');
  const distinta = servicios([regular('1'), cobertura('F1', 'EX-1', '18:00'), cobertura('F2', 'EX-2', '18:00')], asla, fecha);
  assert.equal(sugerirServicio(distinta, iso('10:00:00'), fecha), 'regular|turno_a');
  const dos = servicios([cobertura('F1', '1', '12:00'), cobertura('F2', '2', '13:00')], asla, fecha);
  assert.equal(sugerirServicio(dos, iso('12:30:00'), fecha), '');
});

test('la fecha y medianoche se evalúan en México, con 00:00 y sin envolver al día siguiente', () => {
  const agenda = servicios([regular('1'), regular('2', 'turno_b')], asla, fecha);
  assert.equal(sugerirServicio(agenda, '2026-11-11T05:59:59Z', fecha), 'regular|turno_b');
  assert.equal(sugerirServicio(agenda, '2026-11-11T06:00:00Z', fecha), '');
  assert.equal(sugerirServicio(agenda, '2026-11-10T05:59:59Z', fecha), '');
  assert.equal(sugerirServicio(agenda, '2026-11-10T06:00:00Z', fecha), 'regular|turno_a');
  const medianoche = servicios([
    cobertura('CERO', 'EX-0', '00:00', asla, { entrega_programada_en: '2026-11-10T06:00:00Z' }),
    cobertura('NOCHE', 'EX-N', '23:00')
  ], asla, fecha);
  assert.equal(medianoche[0].hora, '00:00');
  assert.equal(sugerirServicio(medianoche, '2026-11-10T06:00:00Z', fecha), 'cobertura|CERO');
  assert.equal(sugerirServicio(medianoche, '2026-11-11T05:59:59Z', fecha), 'cobertura|NOCHE');
});

test('sugerencia vacía ante reloj o agenda inválidos', () => {
  const agenda = servicios([regular()], asla, fecha);
  for (const ahora of [null, undefined, '', 'mal', `${fecha}T10:00:00`, 0]) {
    assert.equal(sugerirServicio(agenda, ahora, fecha), '');
  }
  assert.equal(sugerirServicio([], iso('10:00:00'), fecha), '');
  assert.equal(sugerirServicio(null, iso('10:00:00'), fecha), '');
  assert.equal(sugerirServicio([null, { id: 'mal', hora: '24:00' }], iso('10:00:00'), fecha), '');
  assert.equal(sugerirServicio(agenda, iso('10:00:00'), '2026-02-30'), '');
});

test('pertenencia por identidad: misma persona en regular y distintos folios no mezcla servicios', () => {
  const pedidos = [regular('001'), cobertura('F1', 'EX-1'), cobertura('F1', 'EX-2'), cobertura('F2', 'EX-3')];
  const agenda = congelar(servicios(pedidos, asla, fecha));
  const a = agenda.find(s => s.id === 'regular|turno_a');
  const f1 = agenda.find(s => s.id === 'cobertura|F1');
  const f2 = agenda.find(s => s.id === 'cobertura|F2');
  assert.equal(esDelServicio({ tipo: 'regular', numero_empleado: '001' }, a), true);
  assert.equal(esDelServicio({ tipo: 'regular', numero_empleado: '002' }, a), false);
  assert.equal(esDelServicio({ tipo: 'cobertura', codigo_entrega: 'EX-1' }, f1), true);
  assert.equal(esDelServicio({ tipo: 'cobertura', codigo_entrega: 'EX-2' }, f1), true);
  assert.equal(esDelServicio(pedidos[1], f2), false);
  assert.equal(esDelServicio(pedidos[3], f1), false);
  assert.equal(esDelServicio(pedidos[1], a), false);
  assert.equal(esDelServicio(pedidos[0], f1), false);
  assert.equal(esDelServicio({ tipo: 'cobertura', folio: 'F1', numero_empleado: '001' }, f1), false);
  // Comparación por valor, sin depender de referencias ni normalizar ceros.
  assert.equal(esDelServicio({ ...pedidos[1] }, f1), true);
  assert.equal(esDelServicio({ numero_empleado: '001' }, a), true);
  assert.equal(esDelServicio({ numero_empleado: 1 }, a), false);
  assert.equal(esDelServicio(null, a), false);
  assert.equal(esDelServicio({}, { pedidos: [{}] }), false);
  assert.equal(esDelServicio(pedidos[0], null), false);
});
