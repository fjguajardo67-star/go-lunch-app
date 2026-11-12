import { readFileSync } from 'node:fs';
import { esc, validarElaboro } from './reporte-entregas.js';

const logo = nombre => 'data:image/svg+xml;base64,' + readFileSync(new URL('../public/' + nombre, import.meta.url)).toString('base64');
const ALEFER = logo('alefer.svg'), GLOVIS = logo('glovis.svg');
const moneda = centavos => '$' + (centavos / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const invalido = mensaje => { throw Object.assign(new Error(mensaje), { status: 400 }); };

// Solo se aceptan metadatos del formulario; el conteo procede del reporte filtrado.
export function validarEstimacion(datos, elaboro = '') {
  if (datos == null) return null;
  if (typeof datos !== 'object' || Array.isArray(datos)) invalido('Revisa los datos de la estimación.');
  const numero = datos.numero;
  if (typeof numero !== 'string' || !numero.trim() || numero.length > 40 || /[\x00-\x1f\x7f]/.test(numero)) {
    invalido('Escribe un número de estimación de hasta 40 caracteres.');
  }
  if (!validarElaboro(elaboro)) invalido('Escribe quién elaboró la estimación.');
  return { numero: numero.trim() };
}

export function calcularEstimacion(datos, servicios) {
  if (!datos) return null;
  if (!Number.isSafeInteger(servicios) || servicios < 0 || !Number.isSafeInteger(servicios * 13688)) {
    invalido('No se pudo calcular la cantidad de servicios del periodo.');
  }
  const subtotal = servicios * 11800, iva = servicios * 1888;
  return { numero: datos.numero, servicios, subtotal, iva, total: subtotal + iva };
}

export function htmlCaratulaEstimacion(d, totalPaginas) {
  const e = d.estimacion;
  return `<section class="hoja"><div class="estimacion">
    <div class="est-marcas"><img src="${ALEFER}" alt="Alefer"><img src="${GLOVIS}" alt="Hyundai Glovis"></div>
    <h1>Estimación de servicios</h1><p class="est-subtitulo">Carátula para revisión y aprobación de facturación</p>
    <div class="est-datos"><div><b>Número de estimación</b><p>${esc(e.numero)}</p></div><div><b>Periodo de servicio</b><p>${esc(d.periodo)}</p></div></div>
    <div class="est-datos est-empresas"><div><b>Proveedor</b><p>Servicio de Comedor y Catering Alefer,<br>S.A. de C.V.</p></div><div><b>Empresa contratante</b><p>Hyundai Glovis México,<br>S. de R.L. de C.V.</p></div></div>
    <h2>Servicios del periodo</h2><p class="est-seleccion">${esc(d.seleccion)}</p>
    <table><colgroup><col style="width:46%"><col style="width:16%"><col style="width:18%"><col style="width:20%"></colgroup><thead><tr><th>Concepto</th><th>Servicios</th><th>P. unitario</th><th>Importe</th></tr></thead><tbody><tr><td>Servicios de alimentación</td><td>${e.servicios}</td><td>$118.00</td><td>${moneda(e.subtotal)}</td></tr></tbody></table>
    <p class="est-nota">Moneda: MXN · Precio unitario antes de IVA</p>
    <dl class="est-totales"><div><dt>Subtotal</dt><dd>${moneda(e.subtotal)}</dd></div><div><dt>IVA 16 %</dt><dd>${moneda(e.iva)}</dd></div><div class="est-total"><dt>Total con IVA</dt><dd>${moneda(e.total)}</dd></div></dl>
    <p class="est-nota">Soporte: reporte del mismo periodo con resumen y detalle de entregas y horarios.</p>
    <h2>Observaciones de revisión</h2><div class="est-renglon"></div><div class="est-renglon"></div>
    <div class="est-firmas">${[['Elaboró', 'Alefer', d.elaboro], ['Revisó', 'Empresa contratante', ''], ['Aprobó para facturación', 'Empresa contratante', '']].map(([titulo, rol, nombre]) => `<div><b>${titulo}</b><small>${rol}</small><div class="est-firma">${esc(nombre)}</div><small>Nombre y firma</small><p>Fecha: __________________</p></div>`).join('')}</div>
    <footer><span>Documento para revisión previa a la facturación.</span><span>Página 1 de ${totalPaginas}</span></footer>
  </div></section>`;
}

export const estilosEstimacion = `
.estimacion{color:#123451;font-size:10pt;line-height:1.35;overflow-wrap:anywhere}
.est-marcas{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #123451;padding-bottom:3mm;margin-bottom:4mm}.est-marcas img{width:52mm;height:13mm;object-fit:contain}.est-marcas img:last-child{width:46mm}
.estimacion h1{font-size:21pt;margin-bottom:2mm}.est-subtitulo{font-size:11pt;color:#536271;margin:0 0 3mm}
.est-datos{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-bottom:2mm}.est-datos b{font-size:9pt}.est-datos p{margin:1mm 0}.est-empresas b{color:#526b25}
.estimacion h2{font-size:12pt;font-weight:600;padding:0;margin:2mm 0 2mm}.est-seleccion,.est-nota{font-size:8.5pt;color:#536271;margin:2mm 0 4mm}
.estimacion th,.estimacion td{border:0;border-bottom:1px solid #b7c1c9;padding:3mm 2mm;font-size:9pt}.estimacion th{background:#f2f5f7}.estimacion td:not(:first-child){white-space:nowrap}
.est-totales{width:45%;margin:2mm 0 3mm auto}.est-totales div{display:flex;justify-content:space-between;gap:4mm;padding:1.5mm 0}.est-totales dd{margin:0;white-space:nowrap}.est-total{border-top:1px solid #123451;font-size:12pt;font-weight:bold}
.est-renglon{height:4mm;border-bottom:1px solid #b7c1c9}.est-firmas{display:grid;grid-template-columns:repeat(3,1fr);gap:7mm;margin-top:3mm}.est-firmas b{font-size:10pt}.est-firmas small{display:block;color:#536271;font-size:8pt;margin-top:2mm}.est-firma{min-height:12mm;padding-top:3mm;border-bottom:1px solid #b7c1c9;font-size:9pt}.est-firmas p{font-size:8pt;color:#536271;margin-top:5mm}.estimacion footer{border-top:1px solid #b7c1c9;padding-top:2mm;margin-top:3mm;color:#536271}
`;
