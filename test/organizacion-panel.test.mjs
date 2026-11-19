import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const funcion=nombre=>html.match(new RegExp('  (?:async )?function '+nombre+'\\([^]*?\\n  }'))[0];

test('Menú conserva borradores al alternar, activa por acción y ofrece flechas/Home/End sin depender de focusgroup',()=>{
 const botones=['regular','cobertura'].map(nombre=>({dataset:{menuVista:nombre},tabIndex:nombre==='regular'?0:-1,atributos:{},setAttribute(k,v){this.atributos[k]=v;},focus(){foco=this;}}));
 let foco=botones[0],cargas=0;const paneles={'menu-panel-regular':{hidden:false},'menu-panel-cobertura':{hidden:true}};
 const ctx=vm.createContext({PANEL_ROL:'admin',MENU_COBERTURA_SEMANAL:null,fechaComedor:()=> '2026-11-19',cargarMenuCobertura:()=>{cargas++;ctx.MENU_COBERTURA_SEMANAL={borrador:'texto aún no publicado'};},document:{querySelectorAll:()=>botones,getElementById:id=>paneles[id]}});
 vm.runInContext(funcion('menuVista')+'\n'+funcion('tecladoMenu'),ctx);
 ctx.tecladoMenu({key:'ArrowRight',target:botones[0],currentTarget:{querySelectorAll:()=>botones},preventDefault(){}});
 assert.equal(foco,botones[1]);assert.equal(cargas,0);assert.equal(paneles['menu-panel-cobertura'].hidden,true);
 ctx.menuVista('cobertura');assert.equal(cargas,1);assert.equal(botones[1].atributos['aria-selected'],'true');assert.equal(botones[1].tabIndex,0);assert.equal(paneles['menu-panel-regular'].hidden,true);
 ctx.menuVista('regular');ctx.menuVista('cobertura');assert.equal(cargas,1);assert.equal(ctx.MENU_COBERTURA_SEMANAL.borrador,'texto aún no publicado');
 for(const [key,index] of [['Home',0],['End',1],['ArrowLeft',0]]){ctx.tecladoMenu({key,target:foco,currentTarget:{querySelectorAll:()=>botones},preventDefault(){}});assert.equal(foco,botones[index]);}
 ctx.PANEL_ROL='monitoreo';ctx.menuVista('regular');assert.equal(paneles['menu-panel-cobertura'].hidden,false);
});

test('gerente conserva autorización de supervisores al moverla a Empleados, sin editar la plantilla ni menús',()=>{
 const campoEmpleado={disabled:false,closest:()=>null},campoSupervisor={disabled:false,closest:()=>({})},campoMenu={readOnly:false};
 const botonSup={disabled:false,getAttribute:()=> 'autorizarSupervisorCobertura()',closest:selector=>selector==='#p-empleados'||selector==='[data-supervisores]'?{}:null};
 const botonEmpleado={disabled:false,getAttribute:()=> 'guardarEmpleado()',closest:selector=>selector==='#p-empleados'?{}:null};
 const ctx=vm.createContext({PANEL_ROL:'gerente',document:{getElementById:id=>id==='aviso-rol-gerente'?{}:botonEmpleado,querySelectorAll:selector=>selector.startsWith('#p-menu')?[campoMenu]:selector.startsWith('#p-empleados')?[campoEmpleado,campoSupervisor]:[botonSup,botonEmpleado]}});
 vm.runInContext(funcion('aplicarPermisosPanel'),ctx);ctx.aplicarPermisosPanel();
 assert.equal(campoEmpleado.disabled,true);assert.equal(campoMenu.readOnly,true);assert.equal(botonEmpleado.disabled,true);assert.equal(campoSupervisor.disabled,false);assert.equal(botonSup.disabled,false);
});

test('Cocina consulta únicamente folios: no carga permisos, plantilla ni borradores de Menú',async()=>{
 const llamadas=[],ctx=vm.createContext({fechaComedor:()=> '2026-11-19',document:{getElementById:()=>({value:'2026-11-18'})},cargarSolicitudesCobertura:async f=>llamadas.push(f)});
 vm.runInContext(funcion('cargarCobertura'),ctx);await ctx.cargarCobertura();assert.deepEqual(llamadas,['2026-11-18']);
});

