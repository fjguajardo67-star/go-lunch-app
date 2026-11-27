import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
process.env.TZ='America/Mexico_City';
const {toleranciaEntrega,limiteEntrega,esEntregaTardia}=await import('../services/menu.js');
const {limiteComida,tardiaComida}=await import('../services/comidas.js');
const {construirDashboard}=await import('../services/dashboard.js');
const fecha='2026-11-26',refis='zona_refris',asla='zona_vdc';
const regular=(zona=refis,turno='turno_a',entregado_en=fecha+'T10:20:00-06:00')=>({id:1,fecha_menu:fecha,zona,turno,entregado_en,empleados:{numero_empleado:'00123',nombre:'QA'}});
const cobertura={...regular(refis,'turno_b'),tipo:'cobertura',entrega_programada_en:fecha+'T17:30:00-06:00'};
test('20 minutos desde el 26; el límite exacto cuenta a tiempo y un segundo después es tardía',()=>{
 assert.equal(toleranciaEntrega('2026-11-25'),15);assert.equal(toleranciaEntrega(fecha),20);assert.equal(toleranciaEntrega('2027-01-01'),20);
 for(const [zona,turno,limite] of [[refis,'turno_a','10:20'],[asla,'turno_a','10:20'],[refis,'turno_b','17:50'],[asla,'turno_b','18:20']]) {
  assert.equal(limiteEntrega(fecha,turno,zona).toFormat('HH:mm'),limite);
  assert.equal(esEntregaTardia(fecha,turno,fecha+'T'+limite+':00-06:00',zona),false);
  assert.equal(esEntregaTardia(fecha,turno,fecha+'T'+limite+':01-06:00',zona),true);
 }
 assert.equal(esEntregaTardia('2026-11-25','turno_a','2026-11-25T10:15:01-06:00',refis),true);
});
test('regulares, cobertura programada y extraordinaria comparten la misma vigencia sin inventar hora administrativa',()=>{
 assert.equal(tardiaComida(regular()),false);
 assert.equal(limiteComida(cobertura).toFormat('HH:mm'),'17:50');
 assert.equal(tardiaComida({...cobertura,entregado_en:fecha+'T17:50:00-06:00'}),false);
 assert.equal(tardiaComida({...cobertura,entregado_en:fecha+'T17:50:01-06:00'}),true);
 assert.equal(limiteComida({...cobertura,entrega_programada_en:fecha+'T17:40:00-06:00'}).toFormat('HH:mm'),'18:00');
 assert.equal(limiteComida({...cobertura,fecha_menu:'2026-11-25',entrega_programada_en:'2026-11-25T17:30:00-06:00'}).toFormat('HH:mm'),'17:45');
 assert.equal(tardiaComida({...cobertura,entregado_en:null,entrega_conciliada_en:'marca-admin'}),null);
});
test('Dashboard coincide con el cálculo de comidas para ambos tipos y el instante límite',()=>{
 for(const segundo of ['00','01']){
  const entrega=fecha+'T10:20:'+segundo+'-06:00';
  const d=construirDashboard({fecha,empleados:[],pedidos:[regular(refis,'turno_a',entrega)],
   coberturas:[{...cobertura,empleado_numero_snapshot:'00456',empleado_nombre_snapshot:'Cobertura QA',entrega_programada_en:fecha+'T10:00:00-06:00',entregado_en:entrega}]});
  const filas=d.filas;
  assert.ok(Array.isArray(filas));assert.equal(filas.length,2);
  for(const p of filas)assert.equal(p.estado,segundo==='00'?'entregado':'tardia');
 }
});
test('reparto sin señal ignora la tolerancia antigua de caché y respeta fechas históricas',()=>{
 const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
 const fn=n=>html.match(new RegExp('function '+n+'\\([\\s\\S]*?\\n  }'))[0];
 const c=vm.createContext({FECHA:fecha,ZONA:refis,TOLERANCIA_MIN:15});
 vm.runInContext(readFileSync(new URL('../public/operacion.js',import.meta.url),'utf8'),c);
 vm.runInContext(fn('limiteDelTurno')+'\n'+fn('limiteDelPedido'),c);
 assert.equal(c.limiteDelTurno('turno_b').toISOString(),'2026-11-26T23:50:00.000Z');
 assert.equal(c.limiteDelPedido(cobertura).toISOString(),'2026-11-26T23:50:00.000Z');
 c.FECHA='2026-11-25';c.TOLERANCIA_MIN=20;
 assert.equal(c.limiteDelTurno('turno_b').toISOString(),'2026-11-25T23:45:00.000Z');
});

test('HTML nuevo conserva la tolerancia aunque el service worker entregue el helper de v92',()=>{
 const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
 const funciones=['limiteDelTurno','limiteDelPedido'].map(n=>html.match(new RegExp('function '+n+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
 const c=vm.createContext({FECHA:fecha,ZONA:refis,TOLERANCIA_MIN:15,GoLunchOperacion:{horaEntrega:()=> '17:30'}});
 vm.runInContext(funciones,c);
 assert.equal(c.limiteDelTurno('turno_b').toISOString(),'2026-11-26T23:50:00.000Z');
 assert.equal(c.limiteDelPedido(cobertura).toISOString(),'2026-11-26T23:50:00.000Z');
});
