import { normalizarSeleccionCocina, seleccionarPedidosCocina, textoSeleccionCocina, resumirPedidosCocina } from './seleccion-cocina.js';
import { prepararChecklistReparto, validarFechaChecklist } from './checklist-reparto.js';
import { contarServicios, horaComida } from './comidas.js';
import { comidasDelPeriodo } from './consultas-comidas.js';
import { ANCHO_ETIQUETA, ALTO_ETIQUETA, esFormatoReparto, extensionCierreEtiqueta, estiloEtiquetaReparto, scriptAjustarTextoEtiqueta } from './formato-etiquetas.js';
// services/cocina.js — Comanda de cocina: resumen por platillo y vista imprimible
import { DateTime } from 'luxon';
import { fechaServicio } from './pedidos.js';
import { manana, TURNOS, ZONAS, horaTexto } from './menu.js';

const ZONA_TZ = process.env.TZ || 'America/Mexico_City';

// ── Resumen agrupado por platillo para una fecha ────────────────
// Devuelve: { fecha, total, resumen: [{ platillo, porciones, por_turno, por_zona }] }
export async function resumenCocina(fecha, seleccion = {}) {
  const filtros = normalizarSeleccionCocina(seleccion);
  return resumirPedidosCocina(fecha, await comidasDelPeriodo(fecha), filtros);
}

export async function checklistReparto(fecha, seleccion = {}) {
  validarFechaChecklist(fecha);
  const filtros = normalizarSeleccionCocina(seleccion);
  return prepararChecklistReparto(fecha, await comidasDelPeriodo(fecha), filtros);
}

