import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { ZONA, ZONAS } from './menu.js';
import { prepararReportePeriodo } from './reporte-periodo.js';

const AZUL = '07357F', TINTA = '14233E', CLARO = 'EEF3FA';
const logos = ['go-lunch', 'alefer', 'glovis'].map(nombre =>
  readFileSync(new URL(`../assets/reportes/${nombre}.png`, import.meta.url)));
const fechaExcel = fecha => new Date(`${fecha}T00:00:00.000Z`);
const turno = valor => valor === 'turno_a' ? 'Turno A' : valor === 'turno_b' ? 'Turno B' : 'Sin turno';
const horaExcel = valor => {
  const m = /^(\d{2}):(\d{2})$/.exec(valor || '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : valor || null;
};
const instanteLocal = iso => {
  const d = DateTime.fromISO(iso || '', { zone: ZONA }).setZone(ZONA);
  return d.isValid ? new Date(Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.second)) : null;
};
const columna = n => String.fromCharCode(64 + n);

function encabezado(wb, nombre, titulo, anchos, datos, imagenes) {
  const ws = wb.addWorksheet(nombre, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: '1:9', margins: { left: .3, right: .3, top: .35, bottom: .35, header: .15, footer: .15 } }
  });
  ws.columns = anchos.map(width => ({ width }));
  const ultima = columna(anchos.length);
  ws.getRow(1).height = 8;
  for (let r = 2; r <= 4; r++) ws.getRow(r).height = 25;
  ws.getRow(5).height = 8;
  ws.mergeCells(`A6:${ultima}6`); ws.getCell('A6').value = titulo;
  ws.getCell('A6').font = { name: 'Arial', size: 16, bold: true, color: { argb: TINTA } };
  ws.getRow(6).height = 29;
  ws.mergeCells(`A7:${ultima}7`);
  ws.getCell('A7').value = `Periodo: ${datos.periodo}. Generado: ${datos.generado}.`;
  ws.mergeCells(`A8:${ultima}8`); ws.getCell('A8').value = datos.seleccion;
  for (const r of [7, 8]) {
    ws.getCell(`A${r}`).font = { name: 'Arial', size: 11, color: { argb: TINTA } };
    ws.getRow(r).height = 22;
  }
  for (const [n, col, width, height] of [[0, 0, 148, 74], [1, 3, 180, 53], [2, 7, 178, 46]]) {
    ws.addImage(imagenes[n], { tl: { col, row: n ? 1.35 : 1 }, ext: { width, height }, editAs: 'absolute' });
  }
  ws.headerFooter.oddFooter = '&LGo Lunch · Alefer&C&P de &N&RHyundai Glovis';
  return ws;
}

function estiloFila(fila, anchos, cabecera = false) {
  let lineas = 1;
  fila.eachCell({ includeEmpty: true }, (celda, i) => {
    const numerica = typeof celda.value === 'number' || celda.type === ExcelJS.ValueType.Formula;
    celda.font = { name: 'Arial', size: 11, bold: cabecera, color: { argb: cabecera ? 'FFFFFF' : TINTA } };
    celda.alignment = { vertical: 'middle', horizontal: cabecera ? 'center' : numerica ? 'right' : 'left', wrapText: true };
    if (cabecera) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    else if (fila.number % 2 === 0) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
    const longitud = celda.value instanceof Date ? 10 : numerica ? String(celda.result ?? celda.value).split('.')[0].length : String(celda.text).length;
    lineas = Math.max(lineas, Math.ceil(longitud / Math.max(8, anchos[i - 1] - 2)));
  });
  fila.height = cabecera ? 43 : Math.max(30, lineas * 14 + 8);
}

