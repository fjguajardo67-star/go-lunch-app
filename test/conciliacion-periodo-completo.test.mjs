import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {construirDashboard} from '../services/dashboard.js';
import {prepararReporteEntregas,htmlReporteEntregas} from '../services/reporte-entregas.js';
import {crearExcelOperacion} from '../services/reporte-operacion-excel.js';
import {crearExcelFacturacion} from '../services/reporte-facturacion-excel.js';
const fecha='2026-11-18';
function datos(){
 const empleados=Array.from({length:90},(_,n)=>({telefono:'527531'+String(n).padStart(6,'0'),numero_empleado:String(n+1).padStart(5,'0'),nombre:'Persona ficticia '+(n+1),activo:true}));
 const conciliacion={entrega_conciliada_en:'2026-11-19T14:00:00Z',entrega_conciliada_por:'Administración QA',entrega_conciliacion_motivo:'Entrega confirmada dentro de diez minutos. Hora exacta no registrada.'};
 const pedidos=empleados.map((e,n)=>({id:n+1,tipo:'regular',fecha_menu:fecha,empleado_telefono:e.telefono,empleados:e,opcion_texto:'Platillo QA',zona:n%2?'zona_refris':'zona_vdc',turno:n<67?'turno_a':'turno_b',entregado_en:n<67?fecha+'T16:03:00Z':null,...(n>=67?conciliacion:{})}));
 const coberturas=empleados.slice(0,30).map((e,n)=>({id:n+1,tipo:'cobertura',fecha_menu:fecha,empleado_telefono:e.telefono,empleados:e,empleado_numero_snapshot:e.numero_empleado,empleado_nombre_snapshot:e.nombre,opcion_texto:'Cobertura QA',zona:n%2?'zona_refris':'zona_vdc',turno:'turno_b',folio:'CE-QA-18',entregado_en:null,...conciliacion}));
 return {fecha,empleados,pedidos,coberturas};
}
const abrir=async r=>{const w=new ExcelJS.Workbook();await w.xlsx.load(r.buffer);return w;};
test('120 entregas confirmadas coinciden en dashboard, PDF y ambos Excel, conservando 67 escaneos y 53 conciliaciones',async()=>{
 const d=datos(),comidas=[...d.pedidos,...d.coberturas],dashboard=construirDashboard(d),pdf=prepararReporteEntregas(fecha,comidas);
 assert.equal(dashboard.resumen.entregados,120);assert.equal(dashboard.resumen.pendientes,0);assert.equal(dashboard.resumen.regulares,90);assert.equal(dashboard.resumen.coberturas,30);
 assert.equal(pdf.entregado.total,120);assert.equal(pdf.pendientes,0);assert.equal(pdf.grupos.flatMap(g=>g.filas).length,120);
 assert.doesNotMatch(htmlReporteEntregas(pdf),/Sin confirmación|sin confirmación/);
 const op=await crearExcelOperacion(fecha,fecha,comidas),fact=await crearExcelFacturacion(fecha,fecha,100,comidas);
 assert.equal(op.entregadas,120);assert.equal(fact.entregadas,120);assert.equal(fact.conCargo,120);assert.equal(fact.subtotal,12000);
 const w=await abrir(op),f=await abrir(fact),e=w.getWorksheet('Entregas');
 const filas=Array.from({length:120},(_,n)=>e.getRow(n+10));
 assert.equal(filas.filter(r=>r.getCell(11).value==='Reportada como entregada por el administrador'&&r.getCell(10).value===null).length,53);
 assert.equal(filas.filter(r=>r.getCell(11).value==='Registrada'&&r.getCell(10).value instanceof Date).length,67);
 assert.equal(w.getWorksheet('Resumen').getCell('G10').result,120);assert.equal(w.getWorksheet('Resumen').getCell('H10').result,0);
 assert.equal(f.getWorksheet('Resumen_Facturacion').getCell('G10').result,120);assert.equal(f.getWorksheet('Resumen_Facturacion').getCell('H10').result,0);
 for(const libro of [w,f])for(const hoja of libro.worksheets)for(const row of hoja.getSheetValues())if(row)assert.doesNotMatch(row.join(' '),/Sin confirmación|sin confirmación/);
 comidas[0].no_surtido_en=fecha+'T18:00:00Z';
 assert.equal(prepararReporteEntregas(fecha,comidas).entregado.total,119);
 assert.equal((await crearExcelFacturacion(fecha,fecha,100,comidas)).conCargo,119);
});
