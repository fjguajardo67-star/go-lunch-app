import { ANCHO_ETIQUETA, ALTO_ETIQUETA, estiloEtiquetaReparto, scriptAjustarTextoEtiqueta } from './formato-etiquetas.js';
// services/cocina-cobertura.js — comanda y etiquetas del menú especial

import { validarTurnoCobertura } from './cobertura.js';
import { DateTime } from 'luxon';
import * as db from './supabase.js';
import { ZONA as ZONA_TZ, ZONAS, horaTexto } from './menu.js';

const esc = s => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function resumenCobertura(fecha, turno = 'turno_b') {
  const solicitudes = (await db.listSolicitudesCobertura(fecha, validarTurnoCobertura(turno))).filter(s => s.estado !== 'cancelada');
  const items = solicitudes.flatMap(s => s.items.map(item => ({ ...item, solicitud: s })));
  const grupos = new Map();
  for (const item of items) {
    const clave = item.solicitud.zona + '|' + item.opcion_texto;
    if (!grupos.has(clave)) grupos.set(clave, {
      zona: item.solicitud.zona, platillo: item.opcion_texto, porciones: 0
    });
    grupos.get(clave).porciones++;
  }
  return {
    fecha, turno,
    total: items.length,
    solicitudes: solicitudes.length,
    resumen: [...grupos.values()].sort((a, b) =>
      a.zona.localeCompare(b.zona) || b.porciones - a.porciones),
    detalle: solicitudes
  };
}

