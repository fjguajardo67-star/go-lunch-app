import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fechaMexico, mananaMexico, ventanaDiaria, htmlSinScripts, puedeEnviar, argumentosImpresora } from '../tools/impresion-windows/logica.mjs';

test('ventana de impresión y fecha de mañana usan México aunque UTC ya sea otro día',()=>{
  const antes=new Date('2026-11-07T03:29:59Z');
  const justo=new Date('2026-11-07T03:30:00Z');
  assert.equal(fechaMexico(justo),'2026-11-06');
  assert.equal(mananaMexico(justo),'2026-11-07');
  assert.equal(ventanaDiaria(antes),false);
  assert.equal(ventanaDiaria(justo),true);
  assert.equal(ventanaDiaria(new Date('2026-11-07T06:00:00Z')),false);
  assert.equal(mananaMexico(new Date('2027-01-01T04:00:00Z')),'2027-01-01');
});

test('un documento enviado o de envío dudoso no se repite y el otro puede seguir',()=>{
  assert.equal(puedeEnviar({},'comanda'),true);
  assert.equal(puedeEnviar({comanda:{estado:'enviando'}},'comanda'),false);
  assert.equal(puedeEnviar({comanda:{estado:'enviado_a_windows'}},'comanda'),false);
  assert.equal(puedeEnviar({comanda:{estado:'enviado_a_windows'}},'etiquetas'),true);
});

test('trabajos van a impresoras independientes, sin shell ni cambios a la predeterminada',()=>{
  assert.deepEqual(argumentosImpresora('Brother QL-800','C:\\Pedido del día.pdf'),['-print-to','Brother QL-800','-print-settings','noscale','-silent','C:\\Pedido del día.pdf']);
  assert.equal(argumentosImpresora('POS58 Printer','comanda.pdf')[1],'POS58 Printer');
  assert.throws(()=>argumentosImpresora('','archivo.pdf'));
});

test('el render local quita scripts remotos conservando los códigos originales del QR',()=>{
  assert.equal(htmlSinScripts('<div data-codigo="0123|2026-11-07"></div><script src="https://example.test/a.js"></script><script>evil()</script>'),'<div data-codigo="0123|2026-11-07"></div>');
});

test('comanda térmica ofrece 58 mm y conserva porciones, patios y escape de HTML',async()=>{
  process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_KEY='fake-test-key';
  const {htmlComanda}=await import('../services/cocina.js');
  const resumen={fecha:'2026-11-07',total:3,resumen:[{platillo:'Pollo <especial>',porciones:3,por_turno:{'Turno A — 10:00 am':3},por_zona:{}}]};
  const html=htmlComanda(resumen,{ancho:58});
  assert.match(html,/width: 58mm/);
  assert.match(html,/Pollo &lt;especial&gt;/);
  assert.match(html,/TOTAL PORCIONES/);
  assert.doesNotMatch(htmlComanda(resumen),/width: 58mm/);
});

test('instalación exige prueba física antes de crear la tarea y no almacena clave en texto',()=>{
  const s=readFileSync(new URL('../tools/impresion-windows/Instalar.ps1',import.meta.url),'utf8');
  assert.ok(s.indexOf("-cne 'ACTIVAR'")<s.indexOf('Register-ScheduledTask'));
  assert.match(s, /ConvertFrom-SecureString/);
  assert.match(s, /-LogonType Interactive/);
  assert.match(s, /-Daily -At '21:30'/);
  assert.match(s, /-MultipleInstances IgnoreNew/);
});
