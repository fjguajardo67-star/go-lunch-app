import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const codigo=readFileSync(new URL('../public/entregas-admin.js',import.meta.url),'utf8');
const items=[
  {tipo:'regular',id:1,version:'r1',nombre:'Persona <uno>',numero_empleado:'00001',platillo:'Pollo <especial>',zona:'zona_vdc',turno:'turno_b',horario:'18:00',folio:null},
  {tipo:'cobertura',id:1,version:'c1',nombre:'Persona dos',numero_empleado:'00002',platillo:'Arroz',zona:'zona_refris',turno:'turno_b',horario:'17:30',folio:'CE-QA'},
  {tipo:'regular',id:2,version:'r2',nombre:'Persona tres',numero_empleado:'00003',platillo:'Omelet',zona:'zona_vdc',turno:'turno_a',horario:'10:00'}
];
function control() {
  return {value:'',checked:false,disabled:false,hidden:false,innerHTML:'',textContent:'',dataset:{},eventos:{},
    addEventListener(nombre,fn){this.eventos[nombre]=fn;},focus(){this.enfocado=true;},
    disparar(nombre,datos={}){return this.eventos[nombre]?.({target:this,preventDefault(){},...datos});}};
}
function preparar({api,permiso=true}={}) {
  const elementos=Object.fromEntries(['campos','lista','error','enviar','turno','zona','tipo','todas','seleccion','confirmado','cancelar','reintentar','estado','vacio','motivo','fecha'].map(id=>[id,control()]));
  const form=control();form.reportValidity=()=>elementos.confirmado.checked && elementos.motivo.value.length>=10;
  form.reset=()=>Object.values(elementos).forEach(c=>{c.value='';c.checked=false;});
  const dialogo=control();dialogo.open=false;dialogo.showModal=()=>{dialogo.open=true;};dialogo.close=()=>{dialogo.open=false;dialogo.disparar('close');};
  dialogo.querySelector=s=>s==='form'?form:elementos[s.replace('#ea-','')];
  const solicitudes=[],resultados=[];
  const ctx=vm.createContext({});vm.runInContext(codigo,ctx);
  const panel=ctx.GoLunchEntregasAdmin.montar({dialogo,puedeRegistrar:()=>permiso,uuid:()=> '11111111-1111-4111-8111-111111111111',
    api:async(url,opts)=>{solicitudes.push({url,opts});return api?api(url,opts):opts?{registradas:3}:{items};},
    alActualizar:async r=>resultados.push(r)});
  const seleccionar=()=>{elementos.todas.checked=true;elementos.todas.disparar('change');};
  const confirmar=()=>{elementos.motivo.value='Entrega verificada por el administrador';elementos.confirmado.checked=true;};
  return {ctx,panel,dialogo,form,elementos,solicitudes,resultados,seleccionar,confirmar};
}

