import test from 'node:test';
import assert from 'node:assert/strict';
import { Settings } from 'luxon';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_KEY = 'test-only';
const { horarioCobertura, validarTurnoCobertura } = await import('../services/cobertura.js');
const { htmlComandaCobertura, htmlEtiquetasCobertura } = await import('../services/cocina-cobertura.js');

test('cada corte es exclusivo: 7:00 AM A y 2:00 PM B, hora de México', () => {
 const original = Settings.now;
 try {
  for (const [hora,a,b] of [['06:59:59',true,true],['07:00:00',false,true],['13:59:59',false,true],['14:00:00',false,false]]) {
   Settings.now = () => Date.parse(`2026-11-07T${hora}-06:00`);
   assert.equal(horarioCobertura('turno_a').abierto,a,hora+' A');
   assert.equal(horarioCobertura('turno_b').abierto,b,hora+' B');
  }
  assert.equal(horarioCobertura('turno_a').entrega_por_zona.zona_vdc,'10:00 AM');
  assert.equal(horarioCobertura('turno_b').entrega_por_zona.zona_vdc,'6:00 PM');
  assert.equal(horarioCobertura('turno_b').entrega_por_zona.zona_refris,'5:00 PM');
  Settings.now=()=>Date.parse('2026-11-08T00:30:00Z');
  assert.equal(horarioCobertura('turno_a').fecha,'2026-11-07');
 } finally { Settings.now=original; }
});
test('no especificar turno conserva B; valores desconocidos no se convierten en B',()=>{
 assert.equal(validarTurnoCobertura(),'turno_b');
 for(const turno of ['turno_c','',null, ['turno_a']])assert.throws(()=>validarTurnoCobertura(turno),e=>e.status===400);
});
test('impresos A identifican el servicio y entrega, conservando QR especial',()=>{
 const solicitud={zona:'zona_vdc',turno:'turno_a',folio:'A1',total_porciones:1};
 const comanda=htmlComandaCobertura({fecha:'2026-11-07',turno:'turno_a',total:1,solicitudes:1,resumen:[{zona:'zona_vdc',platillo:'Pollo',porciones:1}],detalle:[solicitud]});
 assert.match(comanda,/COBERTURA · TURNO A/);
 assert.match(comanda,/10:00 AM/);
 assert.doesNotMatch(comanda,/Salida máxima 4:30 PM|6:00 PM/);
 const etiqueta=htmlEtiquetasCobertura({fecha:'2026-11-07',modo:'rollo',items:[{solicitud,empleado_nombre_snapshot:'Ejemplo',codigo_entrega:'uuid-prueba',secuencia:1}]});
 assert.match(etiqueta,/ASLA · 10:00 AM/);
 assert.match(etiqueta,/EX\|uuid-prueba\|2026-11-07/);
});
