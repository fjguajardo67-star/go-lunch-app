// Formato compartido de los reportes nativos; conserva logos y celdas legibles.
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { ZONA } from './menu.js';

const AZUL = '07357F', TINTA = '14233E', CLARO = 'EEF3FA';
export const logos = ['go-lunch', 'alefer', 'glovis'].map(nombre =>
  readFileSync(new URL(`../assets/reportes/${nombre}.png`, import.meta.url)));
export const fechaExcel = fecha => new Date(`${fecha}T00:00:00.000Z`);
export const turno = valor => valor === 'turno_a' ? 'Turno A' : valor === 'turno_b' ? 'Turno B' : 'Sin turno';
export const horaExcel = valor => {
  const m = /^(\d{1,2}):(\d{2})(?:\s+(AM|PM))?$/.exec(valor || '');
  if (!m || Number(m[2]) >= 60 || (m[3] ? Number(m[1]) < 1 || Number(m[1]) > 12 : Number(m[1]) > 23)) return valor || null;
  const hora = m[3] ? Number(m[1]) % 12 + (m[3] === 'PM' ? 12 : 0) : Number(m[1]);
  return (hora * 60 + Number(m[2])) / 1440;
};
export const instanteLocal = iso => {
  const d = DateTime.fromISO(iso || '', { zone: ZONA }).setZone(ZONA);
  return d.isValid ? new Date(Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.second)) : null;
};
export const columna = n => String.fromCharCode(64 + n);

export function encabezado(wb, nombre, titulo, anchos, datos, imagenes) {
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

export function estiloFila(fila, anchos, cabecera = false) {
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

export function detalle(wb, nombre, titulo, columnas, anchos, filas, d, imagenes, horas = []) {
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