export function htmlComandaCobertura({ fecha, turno = 'turno_b', total, solicitudes, resumen, detalle }, { autoPrint = false, ancho } = {}) {
  const termica = Number(ancho) === 58;
  const generado = DateTime.now().setZone(ZONA_TZ).toFormat("dd/MM/yyyy HH:mm 'hrs'");
  const porZona = new Map();
  for (const r of resumen) {
    if (!porZona.has(r.zona)) porZona.set(r.zona, []);
    porZona.get(r.zona).push(r);
  }
  const secciones = [...porZona.entries()].map(([zona, items]) => `
    <section>
      <h2>${esc((ZONAS[zona] || zona).toUpperCase())} · ${esc(horaTexto(turno, zona, fecha))}</h2>
      ${items.map(i => `<div class="linea"><b>${esc(i.platillo)}</b><strong>${i.porciones}</strong></div>`).join('')}
      <div class="subtotal"><span>Subtotal zona</span><b>${items.reduce((s, i) => s + i.porciones, 0)}</b></div>
    </section>`).join('');
  const folios = detalle.map(s => `
    <div class="folio">
      <b>${esc(s.folio)}</b> · ${esc(ZONAS[s.zona] || s.zona)} · ${s.total_porciones} alimento(s)<br>
      <span>Solicita: ${esc(s.supervisor_nombre_snapshot)} · Recibe: ${esc(s.responsable_nombre_snapshot)} #${esc(s.responsable_numero_snapshot)}</span>
    </div>`).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comanda de cobertura ${esc(fecha)}</title><style>
*{box-sizing:border-box}body{font-family:'Courier New',monospace;color:#000;background:#fff;max-width:430px;margin:auto;padding:16px 12px}
h1{text-align:center;font-size:20px;letter-spacing:.04em}p{text-align:center;font-size:13px;margin:4px 0}hr{border:0;border-top:2px dashed #000;margin:12px 0}
h2{text-align:center;font-size:16px;border-block:2px solid #000;padding:7px 0;margin:14px 0 10px}.linea,.subtotal,.total{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.linea{font-size:16px;padding:7px 0;border-bottom:1px dotted #777}.linea strong{font-size:22px}.subtotal{font-size:14px;font-weight:700;margin-top:8px}
.total{font-size:19px;font-weight:900}.folio{font-size:12px;line-height:1.45;padding:7px 0;border-bottom:1px dotted #888}.folio span{font-size:11px}.no-print{text-align:center;margin-top:18px}.no-print button{padding:8px 20px;font:inherit}
@page{size:letter portrait;margin:14mm}
@media print{body{max-width:none;padding:0}.no-print{display:none}.linea,.subtotal,.total,.folio{break-inside:avoid;page-break-inside:avoid}h1,h2{break-after:avoid;page-break-after:avoid}}
${termica ? `body{width:58mm;max-width:58mm;margin:0;padding:2mm}h1{font-size:13px;letter-spacing:0}h2{font-size:11px;overflow-wrap:anywhere}.linea{font-size:11px}.linea strong{font-size:15px}.subtotal,.total{font-size:12px}.folio,.folio span,p{font-size:9px;overflow-wrap:anywhere}.folio{line-height:1.4}@media print{@page{size:58mm 200mm;margin:2mm 0}body{max-width:58mm;padding:2mm}}` : ''}
</style></head><body>
<h1>COBERTURA · ${turno === 'turno_a' ? 'TURNO A' : 'TURNO B Y HORAS EXTRAS'}</h1><p>CICSA · Glovis</p><p>${esc(horaTexto(turno, null, fecha))}${turno === 'turno_b' ? ' · Salida máxima 4:30 PM' : ''}</p><p>Fecha: <b>${esc(fecha)}</b></p><hr>
${secciones || '<p>Sin solicitudes confirmadas.</p>'}
<hr><div class="total"><span>TOTAL</span><span>${total}</span></div><p>${solicitudes} solicitud(es)</p>
${folios ? `<hr><h2>FOLIOS Y RECEPCIÓN</h2>${folios}` : ''}
<hr><p>Generada: ${esc(generado)}</p><div class="no-print"><button onclick="window.print()">Imprimir</button></div>
${autoPrint ? '<script>window.addEventListener("load",function(){window.setTimeout(function(){window.print()},250)})</script>' : ''}
</body></html>`;
}

export async function etiquetasCobertura(fecha, { ancho = ANCHO_ETIQUETA, alto = ALTO_ETIQUETA, modo = 'rollo', turno = 'turno_b' } = {}) {
  const solicitudes = (await db.listSolicitudesCobertura(fecha, validarTurnoCobertura(turno))).filter(s => s.estado !== 'cancelada');
  const items = solicitudes.flatMap(s => s.items.map((item, i) => ({
    ...item, solicitud: s, secuencia: i + 1
  })));
  return { fecha, ancho, alto, modo, items };
}

export function htmlEtiquetasCobertura({ fecha, ancho = ANCHO_ETIQUETA, alto = ALTO_ETIQUETA, modo, items }) {
  const enHoja = modo === 'hoja';
  // Calibración física de la Brother: conservar el papel y centrar el contenido al 85 %.
  const escala = Number(ancho) === ANCHO_ETIQUETA && Number(alto) === ALTO_ETIQUETA ? .85 : 1;
  const columnas = Math.max(1, Math.floor((215.9 - 28 + 4) / (Number(ancho) + 4)));
  const fechaCorta = DateTime.fromISO(fecha, { zone: ZONA_TZ }).toFormat('dd/MM/yyyy');
  const orden = [...items].sort((a, b) =>
    a.solicitud.zona.localeCompare(b.solicitud.zona) ||
    a.solicitud.folio.localeCompare(b.solicitud.folio) ||
    a.empleado_nombre_snapshot.localeCompare(b.empleado_nombre_snapshot));
  const cuerpo = orden.map(item => {
    const s = item.solicitud;
    const codigo = `EX|${item.codigo_entrega}|${fecha}`;
    return `<div class="marco-etiqueta"><article class="etiqueta">
      <div class="ruta">${esc((ZONAS[s.zona] || s.zona).split(' (')[0])} · ${esc(horaTexto(s.turno || 'turno_b', s.zona, fecha))}</div>
      <div class="texto">
        <div class="nombre">${esc(item.empleado_nombre_snapshot)}</div>
        <div class="numero">${esc(item.opcion_texto)}</div>
      </div><div class="qr" data-codigo="${esc(codigo)}"></div>
      <div class="identificacion"><span>Empleado #${esc(item.empleado_numero_snapshot || '—')}</span><span>${esc(fechaCorta)}</span><span class="recibe">Recibe: ${esc(s.responsable_nombre_snapshot)} #${esc(s.responsable_numero_snapshot)}</span></div>
    </article></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Etiquetas cobertura ${esc(fecha)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;background:#edf1f7;color:#071b42}.barra{position:sticky;top:0;z-index:2;background:#003087;color:#fff;padding:12px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}.barra button{margin-left:auto;padding:9px 18px;border:0;border-radius:7px;font-weight:800;color:#003087;background:#fff}.ayuda{padding:10px 18px;background:#fff;color:#56627b;font-size:.8rem}.hoja{padding:18px}.hoja.rollo{display:flex;flex-direction:column;gap:10px;align-items:flex-start}.hoja.prueba{display:flex;flex-wrap:wrap;gap:8px}.etiqueta{width:${ancho}mm;height:${alto}mm;background:#fff;border:1px solid #aebbd2;border-radius:2mm;padding:1.5mm 2mm;display:flex;gap:1.5mm;overflow:hidden}.texto{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}.qr{flex:none;align-self:center;width:${Math.min(alto - 5, 18)}mm;height:${Math.min(alto - 5, 18)}mm}.qr canvas,.qr img{width:100%!important;height:100%!important;display:block}.ruta{font-size:6pt;font-weight:900;letter-spacing:.035em;white-space:nowrap}.nombre{font-size:9pt;font-weight:900;line-height:1.05}.numero{font-size:7.2pt;font-weight:750;line-height:1.1}.recibe{font-size:5.8pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pie{display:flex;justify-content:space-between;border-top:.25mm solid #000;padding-top:.5mm;font-size:5.5pt}
@media print{.barra,.ayuda{display:none}body{background:#fff}.hoja{padding:0;gap:0}.etiqueta{border:0;border-radius:0}}
${estiloEtiquetaReparto(ancho, alto)}
.marco-etiqueta{width:${ancho}mm;height:${alto}mm;flex:none;break-inside:avoid;page-break-inside:avoid}
.marco-etiqueta>.etiqueta{transform:scale(${escala});transform-origin:center center}
${enHoja ? `@page{size:letter portrait;margin:14mm}@media print{.hoja.prueba{display:block;font-size:0}.hoja.prueba .marco-etiqueta{display:inline-block;vertical-align:top;margin:0 4mm 4mm 0}.hoja.prueba .marco-etiqueta:nth-child(${columnas}n){margin-right:0}.hoja.prueba .etiqueta{border:.2mm dashed #999}}` : `@page{size:${ancho}mm ${alto}mm;margin:0}@media print{.marco-etiqueta{break-after:page;page-break-after:always}.marco-etiqueta:last-child{break-after:auto;page-break-after:auto}}`}
</style></head><body><div class="barra"><b>Etiquetas · cobertura ${esc(fechaCorta)}</b><span>${orden.length} alimento(s)</span><button onclick="window.print()">Imprimir</button></div>
<div class="ayuda">Una etiqueta por recipiente. Escala 100 %, sin márgenes y desactivar <b>Encabezados y pies de página</b> en el navegador. Brother: papel de 62 mm, largo 90 mm, orientación horizontal.${escala === .85 ? ' La reducción de cobertura al <b>85 %</b> ya está incluida y centrada; mantén la escala del navegador en <b>100 %</b>.' : ''} El QR registra esta cobertura sin interferir con el pedido regular del empleado.</div><main class="hoja ${enHoja ? 'prueba' : 'rollo'}">${cuerpo || '<p>Sin solicitudes confirmadas.</p>'}</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>document.querySelectorAll('.qr[data-codigo]').forEach(c=>new QRCode(c,{text:c.dataset.codigo,width:320,height:320,correctLevel:QRCode.CorrectLevel.M}));</script>${scriptAjustarTextoEtiqueta}</body></html>`;
}
