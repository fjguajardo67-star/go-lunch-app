import test from 'node:test';
import assert from 'node:assert/strict';
import { validarVigenciaMenu, errorPublicarMenu, guardarPeriodoMenu } from '../services/menu-cobertura.js';

const opciones={opcion_1:'Hamburguesa',opcion_2:'Boneless',opcion_3:'Pescado'};
const periodo={...opciones,fecha_inicio:'2026-11-07',fecha_final:'2026-11-13'};
test('vigencia inclusiva acepta un día, fin de año y año bisiesto sin desplazamiento UTC',()=>{
  assert.equal(validarVigenciaMenu(periodo).menu.fecha_final,'2026-11-13');
  for(const [inicio,fin] of [['2026-11-07','2026-11-07'],['2026-12-30','2027-01-02'],['2028-02-29','2028-03-01']]) {
    assert.ok(validarVigenciaMenu({...opciones,fecha_inicio:inicio,fecha_final:fin}).menu);
  }
});
test('rechaza fechas inexistentes, orden invertido, periodo sin fin o excesivo',()=>{
  for(const cambios of [{fecha_inicio:'2026-02-30'},{fecha_final:'2026-11-06'},{fecha_final:''},{fecha_inicio:'2026-01-01',fecha_final:'2027-01-02'},{fecha_inicio:123}]) {
    assert.ok(validarVigenciaMenu({...periodo,...cambios}).error,JSON.stringify(cambios));
  }
});
test('conserva la compatibilidad del menú de un día y valida opciones e identificador',()=>{
  assert.equal(validarVigenciaMenu({...opciones,fecha:'2026-11-07'}).menu.fecha_inicio,'2026-11-07');
  assert.ok(validarVigenciaMenu({...periodo,opcion_2:' hamburguesa '}).error);
  assert.ok(validarVigenciaMenu({...periodo,opcion_1:{texto:'A'}}).error);
  assert.ok(validarVigenciaMenu({...periodo,periodo_id:'otro'}).error);
});
test('guarda todo el periodo en una sola llamada transaccional, conservando el ID al editar',async()=>{
  const id='de277f5d-05c1-4c25-9db8-f444d88c1a1b';let llamadas=[];
  const client={rpc:async(nombre,parametros)=>{llamadas.push({nombre,parametros});return{data:{dias:7},error:null};}};
  const {menu}=validarVigenciaMenu({...periodo,periodo_id:id});
  assert.deepEqual(await guardarPeriodoMenu(client,menu),{dias:7});
  assert.equal(llamadas.length,1);
  assert.equal(llamadas[0].nombre,'publicar_menu_cobertura_periodo');
  assert.equal(llamadas[0].parametros.p_periodo_id,id);
  assert.equal(llamadas[0].parametros.p_hasta,'2026-11-13');
});
test('conflictos avisan que no se modificó ningún día y no se ocultan como éxito',async()=>{
  const error={message:'menu_con_solicitudes:2026-11-09'};
  await assert.rejects(guardarPeriodoMenu({rpc:async()=>({error})},periodo),e=>e===error);
  const respuesta=errorPublicarMenu(error);
  assert.equal(respuesta.status,409);assert.match(respuesta.error,/2026-11-09/);
  assert.equal(errorPublicarMenu({message:'vigencia_solapada'}).status,409);
  assert.equal(errorPublicarMenu({code:'PGRST202'}).status,503);
});
