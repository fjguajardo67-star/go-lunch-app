import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_KEY='solo-prueba';
const {htmlEtiquetas}=await import('../services/cocina.js');
const {htmlEtiquetasCobertura}=await import('../services/cocina-cobertura.js');
const fecha='2026-11-07';
const pedido={turno:'turno_a',zona:'zona_vdc',opcion_texto:'Pollo <especial>',empleados:{nombre:'Nombre <de prueba>',numero_empleado:'00123'}};

test('100 × 62 sigue disponible y la etiqueta larga mantiene el mismo QR y bloque impreso',()=>{
 const anterior=htmlEtiquetas({fecha,ancho:100,alto:62,pedidos:[pedido]});
 const larga=htmlEtiquetas({fecha,pedidos:[pedido]});
 assert.match(anterior,/size: 100mm 62mm/);
 assert.match(anterior,/padding-left: 10mm/);
 assert.match(larga,/padding-left: 110mm/);
 for(const html of [anterior,larga]) {
  assert.match(html,/width: 90mm/);
  assert.match(html,/data-codigo="00123\|2026-11-07"/);
 }
});

test('etiqueta regular horizontal conserva número y fecha sin pie externo',()=>{
 const html=htmlEtiquetas({fecha,pedidos:[pedido]});
 assert.match(html,/@page \{ size: 200mm 62mm; margin: 0; \}/);
 assert.match(html,/ASLA &nbsp;·&nbsp; 10:00/);
 assert.match(html,/font-size: 21pt/);
 assert.match(html,/width: 32mm; height: 32mm/);
 assert.match(html,/data-codigo="00123\|2026-11-07"/);
 assert.match(html,/Nombre &lt;de prueba&gt;/);
 assert.match(html,/Pollo &lt;especial&gt;/);
 assert.match(html,/<span>Empleado #00123<\/span>/);
 assert.match(html,/<span>07\/11\/2026<\/span>/);
 assert.match(html,/padding: 5mm 9mm 10mm/);
 assert.match(html,/left: 9mm; right: 9mm/);
 assert.doesNotMatch(html,/<div class="pie">|<span>#00123<\/span>/);
 assert.match(html,/desactivar Encabezados y pies de página/);
 assert.doesNotMatch(html,/transform:scale\(0\.85\)/);
 assert.match(html,/\.marco-etiqueta \{ padding-left: 110mm;/);
 assert.match(html,/\.marco-etiqueta\{width:200mm;height:62mm/);
 assert.match(html,/width: 90mm;/);
});
test('especial conserva QR, empleado, fecha y responsable',()=>{
 const html=htmlEtiquetasCobertura({fecha,items:[{empleado_nombre_snapshot:'Prueba',empleado_numero_snapshot:'00077',opcion_texto:'Ensalada',codigo_entrega:'uuid-especial',secuencia:1,solicitud:{turno:'turno_b',zona:'zona_refris',folio:'FOLIO-NO-IMPRIMIR',total_porciones:1,responsable_nombre_snapshot:'Responsable <prueba>',responsable_numero_snapshot:'001'}}]});
 assert.match(html,/@page\{size:200mm 62mm;margin:0\}/);
 assert.match(html,/REFIS · 5:00 PM/);
 assert.match(html,/Recibe: Responsable &lt;prueba&gt; #001/);
 assert.match(html,/EX\|uuid-especial\|2026-11-07/);
 assert.match(html,/<span>Empleado #00077<\/span>/);
 assert.match(html,/<span>07\/11\/2026<\/span>/);
 assert.match(html,/<div class="marco-etiqueta"><article class="etiqueta">/);
 assert.match(html,/transform:scale\(0\.85\);transform-origin:center center/);
 assert.match(html,/reducción de cobertura al <b>85 %<\/b>/);
 assert.doesNotMatch(html,/<div class="pie">|FOLIO-NO-IMPRIMIR/);
});
test('la calibración de cobertura mantiene el papel y respeta tamaños alternativos',()=>{
 const carta=htmlEtiquetasCobertura({fecha,modo:'hoja',items:[]});
 assert.match(carta,/@page\{size:letter portrait;margin:7mm\}/);
 assert.match(carta,/\.marco-etiqueta\{width:200mm;height:62mm/);
 assert.match(carta,/Sin solicitudes confirmadas/);
 const chico=htmlEtiquetasCobertura({fecha,ancho:62,alto:40,modo:'rollo',items:[]});
 assert.match(chico,/@page\{size:62mm 40mm;margin:0\}/);
 assert.match(chico,/transform:scale\(1\)/);
 assert.doesNotMatch(chico,/reducción de cobertura al/);
});

test('90 × 62 conserva el formato anterior, con QR y calibración iguales y sin pestaña',()=>{
 const regular=htmlEtiquetas({fecha,ancho:90,alto:62,pedidos:[pedido]});
 assert.match(regular,/@page \{ size: 90mm 62mm; margin: 0; \}/);
 assert.match(regular,/padding-left: 0mm/);
 assert.doesNotMatch(regular,/class="marco-etiqueta"/);
 assert.match(regular,/data-codigo="00123\|2026-11-07"/);
 const especial=htmlEtiquetasCobertura({fecha,ancho:90,alto:62,items:[]});
 assert.match(especial,/transform:scale\(0\.85\);transform-origin:center center/);
 assert.match(especial,/padding-left: 0mm/);
});
test('tamaños alternativos y prueba carta siguen disponibles; sin QR usa todo el ancho',()=>{
 const chico=htmlEtiquetas({fecha,ancho:62,alto:40,pedidos:[pedido]});
 assert.match(chico,/@page \{ size: 62mm 40mm; margin: 0; \}/);
 const carta=htmlEtiquetas({fecha,modo:'hoja',qr:false,pedidos:[pedido]});
 assert.match(carta,/@page \{ size: letter; margin: 7mm; \}/);
 assert.doesNotMatch(carta,/data-codigo=/);
 assert.match(carta,/:not\(:has\(.qr\)\) .texto \{ grid-column: 1 \/ -1/);
});