test('abre pendientes sin seleccionarlos y escapa nombres y platillos',async()=>{
  const p=preparar();await p.panel.abrir('2026-11-20');
  assert.equal(p.dialogo.open,true);assert.equal(p.elementos.enviar.disabled,true);
  assert.match(p.elementos.lista.innerHTML,/Persona &lt;uno&gt;/);
  assert.doesNotMatch(p.elementos.lista.innerHTML,/<uno>|<especial>/);
  assert.match(p.elementos.lista.innerHTML,/N.º 00001/);assert.match(p.elementos.lista.innerHTML,/17:30/);
  await p.form.disparar('submit');assert.equal(p.solicitudes.length,1);
});
test('filtra por turno, zona y servicio; cambiar filtros limpia la seleccion y la confirmacion',async()=>{
  const p=preparar();await p.panel.abrir('2026-11-20');p.seleccionar();p.confirmar();
  p.elementos.turno.value='turno_b';p.elementos.turno.disparar('change');
  assert.equal(p.elementos.enviar.disabled,true);assert.equal(p.elementos.confirmado.checked,false);
  assert.doesNotMatch(p.elementos.lista.innerHTML,/Persona tres/);
  p.elementos.zona.value='zona_refris';p.elementos.zona.disparar('change');
  p.elementos.tipo.value='cobertura';p.elementos.tipo.disparar('change');
  p.seleccionar();p.confirmar();await p.form.disparar('submit');
  const cuerpo=JSON.parse(p.solicitudes[1].opts.body);
  assert.deepEqual(cuerpo.items,[{tipo:'cobertura',id:1,version:'c1'}]);
  assert.equal(cuerpo.confirmado,true);assert.equal(cuerpo.fecha,'2026-11-20');
});
test('requiere confirmacion fisica y conserva identidad al mezclar regular y cobertura con el mismo id',async()=>{
  const p=preparar();await p.panel.abrir('2026-11-20');p.seleccionar();
  p.elementos.motivo.value='Falla operativa verificada';await p.form.disparar('submit');assert.equal(p.solicitudes.length,1);
  p.confirmar();await p.form.disparar('submit');
  const cuerpo=JSON.parse(p.solicitudes[1].opts.body);
  assert.equal(cuerpo.items.length,3);assert.equal(new Set(cuerpo.items.map(f=>f.tipo+':'+f.id)).size,3);
  assert.equal(cuerpo.autor,undefined);assert.equal(cuerpo.entregado_en,undefined);
  assert.equal(p.dialogo.open,false);assert.equal(p.resultados.length,1);
});
test('no permite usar la accion sin permiso, aunque se invoque desde JavaScript',async()=>{
  const p=preparar({permiso:false});await p.panel.abrir('2026-11-20');
  assert.equal(p.dialogo.open,false);assert.equal(p.solicitudes.length,0);
});
test('si se pierde la respuesta conserva motivo, seleccion y clave de reintento',async()=>{
  let fallar=true;
  const p=preparar({api:async(_url,opts)=>{if(!opts)return {items};if(fallar)throw Error('Sin conexion');return {registradas:3};}});
  await p.panel.abrir('2026-11-20');p.seleccionar();p.confirmar();await p.form.disparar('submit');
  assert.match(p.elementos.error.textContent,/Sin conexion/);assert.equal(p.dialogo.open,true);
  assert.equal(p.elementos.motivo.value,'Entrega verificada por el administrador');
  fallar=false;await p.form.disparar('submit');
  assert.equal(p.solicitudes[1].opts.body,p.solicitudes[2].opts.body);assert.equal(p.resultados.length,1);
});
test('un conflicto impide reenviar hasta volver a consultar y no borra el motivo',async()=>{
  const p=preparar({api:async(_url,opts)=>{if(!opts)return {items};throw Object.assign(Error('Cambió una entrega'),{status:409});}});
  await p.panel.abrir('2026-11-20');p.seleccionar();p.confirmar();await p.form.disparar('submit');
  assert.equal(p.elementos.enviar.disabled,true);assert.equal(p.elementos.reintentar.hidden,false);
  await p.form.disparar('submit');assert.equal(p.solicitudes.length,2);
  await p.elementos.reintentar.disparar('click');
  assert.equal(p.elementos.motivo.value,'Entrega verificada por el administrador');assert.equal(p.elementos.enviar.disabled,true);
});
test('cerrar durante una consulta descarta su respuesta y no repinta una apertura nueva',async()=>{
  let resolver;const p=preparar({api:()=>new Promise(r=>{resolver=r;})});
  const carga=p.panel.abrir('2026-11-20');p.dialogo.close();resolver({items});await carga;
  assert.equal(p.elementos.lista.innerHTML,'');assert.equal(p.dialogo.open,false);
});
test('volver a abrir empieza en la fecha y filtros, sin conservar el desplazamiento anterior',async()=>{
  const p=preparar();await p.panel.abrir('2026-11-20');
  p.dialogo.scrollTop=600;p.elementos.lista.scrollTop=150;p.dialogo.close();
  await p.panel.abrir('2026-11-20');
  assert.equal(p.dialogo.scrollTop,0);assert.equal(p.elementos.lista.scrollTop,0);
});
test('doble envio registra una vez y Cancelar permite salir durante la espera',async()=>{
  let resolver;const p=preparar({api:async(_url,opts)=>!opts?{items}:new Promise(r=>{resolver=r;})});
  await p.panel.abrir('2026-11-20');p.seleccionar();p.confirmar();const envio=p.form.disparar('submit');
  await p.form.disparar('submit');assert.equal(p.solicitudes.length,2);
  p.elementos.cancelar.disparar('click');assert.equal(p.dialogo.open,false);
  resolver({registradas:3});await envio;assert.equal(p.resultados.length,1);
});
