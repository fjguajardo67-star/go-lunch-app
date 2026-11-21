import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../public/operacion.js';
const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const codigo=html.slice(html.indexOf('  const servicioPedidos ='),html.indexOf('  // ── Carga masiva'));
function panel(api) {
 const elementos=Object.fromEntries(['pe-fecha','pedidosBox','pedidosEstado','pedidosFolios'].map(id=>[id,{value:'2026-11-18',innerHTML:'',textContent:'',atributos:{},setAttribute(k,v){this.atributos[k]=v;},removeAttribute(k){delete this.atributos[k];}}]));
 let servicioActual='';
 const ctx=vm.createContext({api,Date,Intl,GoLunchOperacion,document:{getElementById:id=>elementos[id],querySelector:()=>({value:servicioActual})}});
 const escapar=html.match(/  function escaparHtml\(s\) \{[\s\S]*?\n  }/)[0];
 const horario=html.match(/  const horarioServicio = p => \{[\s\S]*?\n  };/)[0];
 const servicio=html.match(/  const servicioTexto = p => .*;/)[0];
 vm.runInContext(`const ZONA_COMEDOR='America/Mexico_City';const zonaTxt=z=>GoLunchOperacion.ZONAS[z]||z||'—';const etiquetaTurno=t=>t==='turno_a'?'Turno A':t==='turno_b'?'Turno B':'Sin turno';\n${escapar}\n${horario}\n${servicio}\n${codigo}`,ctx);
 return {ctx,elementos,consultar:()=>ctx.verPedidos(),filtrar:s=>{servicioActual=s;return ctx.verPedidos();}};
}
const comida=(tipo='regular',extra={})=>({tipo,fecha_menu:'2026-11-18',empleados:{nombre:'Persona ficticia',numero_empleado:'00001'},opcion_texto:'Pechuga Empanizada',turno:'turno_b',zona:'zona_refris',entregado_en:null,...extra});

test('Pedidos reúne comidas de la misma persona, conserva horario propio, folio y estados con incidencia prioritaria',async()=>{
 const comidas=[comida('regular',{entregado_en:'2026-11-18T23:04:00Z'}),comida('cobertura',{folio:'CE-QA-01',origen:'extraordinaria',entrega_programada_en:'2026-11-19T00:20:00Z',entrega_conciliada_en:'2026-11-19T08:00:00Z'}),comida('regular',{entregado_en:'2026-11-18T23:04:00Z',no_surtido_en:'2026-11-19T08:00:00Z'}),comida()];
 const rutas=[],p=panel(async ruta=>{rutas.push(ruta);return {count:4,comidas};});await p.consultar();
 assert.deepEqual(rutas,['/api/comidas/2026-11-18']);
 const tabla=p.elementos.pedidosBox.innerHTML,estado=p.elementos.pedidosEstado.textContent;
 assert.equal((tabla.match(/scope="row"/g)||[]).length,4);assert.equal((tabla.match(/N.º 00001/g)||[]).length,4);
 assert.match(tabla,/Cobertura extraordinaria/);assert.match(tabla,/CE-QA-01/);assert.match(tabla,/18:20/);assert.match(tabla,/17:04/);assert.doesNotMatch(tabla,/02:00/);
 assert.equal((tabla.match(/class="pedido-entregado"/g)||[]).length,2);
 assert.match(tabla,/Reportada como entregada por el administrador/);assert.match(tabla,/No surtido · Sin cargo/);assert.match(tabla,/Pendiente de registro/);
 assert.match(estado,/4 comidas: 3 regulares \+ 1 cobertura/);assert.match(estado,/Entregadas: 2 · Pendientes de registro: 1 · No surtidas sin cargo: 1/);
 assert.match(tabla,/tabindex="0" role="region"/);assert.match(tabla,/<caption>/);assert.match(tabla,/<thead>/);assert.equal(p.elementos.pedidosBox.atributos['aria-busy'],undefined);
});

test('vacío, error de coberturas y respuesta incompleta nunca muestran una lista parcial ni HTML inseguro',async()=>{
 for(const api of [async()=>({count:0,comidas:[]}),async()=>{throw Error('<img src=x onerror=alert(1)>');},async()=>({count:2,comidas:[comida()]})]){
  const p=panel(api);await p.consultar();assert.equal(p.elementos.pedidosBox.innerHTML,'');assert.ok(p.elementos.pedidosEstado.textContent);assert.equal(p.elementos.pedidosBox.atributos['aria-busy'],undefined);
 }
 const p=panel(async()=>({count:1,comidas:[comida('cobertura',{folio:'<script>folio</script>',opcion_texto:'<img src=x>',empleados:{nombre:'<b>Persona</b>',numero_empleado:'00001'}})]}));await p.consultar();
 assert.doesNotMatch(p.elementos.pedidosBox.innerHTML,/<script>|<img|<b>/);assert.match(p.elementos.pedidosBox.innerHTML,/&lt;script&gt;/);
});

