import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/puntos-propuesta.js';
const {resumirMuestras,medir}=globalThis.GoLunchPuntos;
const p=(precision_m=8)=>({lat:17.94,lon:-102.16,precision_m});
test('captura precisa conserva coordenadas; rechaza GPS inválido o una falsa precisión por dispersión',()=>{
 const original=[p(),p(12),p(80)];assert.deepEqual(resumirMuestras(original),p());assert.equal(original[0].precision_m,8);
 for(const m of [[],[p(80)],[{...p(),lat:NaN}],[{...p(),lon:200}],[p(0)]])assert.throws(()=>resumirMuestras(m));
 assert.throws(()=>resumirMuestras([p(),{...p(),lat:18.1},p(),{...p(),lat:18.1}]));
});
test('GPS que responde sincrónicamente no deja un vigilante activo ni crea registros',async()=>{
 const borrados=[];const geo={watchPosition(ok){for(let i=0;i<8;i++)ok({coords:{latitude:17.94,longitude:-102.16,accuracy:8}});return 42;},clearWatch(id){borrados.push(id);}};
 assert.deepEqual(await medir(geo),p());assert.deepEqual(borrados,[42]);
});
test('permiso denegado, cancelación y ausencia de GPS dejan una captura recuperable',async()=>{
 await assert.rejects(medir(null),/ubicación disponible/);
 await assert.rejects(medir({watchPosition(_ok,error){error({code:1});return 1;},clearWatch(){}}),/Sin permiso/);
 const control=new AbortController();let limpio=false;
 const promesa=medir({watchPosition(){return 4;},clearWatch(id){limpio=id===4;}},{signal:control.signal});
 control.abort();await assert.rejects(promesa,e=>e.name==='AbortError');assert.equal(limpio,true);
});
test('el vencimiento sólo usa lecturas precisas obtenidas durante esta medición',async()=>{
 let limpio=false;
 const geo={watchPosition(ok){ok({coords:{latitude:17.94,longitude:-102.16,accuracy:8}});return 1;},clearWatch(){limpio=true;}};
 assert.deepEqual(await medir(geo,{limiteMs:2}),p());assert.equal(limpio,true);
});
