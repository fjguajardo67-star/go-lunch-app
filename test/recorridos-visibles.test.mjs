import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
const fn=nombre=>html.match(new RegExp('(?:async )?function '+nombre+'\\([\\s\\S]*?\\n  }'))[0];
test('escaneo directo elimina acciones de recorrido pero conserva íntegra la cola histórica ante fallo de red',async()=>{
 for(const accion of ['accionBitacora','registrarLlegada','comenzarEntrega','finalizarReparto'])assert.doesNotMatch(html,new RegExp('onclick="'+accion+'\\('));
 const pendientes=Array.from({length:44},(_,i)=>({fecha:'2026-11-25',ruta:'turno_a_asla',paso:i,ocurrido_en:'2026-11-25T10:00:00-06:00'}));
 const bitacora={pendientes,confirmadas:[],rechazadas:[{evidencia:'conservar'}]};
 const c=vm.createContext({FECHA:'2026-11-26',SESION:{token:'QA'},EPOCA_SESION:1,API_BASE:'',CLAVE:'',
  BITACORA:structuredClone(bitacora),AVISO_BITACORA:'',cabecerasAuth:()=>({}),pintar:()=>{},
  fetch:async()=>{throw Error('Sin señal');}});
 vm.runInContext(fn('sincronizarBitacora'),c);await c.sincronizarBitacora({aborted:false});
 assert.equal(JSON.stringify(c.BITACORA),JSON.stringify(bitacora));assert.match(c.AVISO_BITACORA,/siguen en el teléfono/);
});
test('las marcas previas aceptadas se sincronizan, sin crear salidas ni llegadas nuevas',async()=>{
 const marca={fecha:'2026-11-26',ruta:'turno_a_refis',paso:0,ocurrido_en:'2026-11-26T09:00:00-06:00'},envios=[];
 const c=vm.createContext({FECHA:marca.fecha,SESION:{token:'QA'},EPOCA_SESION:1,API_BASE:'',CLAVE:'',
  BITACORA:{pendientes:[marca],confirmadas:[],rechazadas:[]},AVISO_BITACORA:'',cabecerasAuth:()=>({}),pintar:()=>{},rutaEnCurso:()=>null,
  fetch:async(_url,opciones)=>{
   if(opciones.method==='POST'){envios.push(JSON.parse(opciones.body));return{ok:true,json:async()=>({marca})};}
   return{ok:true,json:async()=>({fecha:marca.fecha,marcas:[marca],ocupadas:[]})};
  }});
 c.guardarBitacora=datos=>{c.BITACORA=datos;};
 vm.runInContext(fn('sincronizarBitacora'),c);await c.sincronizarBitacora({aborted:false});
 assert.deepEqual(envios,[marca]);assert.equal(c.BITACORA.pendientes.length,0);assert.equal(c.BITACORA.confirmadas.length,1);
});
