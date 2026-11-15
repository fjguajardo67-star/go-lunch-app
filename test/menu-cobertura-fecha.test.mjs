import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DateTime,Settings} from 'luxon';
import {estadoEdicionMenuFecha,validarMenuFecha,guardarMenuFecha,errorCambiarMenuFecha} from '../services/menu-cobertura.js';
import {autorizarPanel} from '../services/acceso-panel.js';
const opciones={opcion_1:'Pechuga Empanizada',opcion_2:'Mixta de Res',opcion_3:'Enchiladas Rojas'};
const ahora=DateTime.fromISO('2026-11-12T01:00:00Z'); // aún es 11 en México

test('publica hoy y fechas futuras, conserva folios existentes y deja el pasado como consulta',()=>{
 assert.equal(estadoEdicionMenuFecha({activo:true},0,'2026-11-12',ahora).permitido,true);
 assert.equal(estadoEdicionMenuFecha({activo:true},2,'2026-11-11',ahora).permitido,true);
 assert.match(estadoEdicionMenuFecha({activo:true},2,'2026-11-11',ahora).motivo,/conservarán/);
 assert.equal(estadoEdicionMenuFecha({activo:true},0,'2026-11-10',ahora).permitido,false);
 assert.equal(estadoEdicionMenuFecha(null,0,'2026-11-12',ahora).permitido,true);
 assert.equal(estadoEdicionMenuFecha({activo:false},0,'2026-11-12',ahora).permitido,true);
});
test('valida fecha y versión y no permite convertir la edición de un día en otro periodo',()=>{
 const original=Settings.now;Settings.now=()=>ahora.toMillis();
 try {
  const body={...opciones,version:'2026-11-11T23:00:00Z',fecha_inicio:'2027-01-01',fecha_final:'2027-12-31'};
  const m=validarMenuFecha('2026-11-12',body).menu;
  assert.equal(m.fecha_inicio,'2026-11-12');assert.equal(m.fecha_final,'2026-11-12');
  for(const f of ['2026-11-10','2026-02-30','texto'])assert.ok(validarMenuFecha(f,body).error);
  assert.equal(validarMenuFecha('2026-11-11',{...body,version:null}).menu.version,null);
  assert.ok(validarMenuFecha('2026-11-12',opciones).error);
  for(const version of ['ayer','2026-11-11T23:00:00'])assert.ok(validarMenuFecha('2026-11-12',{...body,version}).error);
  assert.ok(validarMenuFecha('2026-11-12',{...body,opcion_2:body.opcion_1}).error);
 }finally{Settings.now=original;}
});
test('guarda un día con versión en una sola transacción y propaga conflictos',async()=>{
 let llamado;const menu={...opciones,fecha:'2026-11-12',version:'2026-11-11T23:00:00Z'};
 await guardarMenuFecha({rpc:async(n,p)=>{llamado={n,p};return{data:{menu}}}},menu);
 assert.equal(llamado.n,'publicar_menu_cobertura_dia');assert.equal(llamado.p.p_version,menu.version);
 assert.equal(llamado.p.p_fecha,menu.fecha);
 await assert.rejects(guardarMenuFecha({rpc:async()=>({error:new Error('menu_fecha_version_obsoleta')})},menu),/menu_fecha_version_obsoleta/);
 assert.equal(errorCambiarMenuFecha(new Error('menu_fecha_pasada')).status,409);
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

const c=vm.createContext({window:{},Date,Intl});
vm.runInContext(readFileSync(new URL('../public/menu-cobertura-semanal.js',import.meta.url),'utf8'),c);
test('la semana siempre muestra lunes a domingo y conserva fechas al cruzar mes y año',()=>{
 const {lunes,sumar}=c.window.MenuCoberturaSemanal;
 assert.equal(lunes('2026-11-13'),'2026-11-09');
 assert.equal(lunes('2026-11-15'),'2026-11-09');
 assert.equal(lunes('2026-11-16'),'2026-11-16');
 assert.equal(lunes('2027-01-01'),'2026-12-28');
 assert.equal(sumar('2026-12-28',6),'2027-01-03');
 assert.equal(sumar('2028-02-28',1),'2028-02-29');
});
