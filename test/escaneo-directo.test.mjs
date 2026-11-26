import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../public/etiqueta-entrega.js';
const {crear,leer,resolver}=globalThis.GoLunchEtiqueta;
const fecha='2026-11-26',refis='zona_refris',asla='zona_vdc';
const regular={tipo:'regular',numero_empleado:'00123',zona:refis,turno:'turno_a',nombre:'Persona QA',platillo:'Omelet'};
const cobertura={...regular,tipo:'cobertura',codigo_entrega:'ABC-123',zona:asla,turno:'turno_b',folio:'F1'};
const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
const fn=nombre=>html.match(new RegExp('(?:async )?function '+nombre+'\\([\\s\\S]*?\\n  }'))[0];
function app({hoy=true,gps=null,lleno=false,permitidas=[refis,asla]}={}) {
 const almacen=new Map(),avisos=[],nodos=new Map();let pinturas=0;
 const $=id=>{if(!nodos.has(id))nodos.set(id,{value:'',open:false,innerHTML:'',textContent:'',showModal(){this.open=true;},close(){this.open=false;}});return nodos.get(id);};
 const c=vm.createContext({
  PEDIDOS:structuredClone([regular,cobertura]),TODOS_PEDIDOS:[],COLA:[],FECHA:fecha,
  ZONA:asla,TURNO:'turno_b',SERVICIO_INICIADO:false,SUPERVISOR_ACTUAL:'No reutilizar',
  ORIGEN_PENDIENTE:null,RECEPTOR_PENDIENTE:null,MANUAL_NUMERO:'',MODO_LECTOR:false,
  LS:{cola:'cola',jornada:'jornada'},SESION:{repartidor:{id:10}},PUNTOS:[],LLEGADAS_DIA:[],RELOJ:null,
  ULTIMA_DESCARGA:null,TURNO_HORA:{},TOLERANCIA_MIN:15,MOTIVOS:{},
  $: $,flash:(...a)=>avisos.push(a),enfocarLector:()=>{},comprobarEscaner:()=>false,
  listaDeHoy:()=>hoy,zonasAutorizadas:()=>permitidas,
  ahoraComedor:()=>new Date(fecha+'T16:00:00-06:00'),posicionUtil:()=>gps,
  localStorage:{setItem(k,v){if(lleno)throw Error('QuotaExceeded');almacen.set(k,v);}},
  guardar:(k,v)=>almacen.set(k,JSON.stringify(v)),claveDatos:z=>'datos_'+z,
  pintar:()=>pinturas++,sincronizar:()=>{throw Error('No hay red en esta prueba');},navigator:{onLine:false},
  TURNO_TXT:{turno_a:'Turno A',turno_b:'Turno B'},ZONA_TXT:{[asla]:'ASLA',[refis]:'REFIS'},
  esTardia:()=>true,esc:x=>String(x),horaLocal:x=>x,
  entregada:p=>!!(p.entregado_en||p.entrega_conciliada_en)&&!p.no_surtido_en,
 });
 for(const ruta of ['etiqueta-entrega.js','reparto-grupos.js','operacion.js']) vm.runInContext(readFileSync(new URL('../public/'+ruta,import.meta.url),'utf8'),c);
 const nombres=['clavePedido','pedidoPorClave','codificarClave','validarGrupoEnPantalla','entregar','registrarEntrega','guardarCacheZona','aplicarColaLocal','buscarManual','cancelarManual','confirmarManual'];
 // One-line declarations have no closing line of their own.
 for(const n of nombres)vm.runInContext(n==='codificarClave'?"function codificarClave(x){return encodeURIComponent(x);}":fn(n),c);
 c.comidasEnPantalla=()=>c.PEDIDOS;
 return {c,$,almacen,avisos,pinturas:()=>pinturas};
}
test('QR nuevo incluye empleado y zona sin hora; ambos formatos anteriores siguen resolviendo',()=>{
 assert.equal(crear(regular,fecha),'00123|2026-11-26|zona_refris');
 assert.equal(crear(cobertura,fecha),'EX|ABC-123|2026-11-26|zona_vdc|00123');
 for(const [codigo,p] of [[crear(regular,fecha),regular],['00123|'+fecha,regular],['00123',regular],
  [crear(cobertura,fecha),cobertura],['EX|abc-123|'+fecha,cobertura]]) {
  assert.equal(resolver(codigo,[regular,cobertura],fecha,[asla,refis]).pedido,p);
 }
 assert.equal(leer('00123|'+fecha+'|otro'),null);
 assert.equal(leer('EX|ABC-123|'+fecha+'|zona_vdc'),null);
 assert.equal(resolver('123|'+fecha,[regular],fecha,[refis]).error,'sin_pedido');
});
test('no confía en zona o empleado alterados, ni en QR de otro día, permiso o incidencia',()=>{
 const filas=[regular,cobertura];
 assert.equal(resolver('00123|'+fecha+'|'+asla,filas,fecha,[asla,refis]).error,'etiqueta_distinta');
 assert.equal(resolver('EX|ABC-123|'+fecha+'|zona_vdc|999',filas,fecha,[asla,refis]).error,'etiqueta_distinta');
 assert.equal(resolver('00123|2026-11-25',filas,fecha,[refis]).error,'otra_fecha');
 assert.equal(resolver(crear(cobertura,fecha),filas,fecha,[refis]).error,'zona_no_autorizada');
 assert.equal(resolver(crear(regular,fecha),[{...regular,no_surtido_en:'marca'}],fecha,[refis]).error,'no_surtido');
 assert.equal(resolver('00123|'+fecha,[regular,{...regular,zona:asla}],fecha,[refis,asla]).error,'ambiguo');
});
test('escanea ambas clases sin iniciar servicio: persiste contexto del pedido, hora y GPS, sin receptor inventado',()=>{
 const q=app({gps:{lat:18,lon:-102,precision_m:8}});
 for(const p of [regular,cobertura])q.c.entregar(crear(p,fecha),'camara');
 assert.equal(q.c.COLA.length,2);assert.equal(q.pinturas(),2);
 const cola=JSON.parse(q.almacen.get('cola'));
 assert.deepEqual(cola.map(e=>[e.zona,e.turno,e.metodo_entrega]),[[refis,'turno_a','camara'],[asla,'turno_b','camara']]);
 for(const e of cola){assert.equal(e.entregado_en,'2026-11-26T22:00:00.000Z');assert.equal(e.fecha,fecha);assert.equal(e.lat,18);assert.equal(e.lon,-102);assert.equal(e.receptor_nombre,null);assert.equal(e.recibido_por,null);}
 assert.ok(q.c.PEDIDOS.every(p=>p.entregado_en));
 q.c.entregar(crear(regular,fecha),'lector');assert.equal(q.c.COLA.length,2);assert.equal(q.avisos.at(-1)[0],'dup');
 assert.equal(q.c.SERVICIO_INICIADO,false);assert.equal(q.c.SUPERVISOR_ACTUAL,'No reutilizar');
});
test('sin GPS ni red registra; reabrir recupera cola aunque la caché de pedidos no alcance a guardarse',()=>{
 const q=app();q.c.entregar('00123|'+fecha,'lector');
 assert.equal(q.c.COLA[0].lat,null);assert.equal(q.c.COLA[0].precision_m,null);
 const restaurados=q.c.aplicarColaLocal(structuredClone([regular,cobertura]));
 assert.equal(restaurados[0].entregado_en,q.c.COLA[0].entregado_en);assert.equal(restaurados[1].entregado_en,undefined);
 const incidente=q.c.aplicarColaLocal([{...regular,no_surtido_en:'incidencia'}])[0];assert.equal(incidente.entregado_en,undefined);
 assert.equal(JSON.parse(q.almacen.get('datos_'+refis)).pedidos.length,1);
 assert.equal(JSON.parse(q.almacen.get('datos_'+asla)).pedidos.length,1);
});
test('fallo de almacenamiento, fecha pasada, zona denegada y duplicado no producen una falsa confirmación',()=>{
 for(const opciones of [{lleno:true},{hoy:false},{permitidas:[asla]}]){
  const q=app(opciones);q.c.entregar(crear(regular,fecha),'camara');
  assert.equal(q.c.COLA.length,0);assert.equal(q.c.PEDIDOS[0].entregado_en,undefined);assert.equal(q.avisos.at(-1)[0],'mal');
 }
 const q=app();q.c.PEDIDOS[0].entrega_conciliada_en='admin';q.c.entregar(crear(regular,fecha),'camara');
 assert.equal(q.c.COLA.length,0);assert.equal(q.avisos.at(-1)[0],'dup');
});
test('etiqueta dañada muestra ambas comidas y confirma solo la elegida con el método manual',()=>{
 const q=app();q.$('manual').value='00123';q.c.buscarManual();
 assert.equal(q.$('manual-confirmacion').open,true);assert.match(q.$('manual-resultados').innerHTML,/Cobertura F1/);assert.match(q.$('manual-resultados').innerHTML,/Regular/);
 q.c.confirmarManual(encodeURIComponent('cobertura|ABC-123'));
 assert.equal(q.c.COLA.length,1);assert.equal(q.c.COLA[0].tipo,'cobertura');assert.equal(q.c.COLA[0].metodo_entrega,'manual');
 assert.equal(q.c.PEDIDOS[0].entregado_en,undefined);assert.equal(q.$('manual-confirmacion').open,false);
});