function detalle(wb, nombre, titulo, columnas, anchos, filas, d, imagenes, horas = []) {
  const ws = encabezado(wb, nombre, titulo, anchos, d, imagenes);
  ws.getRow(9).values = columnas; estiloFila(ws.getRow(9), anchos, true);
  for (const valores of filas) {
    const r = ws.addRow(valores); estiloFila(r, anchos);
    r.getCell(1).numFmt = 'dd/mm/yyyy'; r.getCell(1).alignment.horizontal = 'center';
    r.getCell(2).numFmt = '@';
    for (const c of horas) { r.getCell(c).numFmt = 'hh:mm'; r.getCell(c).alignment.horizontal = 'center'; }
  }
  ws.autoFilter = { from: { row: 9, column: 1 }, to: { row: Math.max(9, ws.rowCount), column: columnas.length } };
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 9, topLeftCell: 'D10', showGridLines: false }];
  if (!filas.length) {
    ws.getCell('A10').value = 'Sin registros para esta selección.';
    ws.mergeCells(10, 1, 10, columnas.length); ws.getRow(10).height = 25;
  }
  ws.pageSetup.printArea = `A1:${columna(columnas.length)}${ws.rowCount}`;
  return ws;
}

// El mismo modelo de fechas, selección y estados que el PDF. Ningún dato de
// empleados se manda a servicios externos ni se agrega teléfono al archivo.
export async function crearExcelOperacion(ini, fin, comidas, opciones = {}) {
  const d = prepararReportePeriodo(ini, fin, comidas, opciones);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Go Lunch · Alefer'; wb.title = 'Relación de comidas entregadas';
  wb.created = (opciones.ahora || DateTime.now()).toJSDate();
  wb.calcProperties.fullCalcOnLoad = true;
  const imagenes = logos.map(buffer => wb.addImage({ buffer, extension: 'png' }));
  const anchos = [15, 20, 20, 20, 22, 22, 22, 22, 20];
  const resumen = encabezado(wb, 'Resumen', 'Resumen de comidas y entregas', anchos, d, imagenes);
  const entregas = d.dias.flatMap(dia => dia.grupos.filter(g => !g.incidencia).flatMap(g => g.filas.map(f => [
    fechaExcel(dia.fecha), f.numero, f.nombre, f.platillo, f.servicio, f.folio, turno(g.turno), g.zona_texto,
    horaExcel(f.horario), horaExcel(f.hora_registrada === 'Conciliada' ? '' : f.hora_registrada),
    f.hora_registrada === 'Conciliada' ? 'Conciliada' : 'Registrada',
    f.hora_registrada === 'Conciliada' ? 'Hora real no registrada' : f.fecha_registrada ? `Registro: ${f.fecha_registrada}` : null
  ])));
  const pendientes = d.resumen.sin_confirmacion.map(p => [fechaExcel(p.fecha), p.numero_empleado, p.nombre, p.platillo,
    p.tipo === 'cobertura' ? 'Cobertura' : 'Regular', p.folio || null, turno(p.turno), ZONAS[p.zona] || 'Sin zona', horaExcel(p.horario)]);
  const incidencias = d.resumen.incidencias.map(p => [fechaExcel(p.fecha), p.numero_empleado, p.nombre,
    p.tipo === 'cobertura' ? 'Cobertura' : 'Regular', p.folio, p.platillo, ZONAS[p.zona] || 'Sin zona', turno(p.turno), p.motivo,
    p.registrado_por, instanteLocal(p.registrado_en)]);
  const e = detalle(wb, 'Entregas', 'Relación de comidas entregadas',
    ['Fecha', 'N.º empleado', 'Nombre', 'Platillo', 'Servicio', 'Folio', 'Turno', 'Zona', 'Hora prevista', 'Hora de entrega', 'Confirmación', 'Observación'],
    [14, 17, 48, 33, 27, 34, 14, 20, 16, 16, 18, 31], entregas, d, imagenes, [9, 10]);
  const p = detalle(wb, 'Sin_Confirmacion', 'Pedidos sin confirmación de entrega',
    ['Fecha', 'N.º empleado', 'Nombre', 'Platillo', 'Servicio', 'Folio', 'Turno', 'Zona', 'Hora prevista'],
    [14, 17, 48, 33, 27, 34, 14, 20, 16], pendientes, d, imagenes, [9]);
  const i = detalle(wb, 'Incidencias_Sin_Cargo', 'Incidencias sin cargo al empleado',
    ['Fecha', 'N.º empleado', 'Nombre', 'Servicio', 'Folio', 'Platillo', 'Zona', 'Turno', 'Motivo', 'Autorizó', 'Fecha de autorización'],
    [14, 17, 48, 27, 34, 33, 20, 14, 50, 18, 27], incidencias, d, imagenes);
  for (let n = 10; n < 10 + incidencias.length; n++) i.getCell(`K${n}`).numFmt = 'dd/mm/yyyy hh:mm';

  resumen.getRow(9).values = ['Fecha', 'Regulares solicitadas', 'Coberturas solicitadas', 'Total solicitado',
    'Regulares entregadas', 'Coberturas entregadas', 'Total entregado', 'Sin confirmación', 'Sin cargo'];
  estiloFila(resumen.getRow(9), anchos, true);
  const criterio = (hoja, cantidad, columnaServicio, fecha, servicio) => cantidad ?
    `COUNTIFS('${hoja}'!$A$10:$A$${cantidad + 9},$A${fecha}${servicio ? `,'${hoja}'!$${columnaServicio}$10:$${columnaServicio}$${cantidad + 9},"${servicio}"` : ''})` : '0';
  for (const dia of d.dias) {
    const n = resumen.rowCount + 1;
    const fila = resumen.addRow([fechaExcel(dia.fecha), dia.registradas.regulares, dia.registradas.coberturas, dia.registradas.total,
      dia.entregado.regulares, dia.entregado.coberturas, dia.entregado.total, dia.pendientes, dia.no_surtidos]);
    const formulas = [
      `E${n}+${criterio(p.name, pendientes.length, 'E', n, 'Regular')}+${criterio(i.name, incidencias.length, 'D', n, 'Regular')}`,
      `F${n}+${criterio(p.name, pendientes.length, 'E', n, '<>Regular')}+${criterio(i.name, incidencias.length, 'D', n, '<>Regular')}`,
      `SUM(B${n}:C${n})`, criterio(e.name, entregas.length, 'E', n, 'Regular'), criterio(e.name, entregas.length, 'E', n, '<>Regular'),
      `SUM(E${n}:F${n})`, criterio(p.name, pendientes.length, 'E', n), criterio(i.name, incidencias.length, 'D', n)
    ];
    // Resultado cacheado para visores que no recalculan; Excel conserva fórmulas.
    formulas.forEach((formula, c) => { fila.getCell(c + 2).value = { formula, result: fila.getCell(c + 2).value }; });
    estiloFila(fila, anchos); fila.getCell(1).numFmt = 'dd/mm/yyyy';
    fila.getCell(1).alignment.horizontal = 'center';
  }
  const totalFila = resumen.rowCount + 1;
  const total = resumen.addRow(['Total', d.resumen.regulares, d.resumen.coberturas, d.resumen.total,
    d.dias.reduce((n, dia) => n + dia.entregado.regulares, 0), d.dias.reduce((n, dia) => n + dia.entregado.coberturas, 0),
    entregas.length, pendientes.length, incidencias.length]);
  for (let c = 2; c <= 9; c++) {
    const cell = total.getCell(c), result = cell.value;
    if (d.dias.length) cell.value = { formula: `SUM(${columna(c)}10:${columna(c)}${totalFila - 1})`, result };
    cell.numFmt = '#,##0';
  }
  estiloFila(total, anchos, true); total.height = 30;
  const puntualidad = resumen.getRow(totalFila + 3);
  puntualidad.values = ['Puntualidad de las entregas', 'A tiempo', 'Tardías', 'Sin puntualidad verificable'];
  estiloFila(puntualidad, anchos, true);
  resumen.getRow(totalFila + 4).values = [null, d.resumen.entrega.entregados, d.resumen.entrega.tardios, d.resumen.entrega.indeterminados];
  estiloFila(resumen.getRow(totalFila + 4), anchos);
  for (const [offset, texto] of [
    [7, 'Las entregas conciliadas se incluyen en Entregas. Su hora real no quedó registrada.'],
    [8, 'Una comida sin confirmación requiere conciliación; no acredita que el empleado no la haya recogido.']
  ]) {
    const n = totalFila + offset; resumen.mergeCells(`A${n}:I${n}`); resumen.getCell(`A${n}`).value = texto;
    resumen.getCell(`A${n}`).font = { name: 'Arial', size: 10, color: { argb: TINTA } }; resumen.getRow(n).height = 24;
  }
  resumen.pageSetup.printArea = `A1:I${resumen.rowCount}`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), total: d.resumen.total, entregadas: entregas.length };
}
