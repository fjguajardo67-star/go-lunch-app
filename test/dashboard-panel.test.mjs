import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {construirDashboard} from '../services/dashboard.js';
import {datosDashboard} from './fixtures/dashboard.mjs';

const fuente=await fs.readFile(new URL('../public/dashboard-panel.js',import.meta.url),'utf8');
function preparar() {
  const contexto=vm.createContext({document:{activeElement:null},HTMLElement:class {}});
  vm.runInContext(fuente,contexto);
  const eventos={}, raiz={innerHTML:'',contains:()=>false,querySelector:()=>null,addEventListener:(nombre,fn)=>{eventos[nombre]=fn;}};
  const incidencias=[];
  const panel=contexto.GoLunchDashboard.montar({raiz,hora:valor=>valor||'—',horario:()=> 'Turno de prueba',zona:x=>x,motivo:x=>x,
    puedeIncidencia:()=>true,alIncidencia:indice=>incidencias.push(indice)});
  return {api:contexto.GoLunchDashboard,raiz,panel,incidencias,eventos,
    pulsar(dataset){const b={dataset,disabled:false};raiz.contains=n=>!!n;eventos.click({target:{closest:()=>b}});raiz.contains=()=>false;}};
}

test('filtrar comidas excluye los no pedidos y conserva la identidad del servicio regular o cobertura',()=>{
  const {api}=preparar(), d=datosDashboard();
  d.coberturas[0].entregado_en=null;
  const datos=construirDashboard(d), pendientes=api.comidasVisibles(datos.filas,'pendiente');
  assert.equal(pendientes.length,1);
  const {fila,indice}=pendientes[0];
  assert.equal(fila.tipo,'cobertura');assert.equal(fila.numero_empleado,'00001');
  assert.equal(datos.filas[indice],fila);
  assert.equal(api.comidasVisibles(datos.filas,'todas').length,65);
  assert.equal(api.comidasVisibles(datos.filas,'entregadas').length,64);
  assert.equal(api.comidasVisibles(datos.filas,'entregadas').filter(x=>x.fila.estado==='tardia').length,3);
});

test('los 69 empleados sin pedido se dividen en 12 ingresos y 57 sin registro; los 62 con pedido no se duplican',()=>{
  const {api}=preparar(), datos=construirDashboard(datosDashboard());
  assert.equal(api.personasVisibles(datos.personas,'todos').length,131);
  assert.equal(api.personasVisibles(datos.personas,'con_pedido').length,62);
  assert.equal(api.personasVisibles(datos.personas).length,69);
  const entraron=api.personasVisibles(datos.personas,'sin_pedido','registrado');
  const sinIngreso=api.personasVisibles(datos.personas,'sin_pedido','sin_registro');
  assert.equal(entraron.length,12);assert.equal(sinIngreso.length,57);
  assert.equal(new Set([...entraron,...sinIngreso].map(p=>p.numero_empleado)).size,69);
});

test('al filtrar y refrescar, Registrar no surtido sigue apuntando a la comida seleccionada',()=>{
  const q=preparar(), d=datosDashboard();d.coberturas[0].entregado_en=null;
  let datos=construirDashboard(d);q.panel.actualizar(datos);q.pulsar({comida:'pendiente'});
  const esperado=q.api.comidasVisibles(datos.filas,'pendiente')[0];
  const indice=Number(q.raiz.innerHTML.match(/data-incidencia="(\d+)"/)[1]);
  assert.equal(indice,esperado.indice);q.pulsar({incidencia:String(indice)});
  assert.deepEqual(q.incidencias,[esperado.indice]);
  d.coberturas[0].entregado_en=d.fecha+'T17:00:00-06:00';
  datos=construirDashboard(d);q.panel.actualizar(datos);
  assert.match(q.raiz.innerHTML,/Por entregar · 0 comida/);
  assert.match(q.raiz.innerHTML,/No hay comidas en este grupo/);
});

test('un fallo de accesos conserva sin pedido y desactiva el desglose sin inventar ausencias',()=>{
  const q=preparar(), d=datosDashboard();q.panel.actualizar(construirDashboard(d));
  q.pulsar({vista:'personas'});q.pulsar({ingreso:'registrado'});
  assert.match(q.raiz.innerHTML,/Sin pedido · Ingresaron · 12 persona/);
  const datos=construirDashboard({...d,accesos:[],accesosOk:false});q.panel.actualizar(datos);
  assert.match(q.raiz.innerHTML,/Sin pedido · 69 persona/);
  assert.match(q.raiz.innerHTML,/data-ingreso="registrado"[^>]+disabled/);
  assert.match(q.raiz.innerHTML,/data-ingreso="sin_registro"[^>]+disabled/);
  assert.match(q.raiz.innerHTML,/Sin dato disponible/);
  assert.equal(q.api.personasVisibles(datos.personas,'sin_pedido','sin_registro').length,0);
});

test('una incidencia no se ofrece para registrar otra vez ni se incluye en entregadas',()=>{
  const q=preparar(), datos=construirDashboard(datosDashboard()), fila=datos.filas.find(f=>f.tipo==='cobertura');
  const indice=datos.filas.indexOf(fila);Object.assign(fila,{estado:'no_surtido',no_surtido_en:datos.fecha+'T18:00:00-06:00',
    no_surtido_motivo:'No se cargó en ruta',no_surtido_por:'gerente'});
  q.panel.actualizar(datos);q.pulsar({comida:'no_surtido'});
  assert.equal(q.api.comidasVisibles(datos.filas,'no_surtido').length,1);
  assert.equal(q.api.comidasVisibles(datos.filas,'entregadas').some(x=>x.indice===indice),false);
  assert.doesNotMatch(q.raiz.innerHTML,new RegExp('data-incidencia="'+indice+'"'));
  assert.match(q.raiz.innerHTML,/Marca previa rectificada/);
});

test('nombres y platillos se muestran como texto, sin interpretar HTML',()=>{
  const q=preparar(), datos=construirDashboard(datosDashboard());
  datos.filas[0].nombre='<img src=x onerror=alert(1)>';
  datos.filas[0].platillo='<script>alert(2)</script>';
  q.panel.actualizar(datos);
  assert.doesNotMatch(q.raiz.innerHTML,/<img|<script/);
  assert.match(q.raiz.innerHTML,/&lt;img/);
  assert.match(q.raiz.innerHTML,/&lt;script/);
});

test('sin focusgroup nativo, las flechas y Home cambian la selección y el panel de forma accesible',()=>{
  const q=preparar();q.panel.actualizar(construirDashboard(datosDashboard()));
  let prevenidas=0;
  const tecla=key=>q.eventos.keydown({key,target:{closest:()=>({dataset:{vista:'comidas'}})},preventDefault:()=>prevenidas++});
  tecla('ArrowRight');
  assert.match(q.raiz.innerHTML,/id="dash-tab-personas"[^>]*aria-selected="true" tabindex="0"/);
  assert.match(q.raiz.innerHTML,/id="dash-panel-comidas"[^>]* hidden/);
  tecla('Home');
  assert.match(q.raiz.innerHTML,/id="dash-tab-comidas"[^>]*aria-selected="true" tabindex="0"/);
  assert.match(q.raiz.innerHTML,/id="dash-panel-personas"[^>]* hidden/);
  assert.equal(prevenidas,2);
});