// ── HTML imprimible (impresora térmica o carta) ─────────────────
// Sin colores, fuente grande, una sección por turno (la cocina prepara
// cada turno por separado), con subtotal por turno y hora de generación.
export function htmlComanda({ fecha, total, resumen, grupos, regulares = total, coberturas = 0, filtros = {} }, { ancho } = {}) {
  filtros = normalizarSeleccionCocina(filtros);
  const turnosElegidos = filtros.turno ? [filtros.turno] : Object.keys(TURNOS);
  const horarios = turnosElegidos.map(turno =>
    `${turno === 'turno_a' ? 'Turno A' : 'Turno B'}: ${horaTexto(turno, filtros.zona, fecha)}`
  ).join(' · ');
  const termica = Number(ancho) === 58;
  const generado = DateTime.now().setZone(ZONA_TZ).toFormat("dd/MM/yyyy HH:mm 'hrs'");

  // Reagrupar: turno → [{ platillo, porciones, por_zona }]
  const turnos = new Map();
  for (const r of resumen) {
    for (const [turno, n] of Object.entries(r.por_turno)) {
      if (!turnos.has(turno)) turnos.set(turno, []);
      turnos.get(turno).push({ platillo: r.platillo, porciones: n, por_zona: r.por_zona });
    }
  }
  // Orden fijo: Turno A antes que Turno B, "Sin turno" al final
  const ordenTurnos = [...Object.values(TURNOS), 'Sin turno'];
  const listaTurnos = [...turnos.keys()]
    .sort((a, b) => ordenTurnos.indexOf(a) - ordenTurnos.indexOf(b));

  const seccionesAnteriores = listaTurnos.map(turno => {
    const items = turnos.get(turno).sort((a, b) => b.porciones - a.porciones);
    const subtotal = items.reduce((s, i) => s + i.porciones, 0);
    const filas = items.map(i => `
      <div class="platillo">
        <div class="linea">
          <span class="nombre">${esc(i.platillo)}</span>
          <span class="cantidad">${i.porciones}</span>
        </div>
      </div>`).join('');
    return `
      <div class="turno-titulo">═══ ${esc(turno.toUpperCase())} ═══</div>
      ${filas}
      <div class="subtotal"><span>Subtotal turno</span><span>${subtotal}</span></div>
      <hr>`;
  }).join('');
  const secciones = grupos ? grupos.map(g => `
    <div class="turno-titulo">${esc(TURNOS[g.turno] || 'Sin turno')} · ${esc(ZONAS[g.zona] || 'Sin zona')} · ${esc(g.horario)}</div>
    ${g.resumen.map(p => `<div class="platillo"><div class="linea"><span class="nombre">${esc(p.platillo)}</span><span class="cantidad">${p.porciones}</span></div><div class="desglose">Regulares: ${p.regulares} · Coberturas: ${p.coberturas}</div></div>`).join('')}
    <div class="subtotal"><span>Subtotal grupo</span><span>${g.total}</span></div><hr>`).join('') : seccionesAnteriores;

  const vacio = `<p class="vacio">Sin pedidos para esta fecha y selección.</p><hr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comanda ${esc(fecha)} · ${esc(textoSeleccionCocina(filtros))}</title>
<link rel="icon" type="image/png" href="/icono-32.png">
<link rel="apple-touch-icon" href="/icono-180.png">

<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    color: #000;
    background: #fff;
    max-width: 420px;
    margin: 0 auto;
    padding: 16px 12px;
  }
  h1 { font-size: 20px; text-align: center; letter-spacing: 1px; }
  .sub { text-align: center; font-size: 14px; margin-top: 4px; }
  hr { border: none; border-top: 2px dashed #000; margin: 12px 0; }
  .turno-titulo { font-size: 16px; font-weight: bold; text-align: center; margin: 4px 0 12px; }
  .platillo { margin-bottom: 12px; }
  .linea { display: flex; justify-content: space-between; align-items: baseline; }
  .nombre { font-size: 17px; font-weight: bold; padding-right: 8px; }
  .cantidad { font-size: 22px; font-weight: bold; white-space: nowrap; }
  .subtotal { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin-top: 8px; }
  .total { display: flex; justify-content: space-between; font-size: 19px; font-weight: bold; }
  .pie { font-size: 12px; text-align: center; margin-top: 12px; }
  .desglose { font-size: 11px; margin-top: 3px; }
  .vacio { font-size: 15px; text-align: center; margin: 16px 0; }
  .no-print { text-align: center; margin-top: 20px; }
  .no-print button {
    font-family: inherit; font-size: 15px; padding: 8px 24px; cursor: pointer;
  }
  @page { size: letter portrait; margin: 14mm; }
  @media print {
    .no-print { display: none; }
    body { max-width: none; padding: 0; }
    .platillo, .subtotal, .total, .pie { break-inside: avoid; page-break-inside: avoid; }
    .turno-titulo { break-after: avoid; page-break-after: avoid; }
  }
  ${termica ? `
  /* Rollo POS58. El paquete Windows calcula el largo real del ticket. */
  body { width: 58mm; max-width: 58mm; margin: 0; padding: 2mm; }
  h1 { font-size: 13px; letter-spacing: 0; }
  .sub, .subtotal { font-size: 10px; }
  .turno-titulo { font-size: 11px; margin-bottom: 6px; overflow-wrap: anywhere; }
  .nombre { font-size: 11px; overflow-wrap: anywhere; }
  .cantidad { font-size: 14px; }
  .total { font-size: 12px; }
  .pie { font-size: 8px; }
  hr { margin: 7px 0; border-top-width: 1px; }
  .platillo { margin-bottom: 7px; break-inside: avoid; }
  @media print { @page { size: 58mm 200mm; margin: 2mm 0; } body { padding: 2mm; } }
  ` : ''}
</style>
</head>
<body>
  <h1>COMANDA DE COCINA</h1>
  <div class="sub">CICSA — Glovis</div>
  <div class="sub">Fecha de servicio: <strong>${esc(fecha)}</strong></div>
  <div class="sub"><strong>${esc(textoSeleccionCocina(filtros))}</strong></div>
  <div class="sub">${esc(horarios)}</div>
  <hr>
  ${resumen.length ? secciones : vacio}
  <div class="total"><span>TOTAL PORCIONES</span><span>${total}</span></div>
  <div class="desglose">Regulares: ${regulares} + Coberturas: ${coberturas} = ${total}</div>
  <hr>
  <div class="pie">Generada: ${generado}</div>
  <div class="no-print"><button onclick="window.print()">🖨️ Imprimir</button></div>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ── Etiquetas por comida (una por pedido) ───────────────────────
// Se pegan en el contenedor. El tamaño es configurable porque depende del
// rollo que se compre; con modo 'hoja' se prueban en papel carta antes de
// invertir en la impresora.
export async function etiquetas(fecha, { ancho = ANCHO_ETIQUETA, alto = ALTO_ETIQUETA, modo = 'rollo', qr = true, turno, zona, servicio } = {}) {
  const filtros = normalizarSeleccionCocina({ turno, zona, servicio });
  const pedidos = seleccionarPedidosCocina(await comidasDelPeriodo(fecha), filtros);
  return { fecha, ancho, alto, modo, qr, pedidos, filtros };
}

export function htmlEtiquetas({ fecha, ancho = ANCHO_ETIQUETA, alto = ALTO_ETIQUETA, modo, qr = true, pedidos, filtros = {} }) {
  const generado = DateTime.now().setZone(ZONA_TZ).toFormat('dd/MM/yyyy HH:mm');
  const fechaCorta = DateTime.fromISO(fecha, { zone: ZONA_TZ }).toFormat('dd/MM/yyyy');
  const enHoja = modo === 'hoja';
  const conMarco = extensionCierreEtiqueta(ancho, alto) > 0 || pedidos.some(p => p.tipo === 'cobertura');
  const desglose = contarServicios(seleccionarPedidosCocina(pedidos, filtros));
  const columnas = Math.max(1, Math.floor((215.9 - 28 + 4) / (Number(ancho) + 4)));

  // Las etiquetas salen agrupadas por turno y zona: así se empacan y se
  // reparten en el mismo orden en que la cocina las va a necesitar.
  const orden = seleccionarPedidosCocina(pedidos, filtros).sort((a, b) =>
    String(a.turno).localeCompare(String(b.turno)) ||
    String(a.zona).localeCompare(String(b.zona)) ||
    String(a.empleados?.nombre || '').localeCompare(String(b.empleados?.nombre || '')));

  // Hora y patio explícitos, abreviados para conservar el ancho del rollo.
  const zonaCorta = z => (ZONAS[z] || z || 'Sin zona').split(' (')[0];

  // El QR lleva número de empleado y fecha: sin la fecha, la etiqueta de ayer
  // se podría escanear hoy y marcaría una entrega que no ocurrió.
  const cuerpo = orden.map(p => {
    const numero = p.empleados?.numero_empleado || '';
    const codigo = p.codigo_etiqueta || `${numero}|${fecha}`;
    const cobertura = p.tipo === 'cobertura';
    const calibrar = cobertura && esFormatoReparto(ancho, alto);
    return `
    ${conMarco ? `<div class="marco-etiqueta">` : ''}
    <div class="etiqueta"${calibrar ? ' style="transform:scale(0.85);transform-origin:center center"' : ''}>
      <div class="ruta">${esc(zonaCorta(p.zona))} &nbsp;·&nbsp; ${esc(horaComida(p, fecha))}</div>
      <div class="texto">
        <div class="nombre">${esc(p.empleados?.nombre || 'Sin nombre')}</div>
        <div class="platillo">${esc(p.opcion_texto || p.opcion_id)}</div>
      </div>
      ${qr ? `<div class="qr" data-codigo="${esc(codigo)}"></div>` : ''}
      <div class="identificacion"><span>Empleado #${esc(numero || '—')}</span><span>${esc(fechaCorta)}</span>${cobertura ? `<span class="recibe">Cobertura · Recibe: ${esc(p.responsable_nombre)} #${esc(p.responsable_numero)}</span>` : ''}</div>
    </div>${conMarco ? '</div>' : ''}`;
  }).join('');

  const vacio = '<p style="font-family:sans-serif;padding:20px">Sin pedidos para esta fecha y selección.</p>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Etiquetas ${esc(fecha)} · ${esc(textoSeleccionCocina(filtros))}</title>
<link rel="icon" type="image/png" href="/icono-32.png">
<link rel="apple-touch-icon" href="/icono-180.png">

<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #e9ecf1; font-family: 'Segoe UI', system-ui, sans-serif; color: #000; }

  .barra {
    background: #003087; color: #fff; padding: 12px 18px;
    display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    position: sticky; top: 0; z-index: 5;
  }
  .barra b { font-size: .95rem; }
  .barra .dato { font-size: .8rem; color: rgba(255,255,255,.75); }
  .barra button {
    margin-left: auto; padding: 9px 18px; background: #c9922a; color: #fff;
    border: none; border-radius: 7px; font-family: inherit; font-size: .88rem;
    font-weight: 700; cursor: pointer;
  }
  .ayuda {
    background: #fff; padding: 11px 18px; font-size: .8rem; color: #5a6480;
    border-bottom: 1px solid #dde3ef;
  }
  .ayuda b { color: #0d1b3e; }

  /* Cada etiqueta mide exactamente lo que mide el rollo */
  .hoja { padding: 18px; }
  .hoja.rollo { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .hoja.prueba { display: flex; flex-wrap: wrap; gap: 8px; }

  .etiqueta {
    width: ${ancho}mm;
    height: ${alto}mm;
    background: #fff;
    border: 1px solid #b9c2d4;      /* guía en pantalla; se quita al imprimir en rollo */
    border-radius: 2mm;              /* recordatorio de las esquinas redondeadas */
    padding: 1.6mm 2.2mm;
    display: flex; gap: 1.5mm; align-items: stretch;
    overflow: hidden;
  }
  .etiqueta .texto {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .etiqueta .qr {
    flex: none; align-self: center;
    width: ${Math.min(alto - 5, 18)}mm; height: ${Math.min(alto - 5, 18)}mm;
  }
  .etiqueta .qr canvas, .etiqueta .qr img { width: 100% !important; height: 100% !important; display: block; }
  .etiqueta .ruta {
    font-size: 6.5pt; font-weight: 700; letter-spacing: .04em;
    text-transform: uppercase; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .etiqueta .nombre {
    font-size: 10.5pt; font-weight: 800; line-height: 1.1;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .etiqueta .platillo {
    font-size: 8pt; line-height: 1.15; font-weight: 600;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .etiqueta .pie {
    display: flex; justify-content: space-between;
    font-size: 6pt; border-top: .3mm solid #000; padding-top: .8mm;
  }

  @media print {
    .barra, .ayuda { display: none; }
    body { background: #fff; }
    .hoja { padding: 0; gap: 0; }
    .etiqueta { border: none; border-radius: 0; }
  }

  ${estiloEtiquetaReparto(ancho, alto)}
  ${conMarco ? `.marco-etiqueta{width:${ancho}mm;height:${alto}mm;flex:none;break-inside:avoid;page-break-inside:avoid}` : ''}
  ${enHoja
    ? `/* Prueba en papel carta: se recortan para validar la medida */
       @page { size: letter; margin: 14mm; }
       @media print {
         .hoja.prueba { display: block; font-size: 0; }
         .hoja.prueba .etiqueta { display: ${esFormatoReparto(ancho, alto) ? 'inline-grid' : 'inline-flex'}; border: .2mm dashed #999; vertical-align: top; margin: 0 4mm 4mm 0; break-inside: avoid; page-break-inside: avoid; }
         .hoja.prueba .etiqueta:nth-child(${columnas}n) { margin-right: 0; }
       }`
    : `/* Rollo continuo: una etiqueta por página, del tamaño exacto */
       @page { size: ${ancho}mm ${alto}mm; margin: 0; }
       @media print { .etiqueta { page-break-after: always; } .etiqueta:last-child { page-break-after: auto; } }`}
  ${conMarco ? `@media print{.marco-etiqueta>.etiqueta{margin:0!important;page-break-after:auto;break-after:auto}.hoja.prueba .marco-etiqueta{display:inline-block;vertical-align:top;margin:0 4mm 4mm 0}.hoja.prueba .marco-etiqueta:nth-child(${columnas}n){margin-right:0}.hoja.rollo .marco-etiqueta{break-after:page;page-break-after:always}.hoja.rollo .marco-etiqueta:last-child{break-after:auto;page-break-after:auto}}` : ''}
</style>
</head>
<body>
  <div class="barra">
    <b>🏷️ Etiquetas · ${esc(fechaCorta)}</b>
    <span class="dato">${esc(textoSeleccionCocina(filtros))}</span>
    <span class="dato">${orden.length} comida(s)</span>
    <span class="dato">Regulares: ${desglose.regulares} · Coberturas: ${desglose.coberturas}</span>
    <span class="dato">${ancho} × ${alto} mm</span>
    <span class="dato">${enHoja ? 'prueba en papel carta' : 'rollo continuo'}</span>
    <button onclick="window.print()">Imprimir</button>
  </div>
  <div class="ayuda">
    ${enHoja
      ? 'Imprime esta hoja en papel normal y recórtala para comprobar que la medida cabe en el contenedor <b>antes</b> de comprar el rollo. Cambia el tamaño con <b>?ancho=</b> y <b>?alto=</b> en milímetros.'
      : 'Ajusta el tamaño con <b>?ancho=</b> y <b>?alto=</b> (mm) para que coincida con tu rollo. Para probar en papel carta primero, agrega <b>&amp;modo=hoja</b>.'}
    En el diálogo de impresión: <b>escala 100 %, sin márgenes y desactivar Encabezados y pies de página</b> para quitar fecha, título, URL y número de página. Para Brother: rollo de 62 mm, largo de 100 mm y orientación horizontal. El formato de 100 × 62 mm conserva el diseño de 90 mm y añade <b>10 mm en blanco solo a la izquierda</b> para cerrar el recipiente. Coloca el QR sobre una superficie plana, sin doblarlo. Las etiquetas van ordenadas por turno y zona.
  </div>
  <div class="hoja ${enHoja ? 'prueba' : 'rollo'}">
    ${orden.length ? cuerpo : vacio}
  </div>
${qr ? `  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    // Los píxeles de un canvas no viajan en el HTML: el QR se genera sobre
    // el elemento ya insertado en la página, nunca copiando su marcado.
    document.querySelectorAll('.qr[data-codigo]').forEach(function (caja) {
      new QRCode(caja, {
        text: caja.dataset.codigo,
        width: 320, height: 320,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    });
  </script>` : ''}
  ${scriptAjustarTextoEtiqueta}
  <script>window.__generado = ${JSON.stringify(generado)};</script>
</body>
</html>`;
}

// ── Cron interno: genera la comanda tras el corte de las 21:00 ──
// Activar con CRON_COCINA=on en Railway. Revisa cada minuto la hora local;
// al llegar a las 21:30 genera el resumen del día siguiente (fecha de
// servicio) y lo deja en los logs. Aquí mismo se puede enganchar después
// el envío por WhatsApp al chef o a un grupo.
let ultimaEjecucion = null;

export function iniciarCronCocina() {
  if (process.env.CRON_COCINA !== 'on') {
    console.log('[Cocina] Cron desactivado (define CRON_COCINA=on para activarlo)');
    return;
  }
  console.log('[Cocina] Cron activo: comanda automática a las 21:30', ZONA_TZ);
  setInterval(async () => {
    const ahora = DateTime.now().setZone(ZONA_TZ);
    const hoyISO = ahora.toISODate();
    if (ahora.hour === 21 && ahora.minute >= 30 && ultimaEjecucion !== hoyISO) {
      ultimaEjecucion = hoyISO;
      try {
        // El corte de las 21:00 solo cierra los pedidos del día SIGUIENTE.
        // Si mañana no hay servicio (fin de semana, festivo), la próxima
        // fecha con menú aún tiene su propio corte por delante: no es hoy
        // cuando se imprime su comanda.
        const fecha = await fechaServicio();
        if (fecha !== manana()) {
          console.log(`[Cocina] Mañana no hay servicio; la próxima fecha (${fecha ?? 'ninguna'}) cierra otro día. Sin comanda.`);
          return;
        }
        const r = await resumenCocina(fecha);
        console.log(`[Cocina] Comanda ${r.fecha} — ${r.total} porciones:`);
        for (const item of r.resumen) {
          console.log(`  · ${item.platillo}: ${item.porciones}`);
        }
        // TODO: aquí se puede enviar la comanda por WhatsApp al encargado
        // de cocina cuando el negocio esté verificado, p. ej.:
        // await wa.enviarTexto(process.env.TELEFONO_COCINA, textoComanda(r));
      } catch (err) {
        console.error('[Cocina] Error generando comanda automática:', err.message);
      }
    }
  }, 60 * 1000);
}
