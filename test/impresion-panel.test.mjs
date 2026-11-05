import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const contexto = vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/impresion-panel.js', import.meta.url), 'utf8'), contexto);
const impresos = contexto.ImpresionPanel;

test('la lista conserva 130 personas, ceros iniciales y estados, con cabecera repetible', () => {
  const empleados = Array.from({length:130}, (_,i) => ({ numero:String(i).padStart(4,'0'),
    nombre:'Empleado '+i, zona:'ASLA', turno:'Turno A', activo:i !== 129 }));
  const html = impresos.lista(empleados, '5 nov 2026, 18:00');
  assert.equal((html.match(/<tr>/g)||[]).length, 131);
  assert.ok(html.includes('<td>0000</td>'));
  assert.ok(html.includes('Empleado 129'));
  assert.ok(html.includes('129 activos · 1 inactivos'));
  assert.ok(html.includes('thead{display:table-header-group}'));
  assert.ok(html.includes('@page{size:letter portrait'));
});

test('nombres y platillos no pueden inyectar HTML o código en el impreso', () => {
  const ataque = '</span><script>alert("x")</script>';
  for (const html of [impresos.lista([{numero:'1',nombre:ataque,zona:'',turno:'',activo:true}],''),
    impresos.menus([{fecha:'2026-11-07',fija_a:ataque}], '')]) {
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  }
});

test('menú conserva el contenido visible y fecha sin desplazamientos por huso', () => {
  const html = impresos.menus([{fecha:'2026-11-07',fija_a:'Cambio sin guardar',var_3:'Ensalada'}],'ahora');
  assert.ok(html.includes('07/11/2026'));
  assert.ok(html.includes('Cambio sin guardar'));
  assert.ok(html.includes('Variable 3'));
  assert.ok(html.includes('Esta copia no confirma la publicación'));
});

test('periodo incluye todos los días y distingue los que no tienen platillos', () => {
  const html = impresos.menus([{fecha:'2026-11-07',fija_a:'Pollo'},{fecha:'2026-11-08'}],'ahora');
  assert.equal((html.match(/<section class="menu-dia">/g)||[]).length,2);
  assert.ok(html.includes('Sin platillos capturados'));
  assert.ok(html.includes('.menu-dia{break-before:page}'));
});

