import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { construirDashboard } from '../services/dashboard.js';
import { construirReporte } from '../services/reportes.js';
import { prepararReporteEntregas, htmlReporteEntregas } from '../services/reporte-entregas.js';
import { prepararReportePeriodo } from '../services/reporte-periodo.js';
import { entregada, sinHoraEntrega } from '../services/incidencias.js';
import '../public/operacion.js';
import '../public/reparto-guiado.js';
import '../public/reparto-grupos.js';
import ExcelJS from 'exceljs';
import { crearExcelFacturacion } from '../services/reporte-facturacion-excel.js';

const fecha='2026-11-16';
const conciliacion={entrega_conciliada_en:'2026-11-17T05:30:00Z',entrega_conciliada_por:'Administración QA',
  entrega_conciliacion_motivo:'Entrega verificada después de una falla de registro. Hora real desconocida.'};
function datos() {
  const empleados=Array.from({length:48},(_,i)=>({telefono:'527531'+String(i).padStart(6,'0'),numero_empleado:String(i+1).padStart(5,'0'),nombre:'Persona ficticia '+(i+1)}));
  const pedidos=empleados.map((e,i)=>({id:i+1,tipo:'regular',fecha_menu:fecha,empleado_telefono:e.telefono,empleados:e,
    zona:i<18 || i===46?'zona_refris':'zona_vdc',turno:i<46?'turno_a':'turno_b',opcion_texto:'Platillo regular QA',
    entregado_en:i<2?fecha+'T10:00:00-06:00':null,...(i<2?{}:conciliacion)}));
  const coberturas=empleados.slice(18,29).map((e,i)=>({id:i+1,tipo:'cobertura',fecha_menu:fecha,empleado_telefono:e.telefono,empleados:e,
    empleado_numero_snapshot:e.numero_empleado,empleado_nombre_snapshot:e.nombre,folio:'CE-QA-11',
    zona:'zona_vdc',turno:'turno_b',opcion_texto:'Platillo cobertura QA',entrega_programada_en:fecha+'T18:00:00-06:00',
    entregado_en:null,...conciliacion}));
  return {fecha,empleados,pedidos,coberturas,comidas:[...pedidos,...coberturas]};
}

test('59 entregas: dashboard, PDF diario, periodo y estimación incluyen las 57 conciliadas sin alterar las dos marcas reales',()=>{
  const d=datos(), originales=structuredClone(d.pedidos.slice(0,2));
  const dashboard=construirDashboard(d), diario=prepararReporteEntregas(fecha,d.comidas);
  const reporte=construirReporte(fecha,fecha,d.comidas,DateTime.fromISO(fecha+'T23:30:00-06:00'));
  const periodo=prepararReportePeriodo(fecha,fecha,d.comidas);
  assert.equal(dashboard.resumen.entregados,59);assert.equal(dashboard.resumen.pendientes,0);
  assert.equal(dashboard.resumen.tardias,0);assert.equal(dashboard.resumen.regulares,48);assert.equal(dashboard.resumen.coberturas,11);
  assert.deepEqual(diario.entregado,{regulares:48,coberturas:11,total:59});assert.equal(diario.pendientes,0);
  assert.equal(diario.grupos.flatMap(g=>g.filas).filter(f=>f.hora_registrada==='Conciliada').length,57);
  assert.match(htmlReporteEntregas(diario),/sin hora real registrada ni puntualidad verificable/);
  assert.equal(reporte.entrega.entregados,2);assert.equal(reporte.entrega.indeterminados,57);
  assert.equal(reporte.entrega.tardios,0);assert.equal(reporte.entrega.no_entregados,0);assert.equal(reporte.sin_confirmacion.length,0);
  assert.equal(reporte.ruta.por_dia.reduce((n,r)=>n+r.entregas,0),2,'la conciliación no fabrica tiempos de ruta');
  assert.equal(periodo.dias[0].entregado.total,59);assert.equal(periodo.resumen.total,59);
  assert.deepEqual(d.pedidos.slice(0,2),originales);
  assert.ok(d.comidas.filter(sinHoraEntrega).every(p=>p.entregado_en===null));
});

test('la evidencia administrativa se ve en dashboard sin presentar su fecha como hora física',()=>{
  const contexto=vm.createContext({document:{activeElement:null},HTMLElement:class {}});
  vm.runInContext(readFileSync(new URL('../public/dashboard-panel.js',import.meta.url),'utf8'),contexto);
  const raiz={innerHTML:'',contains:()=>false,querySelector:()=>null,addEventListener:()=>{}};
  const panel=contexto.GoLunchDashboard.montar({raiz,hora:()=> '10:00',registro:x=>x,horario:()=> 'Turno A',zona:x=>x,motivo:x=>x,puedeIncidencia:()=>false});
  panel.actualizar(construirDashboard(datos()));
  assert.equal((raiz.innerHTML.match(/Sin hora registrada/g)||[]).length,57);
  assert.equal((raiz.innerHTML.match(/Confirmación administrativa/g)||[]).length,57);
  assert.match(raiz.innerHTML,/Administración QA/);
});

test('una conciliación no vuelve a pendientes ni ofrece una entrega manual; sin cargo siempre prevalece',()=>{
  const d=datos(), agenda=GoLunchGuiado.servicios(d.comidas,'zona_vdc',fecha);
  assert.ok(agenda.length>0);assert.ok(agenda.every(s=>s.pendientes===0));
  assert.equal(GoLunchReparto.pendientesDelCierre(d.comidas,'zona_vdc','turno_a').length,0);
  const p={...d.comidas[2],no_surtido_en:fecha+'T12:00:00-06:00',no_surtido_por:'admin',no_surtido_motivo:'Cocina no envió la comida.'};
  assert.equal(entregada(p),false);assert.equal(sinHoraEntrega(p),false);
  const diario=prepararReporteEntregas(fecha,[p]);assert.equal(diario.entregado.total,0);assert.equal(diario.no_surtidos,1);assert.equal(diario.pendientes,0);
});

test('Excel conserva 59 entregadas, cero pendientes y autor/motivo, dejando vacía la hora desconocida',async()=>{
  const r=await crearExcelFacturacion(fecha,fecha,118,datos().comidas);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(r.buffer);
  const resumen=wb.getWorksheet('Resumen_Facturacion'),a=wb.getWorksheet('Auditoria_Detalle');
  assert.equal(resumen.getCell('B10').result,48);assert.equal(resumen.getCell('C10').result,11);
  assert.equal(resumen.getCell('D10').result,59);assert.equal(resumen.getCell('G10').result,59);assert.equal(resumen.getCell('H10').result,0);
  const f=Array.from({length:59},(_,i)=>a.getRow(i+10)).find(f=>f.getCell(12).value);
  assert.equal(f.getCell(11).value,null);assert.ok(f.getCell(12).value instanceof Date);
  assert.equal(f.getCell(13).value,conciliacion.entrega_conciliada_por);assert.equal(f.getCell(14).value,conciliacion.entrega_conciliacion_motivo);
});
