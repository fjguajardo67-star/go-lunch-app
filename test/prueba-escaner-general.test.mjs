import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
const fn=html.match(/function comprobarEscaner\([\s\S]*?\n  }/)[0];
const codigo='GOLUNCH|PRUEBA_ESCANER|V1';
function preparar(repartidor=null){
 const avisos=[];let cierres=0;
 const c=vm.createContext({QR_PRUEBA_ESCANER:codigo,SESION:repartidor?{repartidor}:null,
  escaneando:true,COLA:[{evidencia:'1'},{evidencia:'2'},{evidencia:'3'},{evidencia:'4'}],
  PEDIDOS:[{numero_empleado:'00123',entregado_en:null}],
  zonasAutorizadas:()=>repartidor?.zonas||['zona_vdc','zona_refris'],ZONAS_VALIDAS:['zona_vdc','zona_refris'],
  ZONA_TXT:{zona_vdc:'ASLA',zona_refris:'REFIS'},flash:(...a)=>avisos.push(a)});
 c.detenerCamara=()=>{cierres++;c.escaneando=false;};vm.runInContext(fn,c);
 return{c,avisos,cierres:()=>cierres};
}
test('Reparto general prueba la cámara sin sesión personal: cierra cámara y conserva cuatro registros y comidas',()=>{
 const q=preparar(),antes=JSON.stringify({cola:q.c.COLA,pedidos:q.c.PEDIDOS});
 assert.equal(q.c.comprobarEscaner(codigo,'camara'),true);
 assert.equal(q.cierres(),1);assert.equal(q.c.escaneando,false);
 assert.equal(q.avisos[0][0],'ok');assert.equal(q.avisos[0][1],'Prueba correcta');
 assert.match(q.avisos[0][2],/Reparto general/);assert.doesNotMatch(q.avisos[0][2],/permiso|identidad/);
 assert.equal(JSON.stringify({cola:q.c.COLA,pedidos:q.c.PEDIDOS}),antes);
});
test('sesión personal conserva validación de zonas y no concede permiso a una sesión sin zonas',()=>{
 const q=preparar({nombre:'QA',zonas:['zona_refris']});q.c.comprobarEscaner(codigo,'camara');
 assert.equal(q.avisos[0][0],'ok');assert.match(q.avisos[0][2],/REFIS/);
 const sin=preparar({nombre:'QA',zonas:[]});sin.c.comprobarEscaner(codigo,'camara');
 assert.equal(sin.avisos[0][0],'mal');assert.equal(sin.avisos[0][1],'Zona no autorizada');assert.equal(sin.cierres(),1);
});
test('el QR de prueba no se confirma por captura manual y una etiqueta normal continúa al flujo individual',()=>{
 const q=preparar();assert.equal(q.c.comprobarEscaner(codigo,'manual'),true);
 assert.equal(q.avisos[0][1],'Usa la cámara');assert.equal(q.cierres(),0);
 assert.equal(q.c.comprobarEscaner('00123|2026-11-26|zona_refris','camara'),false);assert.equal(q.cierres(),0);
});
