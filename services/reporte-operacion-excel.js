import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { ZONAS } from './menu.js';
import { logos, fechaExcel, turno, horaExcel, instanteLocal, columna, encabezado, estiloFila, detalle } from './formato-excel.js';
import { prepararReportePeriodo } from './reporte-periodo.js';
import { ENTREGA_ADMINISTRADOR } from './reporte-entregas.js';

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
    horaExcel(f.horario), horaExcel(f.hora_registrada === 'Admin' ? '' : f.hora_registrada),
    f.hora_registrada === 'Admin' ? ENTREGA_ADMINISTRADOR : 'Registrada',
    f.hora_registrada === 'Admin' ? 'Hora real no registrada · Sin puntualidad verificable' : f.fecha_registrada ? `Registro: ${f.fecha_registrada}` : null
  ])));
  const pendientes = d.resumen.sin_confirmacion.map(p => [fechaExcel(p.fecha), p.numero_empleado, p.nombre, p.platillo,
    p.tipo === 'cobertura' ? 'Cobertura' : 'Regular', p.folio || null, turno(p.turno), ZONAS[p.zona] || 'Sin zona', horaExcel(p.horario)]);
  const incidencias = d.resumen.incidencias.map(p => [fechaExcel(p.fecha), p.numero_empleado, p.nombre,
    p.tipo === 'cobertura' ? 'Cobertura' : 'Regular', p.folio, p.platillo, ZONAS[p.zona] || 'Sin zona', turno(p.turno), p.motivo,
    p.registrado_por, instanteLocal(p.registrado_en)]);
  const e = detalle(wb, 'Entregas', 'Relación de comidas entregadas',
    ['Fecha', 'N.º empleado', 'Nombre', 'Platillo', 'Servicio', 'Folio', 'Turno', 'Zona', 'Hora prevista', 'Hora de entrega', 'Confirmación', 'Observación'],
    [14, 17, 48, 33, 27, 34, 14, 20, 16, 16, 38, 31], entregas, d, imagenes, [9, 10]);
  const p = detalle(wb, 'Pendientes_Registro', 'Pedidos pendientes de registro',
    ['Fecha', 'N.º empleado', 'Nombre', 'Platillo', 'Servicio', 'Folio', 'Turno', 'Zona', 'Hora prevista'],
    [14, 17, 48, 33, 27, 34, 14, 20, 16], pendientes, d, imagenes, [9]);
  const i = detalle(wb, 'Incidencias_Sin_Cargo', 'Incidencias sin cargo al empleado',
    ['Fecha', 'N.º empleado', 'Nombre', 'Servicio', 'Folio', 'Platillo', 'Zona', 'Turno', 'Motivo', 'Autorizó', 'Fecha de autorización'],
    [14, 17, 48, 27, 34, 33, 20, 14, 50, 18, 27], incidencias, d, imagenes);
  for (let n = 10; n < 10 + incidencias.length; n++) i.getCell(`K${n}`).numFmt = 'dd/mm/yyyy hh:mm';

  resumen.getRow(9).values = ['Fecha', 'Regulares solicitadas', 'Coberturas solicitadas', 'Total solicitado',
    'Regulares entregadas', 'Coberturas entregadas', 'Total entregado', 'Pendientes de registro', 'Sin cargo'];
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
    [7, 'Las entregas reportadas por el administrador se incluyen en Entregas. Su hora real no quedó registrada.'],
    [8, 'Una comida pendiente de registro requiere conciliación; no acredita que el empleado no la haya recogido.']
  ]) {
    const n = totalFila + offset; resumen.mergeCells(`A${n}:I${n}`); resumen.getCell(`A${n}`).value = texto;
    resumen.getCell(`A${n}`).font = { name: 'Arial', size: 10, color: { argb: '14233E' } }; resumen.getRow(n).height = 24;
  }
  resumen.pageSetup.printArea = `A1:I${resumen.rowCount}`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), total: d.resumen.total, entregadas: entregas.length };
}