test('alerta de cocina sigue detectando folios nuevos aunque ya no exista la pestaña lateral Coberturas',()=>{
 const avisos=[],ctx=vm.createContext({PANEL_ROL:'admin',fechaComedor:()=> '2026-11-19',ackCobertura:()=>null,coberturaAlarma:null,activarAlarmaCobertura:d=>{avisos.push(d);ctx.coberturaAlarma=d;},detenerAlarmaCobertura:()=>{ctx.coberturaAlarma=null;}});
 vm.runInContext(funcion('evaluarCorteCobertura'),ctx);
 ctx.evaluarCorteCobertura({por_turno:[],avisos_lotes:[{id:5,revision:2,folio:'CE-05',total_porciones:3}]},'2026-11-19');
 assert.equal(avisos.length,1);assert.equal(avisos[0].solicitud,5);assert.equal(avisos[0].clave_ack,'lote:5|2');
 ctx.PANEL_ROL='monitoreo';ctx.evaluarCorteCobertura({por_turno:[],avisos_lotes:[{id:6,total_porciones:2}]},'2026-11-19');assert.equal(avisos.length,1);
});

test('Cocina separa pedido confirmado de entrega, colapsa folios y rechaza respuestas de otros turnos',async()=>{
 const campos={'cov-fecha':{value:'2026-11-19'},'cov-turno':{value:'turno_b'},covSolicitudes:{innerHTML:''},'cov-n-sol':{textContent:''},'cov-n-por':{textContent:''}},peticiones=[];
 const ctx=vm.createContext({api:()=>new Promise(resolve=>peticiones.push(resolve)),document:{getElementById:id=>campos[id]},evaluarCorteCobertura(){},horarioServicio:()=> '17:30',zonaTxt:()=> 'REFIS',ZONA_COMEDOR:'America/Mexico_City',Date});
 vm.runInContext(html.match(/  function escaparHtml\(s\) \{[^]*?\n  }/)[0]+'\nlet consultaFoliosCobertura=0;\n'+funcion('cargarSolicitudesCobertura'),ctx);
 const anterior=ctx.cargarSolicitudesCobertura('2026-11-19');campos['cov-turno'].value='turno_a';const actual=ctx.cargarSolicitudesCobertura('2026-11-19');
 const solicitud={id:1,folio:'CE-QA-1',estado:'confirmada',turno:'turno_a',fecha_servicio:'2026-11-19',zona:'zona_refris',responsable_nombre_snapshot:'Receptor QA',total_porciones:2,items:[{empleado_nombre_snapshot:'Persona 1',empleado_numero_snapshot:'0001',opcion_texto:'Platillo QA',entrega_conciliada_en:'2026-11-19T18:00:00Z'},{empleado_nombre_snapshot:'Persona 2',no_surtido_en:'2026-11-19T18:00:00Z',entregado_en:'2026-11-19T17:00:00Z'}]};
 peticiones[1]({total_solicitudes:1,total_porciones:2,solicitudes:[solicitud]});await actual;
 peticiones[0]({total_solicitudes:0,total_porciones:0,solicitudes:[]});await anterior;
 const h=campos.covSolicitudes.innerHTML;
 assert.match(h,/<details class="cov-solicitud"/);assert.doesNotMatch(h,/<details[^>]*\bopen/);assert.match(h,/Entregadas: 1/);assert.match(h,/Pedido confirmado/);assert.match(h,/No surtido · Sin cargo/);assert.match(h,/Comanda de este folio/);assert.equal(campos['cov-n-por'].textContent,2);
});

test('monitoreo conserva la vista de impresos de coberturas y la bitácora sin cargar altas ni GPS',()=>{
 const llamadas=[],ctx=vm.createContext({PANEL_ROL:'monitoreo',document:{querySelectorAll:()=>[],getElementById:()=>({value:'2026-11-19'})},cargarCobertura:()=>llamadas.push('folios'),consultarBitacora:()=>llamadas.push('bitacora')});
 vm.runInContext(funcion('cocinaVista'),ctx);ctx.cocinaVista('diaria');ctx.cocinaVista('reparto');ctx.cocinaVista('pruebas');assert.deepEqual(llamadas,['folios','bitacora']);
});