test('cámara abre sin servicio iniciado y descarta una apertura pendiente al cerrar sesión',async()=>{
 for(const invalidar of [false,true]) {
  let resolverPermiso,detenidas=0,reproducciones=0;
  const nodos=new Map();const nodo=id=>{if(!nodos.has(id))nodos.set(id,{textContent:'',srcObject:null,
   classList:{add(){},remove(){}},setAttribute(){},play:async()=>{reproducciones++;}});return nodos.get(id);};
  const c=vm.createContext({FECHA:fecha,EPOCA_SESION:1,SERVICIO_INICIADO:false,escaneando:false,ABRIENDO_CAMARA:false,
   listaDeHoy:()=>true,jsQR:()=>{},$:nodo,document:{hidden:false},pintarLlegada:()=>{},mostrarAviso:()=>{},
   navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>{resolverPermiso=r;})}},
   stream:null,ultimoAnalisisCamara:0,intentoCamara:0,cuadroCamara:0,leerCuadro:()=>{},requestAnimationFrame:()=>1});
  vm.runInContext(fn('alternarCamara'),c);const abriendo=c.alternarCamara();
  if(invalidar)c.EPOCA_SESION++;
  resolverPermiso({getVideoTracks:()=>[],getTracks:()=>[{stop(){detenidas++;}}]});await abriendo;
  assert.equal(c.escaneando,!invalidar);assert.equal(detenidas,invalidar?1:0);assert.equal(reproducciones,invalidar?0:1);
 }
});
test('cerrar cámara conserva pedidos y colas sin crear marcas de ruta',()=>{
 const q=app();q.c.escaneando=true;q.c.cuadroCamara=1;q.c.stream={getTracks:()=>[{stop(){}}]};
 q.c.APP_ARRANCADA=false;q.c.cancelAnimationFrame=()=>{};
 q.$('video').pause=()=>{};q.$('camara').classList={add(){}};
 q.$('btn-camara').classList={remove(){}};q.$('btn-camara').setAttribute=()=>{};
 const antes=JSON.stringify({pedidos:q.c.PEDIDOS,cola:q.c.COLA});
 vm.runInContext(fn('detenerCamara'),q.c);q.c.detenerCamara();
 assert.equal(q.c.escaneando,false);assert.equal(JSON.stringify({pedidos:q.c.PEDIDOS,cola:q.c.COLA}),antes);
});

test('al cambiar de día puede cerrar la cámara, aunque deba descargar la nueva jornada para abrirla',async()=>{
 let cierres=0;const c=vm.createContext({escaneando:true,listaDeHoy:()=>false,detenerCamara:()=>{cierres++;},flash:()=>{throw Error('No debe impedir cerrar');}});
 vm.runInContext(fn('alternarCamara'),c);await c.alternarCamara();assert.equal(cierres,1);
});
