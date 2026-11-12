// Un solo documento: resumen del periodo seguido de las entregas de cada día.
import { DateTime } from 'luxon';
import { validarPeriodo } from './comidas.js';
import { ZONA } from './menu.js';
import { construirReporte } from './reportes.js';
import { normalizarSeleccionCocina, seleccionarPedidosCocina, textoSeleccionCocina } from './seleccion-cocina.js';
import { prepararReporteEntregas, htmlReporteEntregas, documentoReporte, encabezadoReporte, validarElaboro, pieReporte, esc } from './reporte-entregas.js';

import { validarEstimacion, htmlCaratulaEstimacion, estilosEstimacion } from './caratula-estimacion.js';

const fechaTexto = fecha => DateTime.fromISO(fecha).toFormat('dd/MM/yyyy');

export function prepararReportePeriodo(ini, fin, comidas, { elaboro = '', filtros = {}, estimacion = null, ahora = DateTime.now() } = {}) {
  if (!ini || !fin) throw Object.assign(new Error('Selecciona Desde y Hasta para el reporte.'), { status: 400 });
  validarPeriodo(ini, fin);
  elaboro = validarElaboro(elaboro);
  estimacion = validarEstimacion(estimacion, elaboro);
  filtros = normalizarSeleccionCocina(filtros);
  const elegidas = seleccionarPedidosCocina(comidas.filter(p => p.fecha_menu >= ini && p.fecha_menu <= fin), filtros);
  const resumen = construirReporte(ini, fin, elegidas, ahora);
  const dias = resumen.pedidos_por_dia.map(({ fecha }) => prepararReporteEntregas(fecha, elegidas, { elaboro, ahora }));
  return { ini, fin, elaboro, filtros, estimacion, seleccion: textoSeleccionCocina(filtros), resumen, dias,
    periodo: fechaTexto(ini) + ' al ' + fechaTexto(fin), generado: ahora.setZone(ZONA).toFormat('dd/MM/yyyy HH:mm') };
}

export function graficaOpiniones(rating) {
  const valores = [['Me gustó mucho', rating.si], ['Estuvo bien', rating.tal_vez], ['No me gustó', rating.no]];
  const total = valores.reduce((n, [, v]) => n + v, 0), maximo = Math.max(1, ...valores.map(([, v]) => v));
  const descripcion = valores.map(([t, v]) => `${t}: ${v}`).join('. ');
  return `<section class="opiniones-grafica"><h2>¿Qué te pareció ese platillo?<sup>*</sup></h2>
    ${total ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 140" role="img" aria-label="${esc(descripcion)}">
      <title>${esc(descripcion)}</title>${valores.map(([texto, n], i) => {
        const y = 8 + i * 44, ancho = 350 * n / maximo;
        return `<text x="0" y="${y + 21}" font-size="16" fill="#14233e">${texto}</text><rect x="190" y="${y}" width="${ancho}" height="30" fill="#07357f"/><text x="${200 + ancho}" y="${y + 21}" font-size="18" font-weight="bold" fill="#14233e">${n}</text>`;
      }).join('')}</svg>` : '<p>Aún no hay opiniones registradas para este periodo y selección.</p>'}
    <p class="nota-interpretacion"><strong>* Resultados de quienes respondieron la encuesta.</strong> No representan necesariamente la experiencia de la totalidad de los comensales. Las respuestas pueden reflejar sabor, temperatura, presentación y condiciones de entrega; deben interpretarse como una señal para mejorar el servicio, no como una evaluación definitiva del platillo.</p>
    <p>${total} opiniones · ${rating.sin_responder} sin responder. Encuesta de pedidos regulares sin incidencia; las coberturas no tienen encuesta.</p>
  </section>`;
}

// Paginación conservadora en mm: repite títulos y cabeceras sin cortar filas.
function paginasResumen(d) {
  const r = d.resumen, paginas = [{ partes: [], usado: 0 }];
  const tabla = (titulo, columnas, anchos, filas, nota = '') => {
    let inicio = 0;
    do {
      let pagina = paginas.at(-1), limite = paginas.length === 1 ? 105 : 150;
      const altoFila = fila => 4 + 4 * Math.max(...fila.map((celda, i) => Math.ceil(String(celda).length / Math.max(7, anchos[i] * .9))));
      if (pagina.usado + 22 + (filas[inicio] ? altoFila(filas[inicio]) : 8) > limite) {
        pagina = { partes: [], usado: 0 }; paginas.push(pagina); limite = 150;
      }
      const seleccion = [], continuacion = inicio > 0; let alto = 22;
      while (inicio < filas.length && (seleccion.length === 0 || pagina.usado + alto + altoFila(filas[inicio]) <= limite)) {
        const fila = filas[inicio++]; alto += altoFila(fila); seleccion.push(fila);
      }
      pagina.partes.push(`<section class="grupo"><h2>${esc(titulo)}${continuacion ? ' · Continuación' : ''}</h2><table><colgroup>${anchos.map(a => `<col style="width:${a}%">`).join('')}</colgroup><thead><tr>${columnas.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${seleccion.length ? seleccion.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columnas.length}">Sin registros para esta selección.</td></tr>`}</tbody></table>${nota ? `<p class="nota-resumen">${esc(nota)}</p>` : ''}</section>`);
      pagina.usado += alto;
    } while (inicio < filas.length);
  };
  tabla('Comidas por día', ['Fecha', 'Regulares', 'Coberturas', 'Solicitadas', 'Entregadas', 'Sin confirmación', 'Sin cargo'], [18, 13, 14, 13, 13, 16, 13],
    d.dias.map(dia => [dia.fecha_texto, dia.registradas.regulares, dia.registradas.coberturas, dia.registradas.total, dia.entregado.total, dia.pendientes, dia.no_surtidos]));
  tabla('Porciones solicitadas por platillo', ['Platillo', 'Regulares', 'Coberturas', 'Total'], [55, 15, 15, 15],
    r.porciones_por_platillo.map(p => [p.platillo, p.regulares, p.coberturas, p.total]));
  // La gráfica es una sola pieza y reserva su altura antes de añadirla.
  let pagina = paginas.at(-1), limite = paginas.length === 1 ? 105 : 150;
  if (pagina.usado + 80 > limite) { pagina = { partes: [], usado: 0 }; paginas.push(pagina); }
  pagina.partes.push(graficaOpiniones(r.rating)); pagina.usado += 80;
  tabla('Opiniones por platillo', ['Platillo', 'Me gustó', 'Estuvo bien', 'No me gustó', 'Opiniones', 'Aprobación'], [40, 11, 12, 12, 11, 14],
    r.rating_por_platillo.map(p => [p.platillo, p.si, p.tal_vez, p.no, p.respondidos,
      p.aprobacion === null ? 'Sin opiniones' : p.muestra_corta ? 'Muestra corta' : p.aprobacion + '%']),
    'Con menos de 5 opiniones no se publica porcentaje. Aprobación: Me gustó = 100, Estuvo bien = 50, No me gustó = 0.');
  tabla('Entregas del periodo', ['A tiempo', 'Tardías', 'Sin puntualidad verificable', 'Sin confirmación', 'No surtidas · Sin cargo'], [20, 20, 20, 20, 20],
    [[r.entrega.entregados, r.entrega.tardios, r.entrega.indeterminados, r.entrega.no_entregados, r.no_surtidos]]);
  return paginas;
}

