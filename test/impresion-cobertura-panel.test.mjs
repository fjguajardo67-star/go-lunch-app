import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const funcion=html.match(/function urlImpresoCobertura\([\s\S]*?\n  }/)[0];
function preparar(tamano) {
 const campos={'cov-turno':{value:'turno_b'},'im-tamano':{value:'100x62'}};
 if(tamano)campos['cov-tamano']={value:tamano};
 const c=vm.createContext({document:{getElementById:id=>campos[id]},API_BASE:'https://ejemplo.test',ADMIN_KEY:'prueba'});
 vm.runInContext(funcion,c);
 return expresion=>new URL(vm.runInContext(expresion,c));
}

test('Coberturas usa 200 mm aunque Cocina conserve 100 mm, para turno y folio',()=>{
 const selector=html.match(/<select id="cov-tamano"[\s\S]*?<\/select>/)[0];
 const valorInicial=selector.match(/<option value="([^"]+)" selected>/)[1];
 const url=preparar(valorInicial);
 for(const seleccion of ['{}',"{solicitud:123}"]) {
  const p=url(`urlImpresoCobertura('etiquetas','2026-11-11',false,'turno_b',${seleccion})`).searchParams;
  assert.equal(p.get('ancho'),'200');assert.equal(p.get('alto'),'62');
  assert.equal(p.get('turno'),'turno_b');
  if(seleccion!=='{}')assert.equal(p.get('solicitud'),'123');
 }
});

test('permite elegir el tamaño anterior en Coberturas y conserva la comanda de 58 mm',()=>{
 const url=preparar('100x62');
 assert.equal(url("urlImpresoCobertura('etiquetas','2026-11-11')").searchParams.get('ancho'),'100');
 assert.equal(url("urlImpresoCobertura('comanda','2026-11-11')").searchParams.get('ancho'),'58');
 assert.equal(preparar()("urlImpresoCobertura('etiquetas','2026-11-11')").searchParams.get('ancho'),'200');
});
