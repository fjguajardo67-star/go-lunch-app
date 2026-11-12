// Reporte para el cliente: solo entregas registradas, una fila por comida.
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { validarPeriodo, contarServicios, horarioComida } from './comidas.js';
import { ZONA, ZONAS, TURNOS } from './menu.js';
import { noSurtida, entregada } from './incidencias.js';

const logo = archivo => 'data:image/svg+xml;base64,' + readFileSync(new URL('../public/' + archivo, import.meta.url)).toString('base64');
const LOGO_CICSA = logo('go-lunch.svg'), LOGO_GLOVIS = logo('glovis.svg'), LOGO_ALEFER = logo('alefer.svg');
export const esc = valor => String(valor ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const numeros = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export function validarElaboro(valor = '') {
  if (typeof valor !== 'string' || valor.length > 120 || /[\x00-\x1f\x7f]/.test(valor)) {
    throw Object.assign(new Error('Escribe un nombre de hasta 120 caracteres en «Elaboró».'), { status: 400 });
  }
  return valor.trim();
}

// Presupuesto en mm, conservador para carta y Safari. Cada continuación repite
// su encabezado. El resumen y el cierre tienen espacio propio fuera de la tabla.
function paginar(grupos) {
  const paginas = [{ partes: [], usado: 0 }];
  const nueva = () => { const p = { partes: [], usado: 0 }; paginas.push(p); return p; };
  const altoFila = fila => 3 + 3.8 * Math.max(1,
    Math.ceil(fila.numero.length / 9), Math.ceil(fila.nombre.length / 23),
    Math.ceil(fila.platillo.length / 22) + (fila.incidencia ? 3 + Math.ceil(fila.motivo.length / 22) : 0),
    Math.ceil(fila.servicio.length / 16) + (fila.folio ? Math.ceil(fila.folio.length / 17) : 0),
    fila.incidencia ? 6 : Math.ceil(fila.horario.length / 11));
  for (const grupo of grupos) {
    let inicio = 0, parte = 0;
    while (inicio < grupo.filas.length) {
      let pagina = paginas.at(-1), limite = paginas.length === 1 ? 110 : 140;
      if (pagina.usado + 22 + altoFila(grupo.filas[inicio]) > limite) { pagina = nueva(); limite = 140; }
      const filas = []; let alto = 22;
      while (inicio < grupo.filas.length && (filas.length === 0 || pagina.usado + alto + altoFila(grupo.filas[inicio]) <= limite)) {
        const fila = grupo.filas[inicio++]; alto += altoFila(fila); filas.push(fila);
      }
      pagina.partes.push({ grupo, filas, continuacion: parte++ > 0, ultima: inicio === grupo.filas.length });
      pagina.usado += alto;
    }
  }
  return paginas;
}

export function prepararReporteEntregas(fecha, comidas, { elaboro = '', ahora = DateTime.now() } = {}) {
  validarPeriodo(fecha);
  elaboro = validarElaboro(elaboro);
  const delDia = comidas.filter(p => p.fecha_menu === fecha);
  const entregadas = delDia.filter(entregada), noSurtidas = delDia.filter(noSurtida);
  const registradas = contarServicios(delDia), entregado = contarServicios(entregadas);
  const grupos = new Map();
  for (const p of [...entregadas, ...noSurtidas]) {
    const incidencia = noSurtida(p);
    const clave = JSON.stringify([incidencia, p.turno ?? null, p.zona ?? null]);
    if (!grupos.has(clave)) grupos.set(clave, {
      turno: p.turno, zona: p.zona, incidencia,
      turno_texto: TURNOS[p.turno] || 'Sin turno asignado', zona_texto: ZONAS[p.zona] || 'Sin zona asignada', filas: []
    });
    const hora = DateTime.fromISO(p.entregado_en, { zone: ZONA });
    const registrada = DateTime.fromISO(p.no_surtido_en || '', { zone: ZONA });
    grupos.get(clave).filas.push({
      numero: String(p.empleados?.numero_empleado || 'Sin número'), nombre: p.empleados?.nombre || 'Sin nombre',
      platillo: p.opcion_texto || p.opcion_id || 'Sin platillo registrado',
      tipo: p.tipo || 'regular', servicio: p.tipo === 'cobertura' ? (p.origen === 'extraordinaria' ? 'Cobertura extraordinaria' : 'Cobertura') : 'Regular',
      folio: p.folio || null, horario: horarioComida(p, fecha),
      incidencia, motivo:p.no_surtido_motivo || '', autor:p.no_surtido_por || '',
      incidencia_fecha: registrada.isValid ? registrada.toFormat('dd/MM/yyyy HH:mm') : '',
      hora_registrada: hora.isValid ? hora.setZone(ZONA).toFormat('HH:mm') : 'Sin hora válida',
      fecha_registrada: hora.isValid && hora.setZone(ZONA).toISODate() !== fecha ? hora.setZone(ZONA).toFormat('dd/MM/yyyy') : null
    });
  }
  const orden = (valor, opciones) => Object.keys(opciones).includes(valor) ? Object.keys(opciones).indexOf(valor) : Object.keys(opciones).length;
  const lista = [...grupos.values()].sort((a, b) => Number(a.incidencia) - Number(b.incidencia) || orden(a.turno, TURNOS) - orden(b.turno, TURNOS) ||
    String(a.zona ?? '').localeCompare(String(b.zona ?? '')));
  for (const grupo of lista) {
    grupo.filas.sort((a, b) => numeros.compare(a.numero, b.numero) || numeros.compare(a.nombre, b.nombre) || numeros.compare(a.servicio, b.servicio));
    Object.assign(grupo, contarServicios(grupo.filas));
  }
  return { fecha, fecha_texto: DateTime.fromISO(fecha).toFormat('dd/MM/yyyy'), elaboro,
    generado: ahora.setZone(ZONA).toFormat('dd/MM/yyyy HH:mm'),
    registradas, entregado, no_surtidos:noSurtidas.length,
    pendientes: delDia.length - entregadas.length - noSurtidas.length, grupos: lista, paginas: paginar(lista) };
}

export function htmlReporteEntregas(datos, { fragmento = false, paginaInicial = 1, totalPaginas = datos.paginas.length } = {}) {
  const resumen = `<section class="resumen" aria-label="Resumen de comidas solicitadas y entregadas">
    ${[[datos.registradas.regulares, 'Regulares solicitadas'], [datos.registradas.coberturas, 'Coberturas solicitadas'],
      [datos.registradas.total, 'Total solicitado'], [datos.entregado.total, 'Entregadas'], [datos.pendientes, 'Sin confirmación'], [datos.no_surtidos, 'No surtidas · Sin cargo']]
      .map(([n, texto]) => `<div class="metrica"><strong>${n}</strong><span>${texto}</span></div>`).join('')}
    </section><p class="nota-resumen">Regulares + coberturas = total solicitado. Entregadas + sin confirmación + no surtidas = total solicitado. Las incidencias sin cargo se detallan por separado y se excluyen del descuento al empleado.</p>`;
  const paginas = datos.paginas.map((pagina, indice) => `<section class="hoja">
    <header><div class="marcas"><img src="${LOGO_CICSA}" alt="CICSA Go Lunch"><img src="${LOGO_GLOVIS}" alt="Hyundai Glovis"></div>
      <h1>Reporte diario de comidas entregadas</h1><div class="fecha"><strong>Servicio: ${esc(datos.fecha_texto)}</strong><span>Generado: ${esc(datos.generado)}</span></div></header>
    ${indice === 0 ? resumen : ''}
    ${pagina.partes.map(({ grupo, filas, continuacion, ultima }) => `<section class="grupo">
      <h2>${grupo.incidencia ? 'Incidencias sin cargo · ' : ''}${esc(grupo.turno_texto)} · ${esc(grupo.zona_texto)}${continuacion ? ' · Continuación' : ''}</h2>
      <table><colgroup><col class="numero"><col class="nombre"><col class="platillo"><col class="servicio"><col class="hora"><col class="hora"></colgroup>
        <thead><tr><th scope="col">N.º empleado</th><th scope="col">Nombre</th><th scope="col">Platillo${grupo.incidencia ? ' / Motivo' : ''}</th><th scope="col">Servicio</th><th scope="col">Hora prevista</th><th scope="col">${grupo.incidencia ? 'Registró' : 'Entrega registrada'}</th></tr></thead>
        <tbody>${filas.map(f => `<tr><td>${esc(f.numero)}</td><td>${esc(f.nombre)}</td><td>${esc(f.platillo)}${f.incidencia ? `<small>No surtido por cocina/reparto · Sin cargo al empleado</small><small>${esc(f.motivo)}</small>` : ''}</td><td>${esc(f.servicio)}${f.folio ? `<small>${esc(f.folio)}</small>` : ''}</td><td>${esc(f.horario)}</td><td>${f.incidencia ? `${esc(f.autor)}<small>${esc(f.incidencia_fecha)}</small>${f.hora_registrada !== 'Sin hora válida' ? `<small>Marca previa rectificada: ${esc(f.hora_registrada)}</small>` : ''}` : `${esc(f.hora_registrada)}${f.fecha_registrada ? `<small>${esc(f.fecha_registrada)}</small>` : ''}`}</td></tr>`).join('')}</tbody>
      </table><p class="subtotal">${ultima ? `${grupo.incidencia ? 'Sin cargo en este grupo' : 'Subtotal del grupo'}: <b>${grupo.total}</b> · Regulares: ${grupo.regulares} · Coberturas: ${grupo.coberturas}` : `En esta hoja: <b>${filas.length}</b> · El grupo continúa en la siguiente hoja.`}</p>
    </section>`).join('')}
    ${datos.entregado.total === 0 ? '<p class="vacio">No hay entregas registradas para esta fecha.</p>' : ''}
    ${indice === datos.paginas.length - 1 ? `<div class="cierre"><strong>Total diario entregado: ${datos.entregado.total} ${datos.entregado.total === 1 ? 'comida' : 'comidas'}</strong><p>Regulares entregadas: ${datos.entregado.regulares} + Coberturas entregadas: ${datos.entregado.coberturas}</p></div>` : ''}
    ${pieReporte(datos.elaboro, paginaInicial + indice, totalPaginas)}
  </section>`).join('');
  if (fragmento) return paginas;
  return documentoReporte({ titulo: 'CICSA_Glovis_Entregas_' + datos.fecha, etiqueta: 'Reporte diario · ' + datos.fecha_texto, paginas });
}

export function encabezadoReporte(titulo, periodo, generado) {
  return `<header><div class="marcas"><img src="${LOGO_CICSA}" alt="CICSA Go Lunch"><img src="${LOGO_GLOVIS}" alt="Hyundai Glovis"></div><h1>${esc(titulo)}</h1><div class="fecha"><strong>${esc(periodo)}</strong><span>Generado: ${esc(generado)}</span></div></header>`;
}

// Razones sociales verificadas en la carátula del contrato de suministro Glovis–Alefer.
export function pieReporte(elaboro, pagina, total) {
  return `<footer class="pie-institucional">
    <p class="pie-elaboro">Elaboró: ${esc(elaboro || '____________________________')}</p>
    <div class="pie-empresas"><img src="${LOGO_ALEFER}" alt="Alefer">
      <div><b>Proveedor</b><span>Servicio de Comedor y Catering Alefer, S.A. de C.V.</span></div>
      <div><b>Empresa contratante</b><span>Hyundai Glovis México, S. de R.L. de C.V.</span></div>
    </div>
    <div class="pie-meta"><span>Hora local del comedor · America/Mexico_City</span><span>Página ${pagina} de ${total}</span></div>
  </footer>`;
}

export function documentoReporte({ titulo, etiqueta, paginas, estilos = '', conEstimacion = false }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${esc(titulo)}</title><style>
*{box-sizing:border-box}body{margin:0;color:#14233e;background:#edf0f5;font-family:Arial,sans-serif}
.barra{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 24px;background:#fff;border-bottom:1px solid #bcc5d3}
.barra button{font:inherit;font-weight:700;background:#07357f;color:white;border:0;border-radius:6px;padding:12px 18px;cursor:pointer;min-height:44px}.barra button:hover{background:#102957}.barra button:focus-visible{outline:3px solid #1272cf;outline-offset:3px}
.ayuda{margin:16px 24px;font-size:14px;line-height:1.5}.documento{max-width:216mm;margin:20px auto}.hoja{padding:14mm;background:white;margin-bottom:20px}
.marcas{display:flex;justify-content:space-between;align-items:center;margin-bottom:3mm}.marcas img{width:38mm;height:13mm;object-fit:contain}.marcas img:last-child{width:39mm}
h1{font-size:17pt;line-height:1.15;margin:0 0 3mm}.fecha{display:flex;justify-content:space-between;gap:4mm;font-size:9pt;line-height:1.3;margin-bottom:4mm}
.resumen{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2mm}.metrica{padding:3mm 1.5mm;border:1px solid #b7c0cf;text-align:center;break-inside:avoid}.metrica strong{display:block;font-size:21pt;line-height:1.1;font-variant-numeric:tabular-nums}.metrica span{display:block;font-size:8pt;line-height:1.2;margin-top:1.5mm}
.nota-resumen{font-size:8pt;line-height:1.3;margin:2mm 0 4mm}.grupo{margin-bottom:3mm}h2{font-size:10pt;line-height:1.2;margin:0;padding:2mm 0}
table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:8.5pt;line-height:1.2}.numero{width:10%}.nombre{width:27%}.platillo{width:25%}.servicio{width:18%}.hora{width:10%}
th,td{text-align:left;vertical-align:top;border:1px solid #aeb7c5;padding:1.4mm;overflow-wrap:anywhere}th{font-size:8pt}td small{display:block;font-size:7pt;line-height:1.2;margin-top:.5mm}.subtotal{font-size:8pt;margin:1.5mm 0 0;line-height:1.3}
.cierre{border-top:1px solid #14233e;margin-top:4mm;padding-top:2mm;font-size:10pt;break-inside:avoid}.cierre p{font-size:8.5pt;line-height:1.3;margin:1.5mm 0 0}footer{display:flex;justify-content:space-between;gap:4mm;font-size:7.5pt;margin-top:4mm;line-height:1.2}.vacio{font-size:11pt;margin:8mm 0}
.pie-institucional{display:block;margin-top:5mm;padding-top:4mm;font-size:8pt;line-height:1.3;break-inside:avoid}.pie-elaboro{margin:0 0 2mm;overflow-wrap:anywhere}.pie-empresas{display:grid;grid-template-columns:34mm 1fr 1fr;gap:5mm;align-items:center;border-top:1px solid #aeb7c5;padding-top:3mm}.pie-empresas img{width:34mm;height:12mm;object-fit:contain}.pie-empresas b,.pie-empresas span{display:block}.pie-empresas b{margin-bottom:1mm}.pie-meta{display:flex;justify-content:space-between;gap:4mm;font-size:7pt;margin-top:3mm}
.opiniones-grafica{break-inside:avoid;margin-bottom:3mm}.opiniones-grafica svg{display:block;width:100%;height:40mm}.opiniones-grafica p{font-size:8pt;line-height:1.3;margin:2mm 0}.opiniones-grafica .nota-interpretacion{font-size:7.5pt;line-height:1.4}.opiniones-grafica sup{font-size:7.5pt;margin-left:1mm}
@page{size:letter portrait;margin:14mm}
@media screen and (max-width:650px){.documento{overflow-x:auto;margin:12px}.hoja{min-width:188mm}.barra,.ayuda{margin-left:0;margin-right:0}.barra{padding:12px}.ayuda{padding:0 12px}}
@media print{body{color:#000;background:white}.barra,.ayuda{display:none}.documento{margin:0;max-width:none}.hoja{padding:0;margin:0;break-after:page;page-break-after:always}.hoja:last-child{break-after:auto;page-break-after:auto}th,td,.metrica,.cierre{border-color:#000}thead{display:table-header-group}tr,.subtotal,footer{break-inside:avoid;page-break-inside:avoid}h2{break-after:avoid;page-break-after:avoid}}
${estilos}
</style></head><body><div class="barra"><b>${esc(etiqueta)}</b><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<p class="ayuda">Papel carta, orientación vertical y escala 100 %. Desactiva los encabezados y pies del navegador. Para enviar por correo, elige Guardar como PDF. ${conEstimacion ? 'La carátula incluye espacios de revisión y aprobación para facturación.' : 'Este reporte no requiere firma.'} En celular, desliza la hoja horizontalmente para ver todas las columnas.</p>
<main class="documento">${paginas}</main></body></html>`;
}
