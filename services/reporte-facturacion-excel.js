import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { ZONAS } from './menu.js';
import { horaComida } from './comidas.js';
import { entregada, sinHoraEntrega } from './incidencias.js';
import { seleccionarPedidosCocina } from './seleccion-cocina.js';
import { prepararReportePeriodo } from './reporte-periodo.js';
import { logos, fechaExcel, turno, horaExcel, instanteLocal, columna, encabezado, estiloFila, detalle } from './formato-excel.js';

export function validarCostoFacturacion(valor) {
  const costo = typeof valor === 'string' && valor.trim() ? Number(valor) : valor;
  if (typeof costo !== 'number' || !Number.isFinite(costo) || costo <= 0) {
    throw Object.assign(new Error('Ingresa un costo unitario válido mayor que cero.'), { status: 400 });
  }
  return costo;
}

// La falta de escaneo no elimina el cargo; una incidencia autorizada sí lo hace.
// Se consulta el mismo modelo de periodo y estados que operación y el PDF.
export async function crearExcelFacturacion(ini, fin, valorCosto, comidas, opciones = {}) {
  const costo = validarCostoFacturacion(valorCosto);
  const d = prepararReportePeriodo(ini, fin, comidas, opciones);
  const elegidas = seleccionarPedidosCocina(comidas.filter(p => p.fecha_menu >= ini && p.fecha_menu <= fin), d.filtros)
    .sort((a, b) => a.fecha_menu.localeCompare(b.fecha_menu) || String(a.empleados?.nombre || '').localeCompare(String(b.empleados?.nombre || ''), 'es'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Go Lunch · Alefer'; wb.title = 'Reporte de facturación de comidas';
  wb.created = (opciones.ahora || DateTime.now()).toJSDate();
  wb.calcProperties.fullCalcOnLoad = true;
  const imagenes = logos.map(buffer => wb.addImage({ buffer, extension: 'png' }));
  const anchos = [15, 21, 21, 22, 20, 22, 18, 21, 22];
  const resumen = encabezado(wb, 'Resumen_Facturacion', 'Reporte de facturación de comidas', anchos, d, imagenes);
  const filas = elegidas.map(p => [
    fechaExcel(p.fecha_menu), String(p.empleados?.numero_empleado ?? ''), p.empleados?.nombre || null,
    p.opcion_texto || p.opcion_id || null, p.tipo === 'cobertura' ? 'Cobertura' : 'Regular', p.folio || null,
    turno(p.turno), ZONAS[p.zona] || 'Sin zona', horaExcel(horaComida(p)),
    p.no_surtido_en ? 'No surtido · Sin cargo' : sinHoraEntrega(p) ? 'Entregado · Conciliado sin hora real' : entregada(p) ? 'Entregado' : 'Pendiente de registro',
    instanteLocal(p.entregado_en), instanteLocal(p.entrega_conciliada_en), p.entrega_conciliada_por || null,
    p.entrega_conciliacion_motivo || null, p.no_surtido_en ? 0 : 1,
    p.no_surtido_motivo || null, p.no_surtido_por || null, instanteLocal(p.no_surtido_en)
  ]);
  const auditoria = detalle(wb, 'Auditoria_Detalle', 'Detalle de comidas para facturación',
    ['Fecha', 'N.º empleado', 'Nombre', 'Platillo', 'Servicio', 'Folio', 'Turno', 'Zona', 'Hora prevista', 'Estado',
      'Entrega original', 'Confirmación administrativa', 'Conciliado por', 'Motivo de conciliación', 'Servicios con cargo',
      'Motivo sin cargo', 'Autorizó sin cargo', 'Autorización sin cargo'],
    [14, 17, 48, 33, 27, 34, 14, 20, 16, 38, 25, 25, 27, 60, 19, 60, 24, 25], filas, d, imagenes, [9]);
  for (let n = 10; n < 10 + filas.length; n++) {
    for (const c of ['K', 'L', 'R']) auditoria.getCell(`${c}${n}`).numFmt = 'dd/mm/yyyy hh:mm';
  }
  resumen.getRow(9).values = ['Fecha', 'Regulares con cargo', 'Coberturas con cargo', 'Servicios con cargo',
    'Costo unitario (MXN)', 'Subtotal (MXN)', 'Entregadas con cargo', 'Pendientes de registro con cargo', 'No surtidas sin cargo'];
  estiloFila(resumen.getRow(9), anchos, true);
  const contar = (n, criterios) => filas.length ?
    `COUNTIFS('Auditoria_Detalle'!$A$10:$A$${filas.length + 9},$A${n}${criterios.map(([c, v]) => `,'Auditoria_Detalle'!$${c}$10:$${c}$${filas.length + 9},${typeof v === 'number' ? v : '"' + v + '"'}`).join('')})` : '0';
  const totales = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const dia of d.dias) {
    const n = resumen.rowCount + 1;
    const noReg = d.resumen.incidencias.filter(p => p.fecha === dia.fecha && p.tipo !== 'cobertura').length;
    const regulares = dia.registradas.regulares - noReg;
    const coberturas = dia.registradas.coberturas - (dia.no_surtidos - noReg);
    const cantidad = regulares + coberturas;
    const valores = [fechaExcel(dia.fecha), regulares, coberturas, cantidad, costo, cantidad * costo,
      dia.entregado.total, dia.pendientes, dia.no_surtidos];
    const fila = resumen.addRow(valores);
    const formulas = { 2: contar(n, [['O', 1], ['E', 'Regular']]), 3: contar(n, [['O', 1], ['E', 'Cobertura']]),
      4: `SUM(B${n}:C${n})`, 6: `D${n}*E${n}`, 7: contar(n, [['O', 1], ['J', 'Entregado*']]),
      8: `D${n}-G${n}`, 9: contar(n, [['O', 0]]) };
    for (const [c, formula] of Object.entries(formulas)) {
      fila.getCell(Number(c)).value = { formula, result: valores[Number(c) - 1] };
    }
    estiloFila(fila, anchos); fila.getCell(1).numFmt = 'dd/mm/yyyy';
    fila.getCell(1).alignment.horizontal = 'center';
    for (const c of [5, 6]) fila.getCell(c).numFmt = '"$"#,##0.00';
    for (const c of [2, 3, 4, 6, 7, 8, 9]) totales[c - 1] += valores[c - 1];
  }
  const n = resumen.rowCount + 1;
  const total = resumen.addRow(['Total', ...totales.slice(1)]); total.getCell(5).value = null;
  for (const c of [2, 3, 4, 6, 7, 8, 9]) {
    total.getCell(c).value = d.dias.length ? { formula: `SUM(${columna(c)}10:${columna(c)}${n - 1})`, result: totales[c - 1] } : 0;
    total.getCell(c).numFmt = c === 6 ? '"$"#,##0.00' : '#,##0';
  }
  estiloFila(total, anchos, true); total.height = 30;
  for (const [offset, texto] of [
    [2, 'Servicios con cargo = regulares + coberturas, excluyendo incidencias autorizadas sin cargo. Subtotal = servicios con cargo × costo unitario; no incluye IVA.'],
    [4, 'La falta de escaneo no elimina el cargo. Las entregas conciliadas cuentan como entregadas y conservan vacía la hora real cuando no se registró.'],
    [6, 'Datos actuales al generar la descarga. El detalle conserva las incidencias y su autorización para conciliar el periodo.']
  ]) {
    const r = n + offset; resumen.mergeCells(`A${r}:I${r}`); resumen.getCell(`A${r}`).value = texto;
    resumen.getCell(`A${r}`).font = { name: 'Arial', size: 11, color: { argb: '14233E' } };
    resumen.getCell(`A${r}`).alignment = { wrapText: true, vertical: 'middle' }; resumen.getRow(r).height = 30;
  }
  resumen.views = [{ state: 'frozen', ySplit: 9, topLeftCell: 'A10', showGridLines: false }];
  resumen.pageSetup.printArea = `A1:I${resumen.rowCount}`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), total: d.resumen.total,
    conCargo: totales[3], entregadas: totales[6], sinCargo: totales[8], subtotal: totales[5] };
}