test('consultas anteriores no reemplazan la fecha nueva y cambiar fecha limpia resultados previos',async()=>{
 const solicitudes=[];const p=panel(()=>new Promise((resolve,reject)=>solicitudes.push({resolve,reject})));
 const primera=p.consultar();p.elementos['pe-fecha'].value='2026-11-19';const segunda=p.consultar();
 solicitudes[1].resolve({count:1,comidas:[comida('regular',{opcion_texto:'Platillo nuevo'})]});await segunda;
 solicitudes[0].resolve({count:1,comidas:[comida('regular',{opcion_texto:'Platillo anterior'})]});await primera;
 assert.match(p.elementos.pedidosBox.innerHTML,/Platillo nuevo/);assert.doesNotMatch(p.elementos.pedidosBox.innerHTML,/Platillo anterior/);
 p.ctx.limpiarPedidos();assert.equal(p.elementos.pedidosBox.innerHTML,'');
 const tercera=p.consultar();p.ctx.limpiarPedidos();solicitudes[2].reject(Error('Error anterior'));await tercera;
 assert.doesNotMatch(p.elementos.pedidosEstado.textContent,/Error anterior/);
 p.elementos['pe-fecha'].value='';await p.consultar();assert.match(p.elementos.pedidosEstado.textContent,/Selecciona una fecha/);assert.equal(solicitudes.length,3);
});

test('Todos, Regulares y Coberturas consultan y cuentan la misma lista según el servicio elegido',async()=>{
 const rutas=[],todas=[comida(),comida('cobertura',{folio:'CE-01',responsable_nombre:'Responsable QA',responsable_numero:'00009'})];
 const p=panel(async ruta=>{rutas.push(ruta);const servicio=new URL(ruta,'http://qa').searchParams.get('servicio');const comidas=todas.filter(x=>!servicio||x.tipo===servicio);return {count:comidas.length,comidas};});
 await p.consultar();assert.match(p.elementos.pedidosEstado.textContent,/2 comidas: 1 regular \+ 1 cobertura/);
 await p.filtrar('regular');assert.match(p.elementos.pedidosEstado.textContent,/1 comida: 1 regular \+ 0 coberturas/);assert.equal(p.elementos.pedidosFolios.innerHTML,'');
 await p.filtrar('cobertura');assert.match(p.elementos.pedidosEstado.textContent,/1 comida: 0 regulares \+ 1 cobertura/);
 assert.match(p.elementos.pedidosFolios.innerHTML,/Responsable QA · N.º 00009/);assert.match(p.elementos.pedidosFolios.innerHTML,/<details class="pedido-folio"/);assert.doesNotMatch(p.elementos.pedidosFolios.innerHTML,/<details[^>]*\bopen/);
 assert.match(rutas[1],/\?servicio=regular$/);assert.match(rutas[2],/\?servicio=cobertura$/);
});

test('cambiar filtro durante una consulta descarta la respuesta anterior y no borra el detalle nuevo',async()=>{
 const peticiones=[],p=panel(()=>new Promise(resolve=>peticiones.push(resolve)));
 const anterior=p.consultar(),nueva=p.filtrar('cobertura');
 peticiones[1]({count:1,comidas:[comida('cobertura',{folio:'CE-NUEVO'})]});await nueva;
 peticiones[0]({count:1,comidas:[comida('regular',{opcion_texto:'Dato anterior'})]});await anterior;
 assert.match(p.elementos.pedidosFolios.innerHTML,/CE-NUEVO/);assert.doesNotMatch(p.elementos.pedidosBox.innerHTML,/Dato anterior/);
 p.ctx.limpiarPedidos();assert.equal(p.elementos.pedidosFolios.innerHTML,'');
});

test('detalle de folio mantiene comidas separadas, receptor y estados sin atribuir entrega a una incidencia',()=>{
 const p=panel(async()=>({}));
 const comidas=[comida('cobertura',{folio:'<FOLIO>',responsable_nombre:'Recibe <QA>',entregado_en:'2026-11-18T23:00:00Z',no_surtido_en:'2026-11-19T00:00:00Z'}),comida('cobertura',{folio:'<FOLIO>',entrega_conciliada_en:'2026-11-19T01:00:00Z'}),comida('regular')];
 const h=p.ctx.detalleFoliosPedidos(comidas);
 assert.equal((h.match(/scope="row"/g)||[]).length,2);assert.equal((h.match(/class="pedido-entregado"/g)||[]).length,1);assert.match(h,/<thead>/);assert.match(h,/Hora prevista/);assert.doesNotMatch(h,/<ul>|<li>/);assert.match(h,/2 comidas · Entregadas: 1/);assert.match(h,/No surtido · Sin cargo/);assert.match(h,/Recibe &lt;QA&gt;/);assert.doesNotMatch(h,/<FOLIO>|<QA>/);
});