export function htmlReportePeriodo(d) {
  const r = d.resumen, resumen = paginasResumen(d);
  const offset = d.estimacion ? 1 : 0;
  const totalPaginas = offset + resumen.length + d.dias.reduce((n, dia) => n + dia.paginas.length, 0);
  const entregadas = r.entrega.entregados + r.entrega.tardios + r.entrega.indeterminados;
  const metricas = [[r.regulares, 'Regulares solicitadas'], [r.coberturas, 'Coberturas solicitadas'], [r.total, 'Total solicitado'],
    [entregadas, 'Entregadas'], [r.entrega.no_entregados, 'Sin confirmación'], [r.no_surtidos, 'No surtidas · Sin cargo']];
  let paginas = resumen.map((p, i) => `<section class="hoja">
    ${encabezadoReporte('Reporte de servicio del periodo', d.periodo, d.generado)}
    <p class="nota-resumen">${esc(textoSeleccionCocina(d.filtros))}</p>
    ${i === 0 ? `<section class="resumen">${metricas.map(([n, t]) => `<div class="metrica"><strong>${n}</strong><span>${t}</span></div>`).join('')}</section><p class="nota-resumen">Solicitadas = entregadas + sin confirmación + no surtidas. Una comida sin confirmación requiere conciliación; no acredita una falta de recogida. Las incidencias sin cargo conservan su registro y se detallan por separado. ${d.estimacion ? 'La carátula presenta la cantidad de servicios capturada para revisión y aprobación.' : 'Este documento acompaña la estimación; no calcula importes.'}</p>` : ''}
    ${p.partes.join('')}
    ${pieReporte(d.elaboro, i + 1 + offset, totalPaginas)}
  </section>`).join('');
  if (d.estimacion) paginas = htmlCaratulaEstimacion(d, totalPaginas) + paginas;
  let paginaInicial = resumen.length + 1 + offset;
  for (const dia of d.dias) {
    paginas += htmlReporteEntregas(dia, { fragmento: true, paginaInicial, totalPaginas });
    paginaInicial += dia.paginas.length;
  }
  return documentoReporte({ titulo: `CICSA_Glovis_Periodo_${d.ini}_${d.fin}`, etiqueta: (d.estimacion ? 'Reporte y estimación · ' : 'Reporte del periodo · ') + d.periodo, paginas, estilos: d.estimacion ? estilosEstimacion : '', conEstimacion: !!d.estimacion });
}
