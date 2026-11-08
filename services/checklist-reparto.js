// Lista de salida en carta: una combinación de turno/zona por lote.
import { DateTime } from 'luxon';
import { ZONA, ZONAS, TURNOS, OPCIONES_VALIDAS, OPCION_LABELS, horaTexto } from './menu.js';
import { normalizarSeleccionCocina, seleccionarPedidosCocina, textoSeleccionCocina } from './seleccion-cocina.js';
import { contarServicios, horarioComida } from './comidas.js';

const UNIDADES_POR_HOJA = 15;
const porTexto = new Intl.Collator('es', { sensitivity: 'base' });
const porNumero = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const esc = valor => String(valor ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function compararFilas(a, b) {
  const indice = fila => {
    const opciones = [...OPCIONES_VALIDAS, 'especial_1', 'especial_2', 'especial_3'];
    const i = opciones.indexOf(fila.opcion_id);
    return i < 0 ? opciones.length : i;
  };
  return indice(a) - indice(b) || porTexto.compare(a.platillo, b.platillo) ||
    porTexto.compare(a.opcion_id, b.opcion_id) || porNumero.compare(a.numero, b.numero) ||
    porTexto.compare(a.nombre, b.nombre);
}

function paginarFilas(filas) {
  const hojas = [];
  let actual = [], unidades = 0, inicio = 0;
  for (const fila of filas) {
    // Reservar espacio para los textos largos y para el encabezado del platillo.
    const pesoFila = Math.max(fila.folio ? 2 : 1, Math.ceil(fila.nombre.length / 80), Math.ceil(fila.numero.length / 12));
    const pesoEncabezado = Math.max(1, Math.ceil((fila.opcion.length + fila.platillo.length) / 85));
    const cambiaOpcion = actual.at(-1)?.opcion_clave !== fila.opcion_clave;
    if (actual.length && unidades + pesoFila + (cambiaOpcion ? pesoEncabezado : 0) > UNIDADES_POR_HOJA) {
      hojas.push({ filas: actual, inicio });
      inicio += actual.length; actual = []; unidades = 0;
    }
    if (actual.at(-1)?.opcion_clave !== fila.opcion_clave) unidades += pesoEncabezado;
    unidades += pesoFila;
    actual.push(fila);
  }
  if (actual.length) hojas.push({ filas: actual, inicio });
  return hojas;
}

export function validarFechaChecklist(fecha) {
  const dia = typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? DateTime.fromISO(fecha, { zone: ZONA }) : null;
  if (!dia?.isValid || dia.toISODate() !== fecha) {
    const error = new Error('Fecha inválida — usa el formato YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  return dia;
}

export function prepararChecklistReparto(fecha, pedidos, seleccion = {}) {
  const dia = validarFechaChecklist(fecha);
  const filtros = normalizarSeleccionCocina(seleccion);
  const elegidos = seleccionarPedidosCocina(pedidos, filtros);
  const grupos = new Map();
  for (const pedido of elegidos) {
    const clave = JSON.stringify([pedido.turno ?? null, pedido.zona ?? null]);
    if (!grupos.has(clave)) grupos.set(clave, { turno: pedido.turno, zona: pedido.zona, filas: [] });
    grupos.get(clave).filas.push({
      numero: String(pedido.empleados?.numero_empleado ?? ''),
      nombre: String(pedido.empleados?.nombre || 'Sin nombre'),
      opcion_id: String(pedido.opcion_id ?? ''),
      opcion: pedido.tipo === 'cobertura' ? (/^especial_[123]$/.test(pedido.opcion_id) ? 'Cobertura ' + pedido.opcion_id.at(-1) : 'Cobertura') : Object.hasOwn(OPCION_LABELS, pedido.opcion_id) ? OPCION_LABELS[pedido.opcion_id] : (pedido.opcion_texto ? 'Otra opción' : 'Sin opción'),
      platillo: String(pedido.opcion_texto || 'Sin platillo registrado'),
      opcion_clave: JSON.stringify([pedido.tipo || 'regular', pedido.opcion_id ?? null, pedido.opcion_texto || 'Sin platillo registrado']),
      tipo: pedido.tipo || 'regular', folio: pedido.folio || null,
      horario: horarioComida(pedido, fecha)
    });
  }
  const lotes = [...grupos.values()].sort((a, b) =>
    String(a.turno ?? '').localeCompare(String(b.turno ?? '')) ||
    String(a.zona ?? '').localeCompare(String(b.zona ?? '')));
  const paginas = [];
  for (const lote of lotes) {
    lote.filas.sort(compararFilas);
    lote.por_opcion = {};
    for (const fila of lote.filas) lote.por_opcion[fila.opcion_clave] = (lote.por_opcion[fila.opcion_clave] || 0) + 1;
    lote.total = lote.filas.length;
    lote.coberturas = lote.filas.filter(f => f.tipo === 'cobertura').length;
    lote.regulares = lote.total - lote.coberturas;
    lote.turno_texto = TURNOS[lote.turno] || 'Sin turno asignado';
    lote.zona_texto = ZONAS[lote.zona] || 'Sin zona asignada';
    lote.horario = Object.hasOwn(TURNOS, lote.turno) && Object.hasOwn(ZONAS, lote.zona)
      ? horaTexto(lote.turno, lote.zona, fecha) : 'Por confirmar';
    const horarios = [...new Set(lote.filas.map(f => f.horario))];
    if (horarios.length === 1) lote.horario = horarios[0];
    else if (horarios.length > 1) lote.horario = 'Ver horario por comida';
    const hojas = paginarFilas(lote.filas);
    hojas.forEach((pagina, i) => paginas.push({ lote, ...pagina,
      hoja: i + 1, hojas: hojas.length, ultima: i === hojas.length - 1 }));
  }
  return { fecha, fecha_texto: dia.toFormat('dd/MM/yyyy'), filtros, ...contarServicios(elegidos), lotes, paginas };
}

export function htmlChecklistReparto(datos) {
  const generado = DateTime.now().setZone(ZONA).toFormat('dd/MM/yyyy HH:mm');
  const hojas = datos.paginas.map(pagina => {
    const { lote } = pagina;
    return `<section class="hoja-checklist">
      <header>
        <p class="marca">CICSA · GLOVIS</p><h1>Checklist de salida</h1>
        <div class="encabezado"><strong>${esc(lote.zona_texto)}</strong><strong>${esc(lote.turno_texto)}</strong></div>
        <div class="encabezado"><span>Servicio: <b>${esc(datos.fecha_texto)}</b></span><span>Entrega: <b>${esc(lote.horario)}</b></span></div>
        <p class="referencia">Hoja ${pagina.hoja} de ${pagina.hojas} de este lote · Regulares: ${lote.regulares} + Coberturas: ${lote.coberturas} = ${lote.total} comidas</p>
      </header>
      <table>
        <colgroup><col class="col-opcion"><col class="col-numero"><col><col class="col-horario"><col class="col-revision"></colgroup>
        <thead><tr><th scope="col">Opción del menú</th><th scope="col">N.º empleado</th><th scope="col">Nombre del empleado</th><th scope="col">Entrega</th><th scope="col">Revisado</th></tr></thead>
        <tbody>${pagina.filas.map((fila, i) => `${i === 0 || pagina.filas[i - 1].opcion_clave !== fila.opcion_clave
          ? `<tr class="opcion-grupo"><th colspan="5" scope="rowgroup">${esc(fila.opcion)} · ${esc(fila.platillo)} <span>— Total de esta opción: ${lote.por_opcion[fila.opcion_clave]}</span></th></tr>` : ''}<tr>
          <td>${esc(fila.opcion)}</td><td>${esc(fila.numero || 'Sin número')}</td><td class="nombre">${esc(fila.nombre)}${fila.folio ? `<small class="folio">${esc(fila.folio)}</small>` : ''}</td><td>${esc(fila.horario)}</td>
          <td class="revision"><span class="casilla"></span><small>${pagina.inicio + i + 1}</small></td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="cierre">
        <p class="conteo">Comidas en esta hoja: <b>${pagina.filas.length}</b> · Total del lote: <b>${lote.total}</b></p>
        ${pagina.ultima ? `<div class="firma-salida"><p>Hora real de salida: __________________</p>
          <div class="linea-firma"></div><p>Nombre y firma de salida</p></div>`
          : '<p class="continuacion">Continúa en la siguiente hoja. Firma única al final del lote.</p>'}
        <p class="generado">Generado: ${esc(generado)} · Hora local del comedor</p>
      </div>
    </section>`;
  }).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Checklist de salida ${esc(datos.fecha)} · ${esc(textoSeleccionCocina(datos.filtros))}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef1f6;color:#000;font-family:Arial,sans-serif}
.barra{padding:14px 20px;background:#fff;display:flex;flex-wrap:wrap;align-items:center;gap:12px;border-bottom:1px solid #ccd2dc}
.barra button{margin-left:auto;font:inherit;font-weight:700;padding:10px 22px;cursor:pointer}
.ayuda{margin:12px 20px;font-size:14px;line-height:1.5}.documento{max-width:216mm;margin:20px auto}
.hoja-checklist{background:#fff;min-height:247mm;padding:0;margin:0 0 20px;display:flex;flex-direction:column}
header{margin-bottom:4mm}.marca{font-size:10pt;letter-spacing:.04em;margin:0 0 2mm}h1{font-size:20pt;line-height:1.15;margin:0 0 4mm}
.encabezado{display:flex;justify-content:space-between;gap:6mm;font-size:11pt;margin:2mm 0}.referencia{font-size:9pt;margin:2mm 0 0}
table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:10pt;line-height:1.15}
.col-opcion{width:27mm}.col-revision{width:20mm}.col-numero{width:25mm}.col-horario{width:24mm}
th,td{border:1px solid #000;padding:1mm 2mm;text-align:left;vertical-align:middle;overflow-wrap:anywhere}
th{font-size:9pt;height:8mm}td{height:8mm}.nombre{font-weight:600}
.opcion-grupo{break-after:avoid;page-break-after:avoid}.opcion-grupo th{font-size:10pt;padding:2mm;height:auto}.opcion-grupo span{font-size:9pt;font-weight:400}
.folio{display:block;font-size:8pt;font-weight:400;overflow-wrap:anywhere}
.revision{text-align:center;white-space:nowrap}.casilla{display:inline-block;width:4mm;height:4mm;border:1px solid #000;vertical-align:middle}
.revision small{font-size:8pt;margin-left:2mm}.cierre{margin-top:auto;padding-top:4mm;font-size:10pt}
.conteo{margin:0 0 4mm}.firma-salida{break-inside:avoid}.firma-salida p{margin:0}.linea-firma{height:13mm;border-bottom:1px solid #000;width:90mm;margin-bottom:2mm}
.generado{font-size:8pt;margin:4mm 0 0}.continuacion{font-size:9pt;margin:0}
.vacio{padding:24px;background:#fff}thead{display:table-header-group}tr{break-inside:avoid}
@page{size:letter portrait;margin:14mm}
@media screen{.hoja-checklist{padding:12mm}}
@media print{body{background:#fff}.barra,.ayuda{display:none}.documento{margin:0;max-width:none}.hoja-checklist{margin:0;min-height:0;display:block;break-after:page;page-break-after:always}.hoja-checklist:last-child{break-after:auto;page-break-after:auto}header{margin-bottom:3mm}.marca{font-size:9pt;margin-bottom:1mm}h1{font-size:18pt;margin-bottom:2mm}.encabezado{font-size:10.5pt;margin:1mm 0}.referencia{font-size:8.5pt;margin-top:1mm}.cierre{margin-top:4mm;padding-top:0;break-inside:avoid;page-break-inside:avoid}.conteo{margin-bottom:3mm}.linea-firma{height:10mm}.generado{margin-top:3mm}tr{page-break-inside:avoid}}
</style></head><body>
<div class="barra"><b>Checklist de salida</b><span>${esc(datos.fecha_texto)} · ${esc(textoSeleccionCocina(datos.filtros))}</span><span>${datos.total} comida(s) · ${datos.lotes.length} lote(s)</span><button onclick="window.print()">Imprimir</button></div>
<p class="ayuda">Papel carta, orientación vertical y escala 100 %. Desactiva los encabezados y pies del navegador. Cada zona y turno tiene su propia lista; una sola firma al final de cada lote.</p>
<main class="documento">${hojas || '<p class="vacio">Sin pedidos para esta fecha y selección.</p>'}</main>
</body></html>`;
}
