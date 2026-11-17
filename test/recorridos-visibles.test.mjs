import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
const funciones=['claveBitacora','guardarBitacora','planesDeRuta','rutasRegistradas','rutaEnCurso',
  'seleccionarPuntoDeRuta','pintarBitacora','guardarPasoRuta','accionBitacora','activarRecorrido','prepararBotonesRecorrido']
  .map(nombre=>html.match(new RegExp('(?:async )?function '+nombre+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
const fecha='2026-11-16';

function preparar({zonas=['zona_vdc','zona_refris'],hoy=true,nativo=true,almacen=new Map()}={}) {
  const nodos=new Map(),eventos={},cambios=[],cola=[{numero_empleado:'QA',entregado_en:fecha+'T10:00:00-06:00'}];
  const nodo=id=>{
    if(!nodos.has(id)) {
      const ocultas=new Set();
      nodos.set(id,{innerHTML:'',textContent:'',disabled:false,classList:{toggle(clase,ocultar){ocultar?ocultas.add(clase):ocultas.delete(clase);},contains:c=>ocultas.has(c)},
        focus(){cambios.push('foco:'+id);},addEventListener(tipo,fn){eventos[tipo]=fn;}});
    }
    return nodos.get(id);
  };
  const c=vm.createContext({
    FECHA:fecha,ZONA:'',SERVICIO_INICIADO:false,AVISO_BITACORA:'',BITACORA:{fecha,confirmadas:[],pendientes:[],ocupadas:[]},
    SESION:{repartidor:{id:999}},LS:{bitacora:'qa_'},COLA:cola,
    HTMLButtonElement:{prototype:nativo?{commandForElement:null}:{}},
    $:nodo,esc:x=>x,horaLocal:x=>x,zonasAutorizadas:()=>zonas,listaDeHoy:()=>hoy,
    ahoraComedor:()=>new Date(fecha+'T09:45:00-06:00'),posicionUtil:()=>null,
    localStorage:{setItem:(k,v)=>almacen.set(k,v)},navigator:{onLine:false},
    servicioActual:()=>null,comenzarEntrega:()=>cambios.push('comenzar'),cerrarEscaneoDeServicio:()=>cambios.push('cerrar'),
    cambiarContexto:zona=>{c.ZONA=zona;cambios.push(zona);},sincronizar:()=>cambios.push('sincronizar'),
    pintar:()=>vm.runInContext('pintarBitacora()',c)
  });
  vm.runInContext(readFileSync(new URL('../public/bitacora-rutas.js',import.meta.url),'utf8')+'\n'+funciones+';prepararBotonesRecorrido();pintarBitacora();',c);
  return {c,nodo,eventos,cambios,cola,almacen,iniciar:id=>c.accionBitacora(id)};
}

test('Diana ve tres acciones de inicio; una sesión de una zona ve únicamente su recorrido autorizado',()=>{
  const q=preparar(),botones=q.nodo('bitacora-inicios').innerHTML;
  assert.match(botones,/Iniciar Turno A · ASLA/);assert.match(botones,/Iniciar Turno A · REFIS/);assert.match(botones,/Iniciar Turno B · REFIS y ASLA/);
  assert.equal((botones.match(/aria-disabled="false"/g)||[]).length,3);
  assert.ok(q.nodo('bitacora-controles').classList.contains('oculto'));
  assert.doesNotMatch(html,/<select[^>]*id="bitacora-plan"/);
  const una=preparar({zonas:['zona_vdc']}).nodo('bitacora-inicios').innerHTML;
  assert.match(una,/Iniciar Turno A · ASLA/);assert.doesNotMatch(una,/REFIS/);
});

test('un toque guarda salida sin GPS ni señal, no confirma comidas y dos eventos de inicio no adelantan la llegada',async()=>{
  const q=preparar(),cola=structuredClone(q.cola);
  await q.iniciar('turno_a_refis');await q.iniciar('turno_a_refis');
  assert.equal(q.c.BITACORA.pendientes.length,1);assert.equal(q.c.BITACORA.pendientes[0].paso,0);
  assert.equal(q.c.BITACORA.pendientes[0].lat,null);assert.equal(q.c.ZONA,'zona_refris');
  assert.equal(q.nodo('bitacora-accion').textContent,'Registrar llegada a REFIS');
  assert.ok(q.nodo('bitacora-inicios').classList.contains('oculto'));assert.deepEqual(q.c.COLA,cola);
  assert.equal(JSON.parse(q.almacen.get('qa_999')).pendientes[0].ruta,'turno_a_refis');
  assert.ok(q.cambios.includes('foco:bitacora-accion'));assert.ok(!q.cambios.includes('sincronizar'));
  const reapertura=preparar({almacen:q.almacen});
  reapertura.c.BITACORA=JSON.parse(q.almacen.get('qa_999'));reapertura.c.pintarBitacora();
  assert.equal(reapertura.nodo('bitacora-accion').textContent,'Registrar llegada a REFIS');
});

test('una lista de otro día explica la descarga y no permite iniciar, incluso por llamada directa',async()=>{
  const q=preparar({hoy:false});
  assert.equal((q.nodo('bitacora-inicios').innerHTML.match(/aria-disabled="true"/g)||[]).length,3);
  assert.match(q.nodo('bitacora-estado').textContent,/Descarga el reparto de hoy/);
  await q.iniciar('turno_b');assert.equal(q.c.BITACORA.pendientes.length,0);
});

test('rutas ocupadas, cerradas o fuera de permisos no se inician',async()=>{
  const q=preparar();q.c.BITACORA.ocupadas=['turno_b'];q.c.pintarBitacora();
  assert.doesNotMatch(q.nodo('bitacora-inicios').innerHTML,/Iniciar Turno B/);
  await q.iniciar('turno_b');assert.equal(q.c.BITACORA.pendientes.length,0);
  const una=preparar({zonas:['zona_vdc']});await una.iniciar('turno_b');await una.iniciar('inexistente');
  assert.equal(una.c.BITACORA.pendientes.length,0);
  const plan=q.c.GoLunchBitacora.porId('turno_a_refis');
  q.c.BITACORA.confirmadas=plan.pasos.map((_,paso)=>({fecha,ruta:plan.id,paso,ocurrido_en:fecha+'T10:30:00-06:00'}));
  q.c.pintarBitacora();await q.iniciar(plan.id);assert.equal(q.c.BITACORA.pendientes.length,0);
  assert.doesNotMatch(q.nodo('bitacora-inicios').innerHTML,/Iniciar Turno A · REFIS/);
});

test('Turno B conserva REFIS, ASLA y regreso; cada marca avanza solo al usar la acción correspondiente',async()=>{
  const q=preparar();await q.iniciar('turno_b');
  assert.equal(q.c.ZONA,'zona_refris');
  for(const siguiente of ['Registrar salida de REFIS','Registrar llegada a ASLA','Registrar salida de ASLA','Cerrar ruta en el comedor']) {
    await q.iniciar();assert.equal(q.nodo('bitacora-accion').textContent,siguiente);
  }
  await q.iniciar();assert.equal(q.c.BITACORA.pendientes.length,6);assert.equal(q.c.rutaEnCurso(),undefined);
  assert.ok(!q.nodo('bitacora-inicios').classList.contains('oculto'));assert.match(q.nodo('bitacora-estado').textContent,/cerrada/);
});

test('comandos nativos y alternativa de clic activan una sola vez; aria-disabled también bloquea teclado/clic',()=>{
  for(const nativo of [true,false]) {
    const q=preparar({nativo}),llamadas=[];q.c.accionBitacora=id=>llamadas.push(id);
    const boton={getAttribute:n=>({'command':'--iniciar-turno_a_asla','aria-disabled':'false'})[n]};
    assert.equal(typeof q.eventos.command,'function');assert.equal(typeof q.eventos.click,nativo?'undefined':'function');
    if(nativo)q.eventos.command({source:boton,command:'--iniciar-turno_a_asla'});
    else q.eventos.click({target:{closest:()=>boton}});
    assert.deepEqual(llamadas,['turno_a_asla']);
    q.c.activarRecorrido({source:{getAttribute:()=> 'true'},command:'--iniciar-turno_b'});
    assert.equal(llamadas.length,1);
  }
});
