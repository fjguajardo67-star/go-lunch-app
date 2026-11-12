import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DateTime,Settings} from 'luxon';
import {estadoEdicionMenuFecha,validarMenuFecha,guardarMenuFecha,errorCambiarMenuFecha} from '../services/menu-cobertura.js';
import {autorizarPanel} from '../services/acceso-panel.js';
const opciones={opcion_1:'Pechuga Empanizada',opcion_2:'Mixta de Res',opcion_3:'Enchiladas Rojas'};
const ahora=DateTime.fromISO('2026-11-12T01:00:00Z'); // aún es 11 en México

test('la edición admite mañana sin pedidos; hoy, pasado y cualquier pedido no cancelado bloquean',()=>{
 assert.equal(estadoEdicionMenuFecha({activo:true},0,'2026-11-12',ahora).permitido,true);
 for(const fecha of ['2026-11-10','2026-11-11'])assert.equal(estadoEdicionMenuFecha({activo:true},0,fecha,ahora).permitido,false);
 assert.equal(estadoEdicionMenuFecha({activo:true},1,'2026-11-12',ahora).permitido,false);
 assert.equal(estadoEdicionMenuFecha(null,0,'2026-11-12',ahora).permitido,false);
 assert.equal(estadoEdicionMenuFecha({activo:false},0,'2026-11-12',ahora).permitido,false);
});
test('valida fecha y versión y no permite convertir la edición de un día en otro periodo',()=>{
 const original=Settings.now;Settings.now=()=>ahora.toMillis();
 try {
  const body={...opciones,version:'2026-11-11T23:00:00Z',fecha_inicio:'2027-01-01',fecha_final:'2027-12-31'};
  const m=validarMenuFecha('2026-11-12',body).menu;
  assert.equal(m.fecha_inicio,'2026-11-12');assert.equal(m.fecha_final,'2026-11-12');
  for(const f of ['2026-11-11','2026-02-30','texto'])assert.ok(validarMenuFecha(f,body).error);
  for(const version of [null,'ayer','2026-11-11T23:00:00'])assert.ok(validarMenuFecha('2026-11-12',{...body,version}).error);
  assert.ok(validarMenuFecha('2026-11-12',{...body,opcion_2:body.opcion_1}).error);
 }finally{Settings.now=original;}
});
test('guarda con versión en una sola transacción y propaga rechazo si entra un pedido',async()=>{
 let llamado;const menu={...opciones,fecha:'2026-11-12',version:'2026-11-11T23:00:00Z'};
 await guardarMenuFecha({rpc:async(n,p)=>{llamado={n,p};return{data:{menu}}}},menu);
 assert.equal(llamado.n,'cambiar_menu_cobertura_fecha');assert.equal(llamado.p.p_version,menu.version);
 assert.equal(llamado.p.p_fecha,menu.fecha);
 await assert.rejects(guardarMenuFecha({rpc:async()=>({error:new Error('menu_fecha_con_pedidos')})},menu),/menu_fecha_con_pedidos/);
 assert.equal(errorCambiarMenuFecha(new Error('menu_fecha_con_pedidos')).status,409);
 assert.match(errorCambiarMenuFecha(new Error('menu_fecha_version_obsoleta')).error,/consultar/);
});
test('el gerente no puede escribir por el nuevo endpoint de fecha',()=>{
 const antes=process.env.GERENTE_KEY;process.env.GERENTE_KEY='gerente-prueba-fecha';
 let status,next=false;
 try{
  autorizarPanel({headers:{'x-admin-key':'gerente-prueba-fecha','x-panel-user':'gerente'},method:'POST',path:'/cobertura/menu/2026-11-12'},
   {status(s){status=s;return this},json(){}},()=>{next=true});
  assert.equal(status,403);assert.equal(next,false);
 }finally{if(antes===undefined)delete process.env.GERENTE_KEY;else process.env.GERENTE_KEY=antes;}
});

const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const codigo=html.slice(html.indexOf('  let MENU_DIA_CARGADO'),html.indexOf('  let MENU_COBERTURA_PERIODO_ID'));
function panel(rol='admin'){
 const ids=['cov-dia-fecha','cov-dia-op1','cov-dia-op2','cov-dia-op3','cov-dia-guardar','cov-dia-consultar','cov-dia-estado','covDiaAviso'];
 const campos=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,readOnly:false}]));
 campos['cov-dia-fecha'].value='2026-11-12';
 const consultas=[],avisos=[];
 const c=vm.createContext({document:{getElementById:id=>campos[id]},PANEL_ROL:rol,Date,fechaComedor:()=> '2026-11-11',
  api:(url,opts)=>new Promise((resolve,reject)=>consultas.push({url,opts,resolve,reject})),
  aviso:(...x)=>avisos.push(x),mostrarPeriodoMenuCobertura:()=>{}});
 vm.runInContext(codigo,c);
 return {campos,c,consultas,avisos};
}
const respuesta={menu:{...opciones,actualizado_en:'2026-11-11T23:00:00Z'},edicion:{permitido:true,motivo:'Sin pedidos activos.'}};
test('al cambiar rápidamente de fecha no se muestran las opciones de la consulta anterior',async()=>{
 const p=panel();const a=vm.runInContext('cargarMenuDiaCobertura()',p.c);
 p.campos['cov-dia-fecha'].value='2026-11-13';const b=vm.runInContext('cargarMenuDiaCobertura()',p.c);
 p.consultas[1].resolve({...respuesta,menu:{...respuesta.menu,opcion_1:'Menú del 13'}});await b;
 p.consultas[0].resolve(respuesta);await a;
 assert.equal(p.campos['cov-dia-op1'].value,'Menú del 13');
});
test('el formulario guarda solo la fecha consultada y bloquea reintentos tras un conflicto',async()=>{
 const p=panel();let trabajo=vm.runInContext('cargarMenuDiaCobertura()',p.c);p.consultas[0].resolve(respuesta);await trabajo;
 trabajo=vm.runInContext('guardarMenuDiaCobertura()',p.c);
 assert.equal(p.consultas[1].url,'/api/cobertura/menu/2026-11-12');
 assert.equal(JSON.parse(p.consultas[1].opts.body).version,respuesta.menu.actualizado_en);
 assert.equal(p.campos['cov-dia-fecha'].disabled,true);
 p.consultas[1].reject(new Error('Ya hay pedidos'));await trabajo;
 assert.equal(p.campos['cov-dia-guardar'].disabled,true);
 assert.match(p.campos['cov-dia-estado'].textContent,/Consultar menú/);
 await vm.runInContext('guardarMenuDiaCobertura()',p.c);assert.equal(p.consultas.length,2);
});
test('un día bloqueado y una sesión gerente mantienen el formulario de solo lectura',async()=>{
 for(const [rol,r] of [['admin',{...respuesta,edicion:{permitido:false,motivo:'Con pedidos'}}],['gerente',respuesta]]){
  const p=panel(rol);const trabajo=vm.runInContext('cargarMenuDiaCobertura()',p.c);p.consultas[0].resolve(r);await trabajo;
  assert.equal(p.campos['cov-dia-op1'].readOnly,true);assert.equal(p.campos['cov-dia-guardar'].disabled,true);
 }
});
