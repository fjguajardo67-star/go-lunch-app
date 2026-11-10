import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
const funcion=nombre=>html.match(new RegExp('(?:async )?function '+nombre+'\\([\\s\\S]*?\\n  }'))[0];
const servicio={id:'regular|turno_a',turno:'turno_a'};
function contexto(usuario=20) {
 const almacenamiento=new Map(); const acciones=[];
 const c=vm.createContext({SERVICIO_ID:'regular|turno_b',SERVICIO_INICIADO:true,TURNO:'turno_b',SUPERVISOR_ACTUAL:'Receptor anterior',
  SESION:{repartidor:{id:usuario}},FECHA:'2026-11-10',ZONA:'zona_refris',SERVICIO_MANUAL:true,ZONA_MANUAL:true,
  EPOCA_SESION:5,SYNC_ABORTADOR:{abort(){acciones.push('abortar');}},
  escaneando:true,pedidoEnMotivo:{id:1},RECEPTOR_PENDIENTE:{id:1},MANUAL_NUMERO:'001',
  PEDIDOS:[{id:1}],TODOS_PEDIDOS:[{id:1}],PUNTOS:[{id:1}],LLEGADAS_DIA:[{id:1}],
  RELOJ:{servidor:'ahora'},ULTIMA_DESCARGA:'ahora',ERROR_DESCARGA:false,
  COLA:[{numero_empleado:'001'}],LLEGADAS:[{zona:'zona_refris'}],
  LS:{servicio:'servicio',sesion:'sesion',clave:'clave',zona:'zona'},CLAVE:'clave-anterior',
  agenda:()=>[servicio],servicioActual:()=>servicio,
  leerLS:k=>almacenamiento.get(k),localStorage:{removeItem:k=>almacenamiento.delete(k)},
  $:()=>({textContent:'',classList:{add(){},remove(){}}}),
  detenerVigilancia:()=>acciones.push('gps'),detenerCamara:()=>acciones.push('camara'),
  cancelarManual:()=>acciones.push('manual'),cancelarReceptor:()=>acciones.push('receptor'),
  mostrarAviso:()=>acciones.push('aviso'),confirm:()=>{acciones.push('confirm');return true;}
 });
 for(const nombre of ['reiniciarContextoOperativo','restaurarServicio','cambiarUsuario'])vm.runInContext(funcion(nombre),c);
 return {c,almacenamiento,acciones};
}
test('otro repartidor de la misma zona no hereda servicio iniciado ni supervisor anterior',()=>{
 const {c,almacenamiento}=contexto();
 almacenamiento.set('servicio',{fecha:c.FECHA,zona:c.ZONA,id:servicio.id,iniciado:true,usuario:10,supervisor:'Anterior'});
 vm.runInContext('restaurarServicio()',c);
 assert.equal(c.SERVICIO_INICIADO,false);assert.equal(c.SERVICIO_ID,'');assert.equal(c.TURNO,'');assert.equal(c.SUPERVISOR_ACTUAL,'');
});
test('solo el mismo usuario, fecha y zona puede reanudar su servicio',()=>{
 const {c,almacenamiento}=contexto(10);
 almacenamiento.set('servicio',{fecha:c.FECHA,zona:c.ZONA,id:servicio.id,iniciado:true,usuario:10,supervisor:'Receptor actual'});
 vm.runInContext('restaurarServicio()',c);
 assert.equal(c.SERVICIO_INICIADO,true);assert.equal(c.TURNO,'turno_a');assert.equal(c.SUPERVISOR_ACTUAL,'Receptor actual');
 almacenamiento.get('servicio').fecha='2026-11-09';vm.runInContext('restaurarServicio()',c);assert.equal(c.SERVICIO_INICIADO,false);
});
test('cerrar o invalidar sesión corta cámara y GPS, invalida descargas y conserva colas',()=>{
 const {c,acciones}=contexto();const cola=JSON.stringify(c.COLA),llegadas=JSON.stringify(c.LLEGADAS);
 vm.runInContext('reiniciarContextoOperativo()',c);
 assert.equal(c.EPOCA_SESION,6);assert.equal(c.SERVICIO_INICIADO,false);assert.equal(c.SUPERVISOR_ACTUAL,'');
 assert.equal(c.ZONA,'');assert.equal(c.FECHA,'');assert.equal(c.PEDIDOS.length,0);assert.equal(c.TODOS_PEDIDOS.length,0);
 assert.equal(c.RELOJ,null);assert.equal(c.ERROR_DESCARGA,true);
 assert.deepEqual(acciones,['abortar','gps','camara','manual','receptor']);
 assert.equal(JSON.stringify(c.COLA),cola);assert.equal(JSON.stringify(c.LLEGADAS),llegadas);
});
test('una llegada por subir también impide cambiar de operador',()=>{
 const {c,acciones}=contexto();c.COLA=[];vm.runInContext('cambiarUsuario()',c);
 assert.deepEqual(acciones,['aviso']);assert.equal(c.SESION.repartidor.id,20);
});
test('cambio autorizado de operador vacía el contexto operativo y el servicio guardado',()=>{
 const {c,almacenamiento,acciones}=contexto();c.COLA=[];c.LLEGADAS=[];almacenamiento.set('servicio',{iniciado:true});
 vm.runInContext('cambiarUsuario()',c);
 assert.equal(c.SESION,null);assert.equal(c.CLAVE,'');assert.equal(c.SERVICIO_INICIADO,false);
 assert.equal(c.SUPERVISOR_ACTUAL,'');assert.equal(almacenamiento.has('servicio'),false);assert.ok(acciones.includes('camara'));
});
