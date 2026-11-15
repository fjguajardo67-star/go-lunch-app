import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const codigo = panel.slice(panel.indexOf('  async function guardarEmpleado()'), panel.indexOf('  async function cargarEmpleados()'));
function preparar(api, rol = 'admin') {
  const elementos = Object.fromEntries(['e-nombre', 'e-num', 'e-tel', 'e-zona', 'e-turno', 'btn-guardar-empleado'].map(id => [id, { value:'', disabled:false, focus() {} }]));
  Object.assign(elementos['e-nombre'], {value:'Persona de prueba'});
  Object.assign(elementos['e-num'], {value:'00099'});
  const avisos = [];
  const ctx = vm.createContext({ PANEL_ROL:rol, document:{getElementById:id => elementos[id]},
    val:id => elementos[id].value.trim(), api, cargarEmpleados() {}, aviso:(_id,texto) => avisos.push(texto) });
  vm.runInContext(codigo, ctx);
  return { guardar:() => ctx.guardarEmpleado(), elementos, avisos };
}

test('guardar conserva ceros iniciales y permite omitir teléfono; no envía dos veces mientras espera', async () => {
  const peticiones = [];
  let terminar;
  const pendiente = new Promise(r => { terminar = r; });
  const f = preparar(async (ruta, opciones) => { peticiones.push({ruta, datos:JSON.parse(opciones.body)}); await pendiente; });
  const primera = f.guardar();
  await f.guardar();
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].datos.numero_empleado, '00099');
  assert.equal(peticiones[0].datos.telefono, '');
  terminar(); await primera;
  assert.equal(f.elementos['e-num'].value, '');
  assert.equal(f.elementos['btn-guardar-empleado'].disabled, false);
});

test('un fallo conserva los datos para reintentar y explica cómo recuperarse', async () => {
  const f = preparar(async () => { throw new Error('500'); });
  await f.guardar();
  assert.equal(f.elementos['e-num'].value, '00099');
  assert.equal(f.elementos['e-nombre'].value, 'Persona de prueba');
  assert.equal(f.elementos['btn-guardar-empleado'].disabled, false);
  assert.match(f.avisos[0], /datos siguen en el formulario/);
});

test('el gerente no puede enviar un alta desde el formulario', async () => {
  let llamadas = 0;
  const f = preparar(async () => { llamadas++; }, 'gerente');
  await f.guardar();
  assert.equal(llamadas, 0);
});
