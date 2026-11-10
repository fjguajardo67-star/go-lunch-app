import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DateTime } from 'luxon';
import { validarIncidencia } from '../services/incidencias.js';
import { construirDashboard } from '../services/dashboard.js';
import { construirReporte } from '../services/reportes.js';
import { prepararReporteEntregas, htmlReporteEntregas } from '../services/reporte-entregas.js';
import { datosDashboard } from './fixtures/dashboard.mjs';
import { datosReportes } from './fixtures/reportes.mjs';
import { unirComidas } from '../services/comidas.js';
import '../public/reportes-excel.js';

const incidencia = { no_surtido_en:'2026-11-10T11:30:00-06:00', no_surtido_motivo:'Cocina omitió cargar la comida.', no_surtido_por:'gerente' };
test('regular y cobertura conservan identidad y evidencia, pero salen de entregas, pendientes y no-recogidos', () => {
  const d=datosDashboard(); Object.assign(d.pedidos[0],incidencia); Object.assign(d.coberturas[0],incidencia,{entregado_en:null});
  const r=construirDashboard(d);
  assert.equal(r.resumen.total_comidas,65); assert.equal(r.resumen.no_surtidos,2); assert.equal(r.resumen.entregados,63);
  assert.equal(r.resumen.pendientes,0); assert.equal(r.resumen.tardias,2);
  assert.equal(r.filas.filter(f=>f.estado==='no_surtido').length,2);
  assert.ok(r.filas.find(f=>f.estado==='no_surtido'&&f.tipo==='regular').entregado_en);
  assert.equal(r.resumen.entregados+r.resumen.pendientes+r.resumen.no_surtidos,r.resumen.total_comidas);

  const c=datosReportes(), comidas=unirComidas(c.pedidos,c.solicitudes.map(s=>({...s,items:c.items.filter(i=>i.solicitud_id===s.id)})));
  Object.assign(comidas[0],incidencia,{entregado_en:null}); Object.assign(comidas[61],incidencia);
  comidas[1].entregado_en=null;
  const reporte=construirReporte(c.fecha,c.fecha,comidas,DateTime.fromISO(c.fecha+'T23:00:00-06:00'));
  assert.equal(reporte.total,68); assert.equal(reporte.no_surtidos,2); assert.equal(reporte.entrega.no_entregados,1);
  assert.equal(reporte.sin_recoger.reduce((n,p)=>n+p.no_recogidos,0),1);
  assert.equal(reporte.merma.por_turno.reduce((n,p)=>n+p.no_recogidos,0),1);
  assert.equal(reporte.rating_elegibles,60);
  assert.equal(reporte.incidencias.length,2);
  const pdf=prepararReporteEntregas(c.fecha,comidas);
  assert.equal(pdf.entregado.total,65); assert.equal(pdf.pendientes,1); assert.equal(pdf.no_surtidos,2);
  assert.equal(pdf.grupos.filter(g=>!g.incidencia).reduce((n,g)=>n+g.total,0),65);
  assert.equal(pdf.grupos.filter(g=>g.incidencia).reduce((n,g)=>n+g.total,0),2);
  const html=htmlReporteEntregas(pdf);
  assert.match(html,/Incidencias sin cargo/); assert.match(html,/Sin cargo al empleado/);
  assert.match(html,/Marca previa rectificada/); assert.match(html,/Cocina omitió cargar la comida/);
  assert.match(html,/Total diario entregado: 65 comidas/);
});

test('el PDF pagina motivos máximos y escapa su contenido sin perder incidencias', () => {
  const base={fecha_menu:'2026-11-10',tipo:'regular',turno:'turno_a',zona:'zona_refris',opcion_texto:'Mixta de Res',empleados:{nombre:'Persona ficticia',numero_empleado:'00001'},...incidencia};
  const comidas=Array.from({length:20},(_,i)=>({...base,empleados:{...base.empleados,numero_empleado:String(i).padStart(5,'0')},no_surtido_motivo:'<script>'.repeat(62)}));
  const r=prepararReporteEntregas(base.fecha_menu,comidas), html=htmlReporteEntregas(r);
  assert.equal(r.entregado.total,0); assert.equal(r.no_surtidos,20); assert.equal(r.pendientes,0);
  assert.ok(r.paginas.length>2); assert.equal(r.paginas.flatMap(p=>p.partes.flatMap(g=>g.filas)).length,20);
  assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script>/);
});

test('Excel conserva detalle auditado y excluye no surtidas del subtotal con cargo', () => {
  const X={utils:{book_new:()=>({Sheets:{}}),book_append_sheet:(w,s,n)=>w.Sheets[n]=s,aoa_to_sheet:filas=>Object.fromEntries(filas.flatMap((r,i)=>r.map((v,j)=>[String.fromCharCode(65+j)+(i+1),{v}])))} };
  const f={zona:x=>x,turno:x=>x,servicio:p=>p.tipo,horario:()=>'',telefono:()=>'',filtros:()=>''};
  const base={fecha_menu:'2026-11-10',tipo:'regular',empleados:{numero_empleado:'00001'}};
  const w=GoLunchReportesExcel.facturacion(X,f,base.fecha_menu,base.fecha_menu,100,[base,{...base,...incidencia},{...base,tipo:'cobertura',entregado_en:'2026-11-10T10:00:00-06:00'}]);
  assert.equal(w.Sheets.Resumen_Facturacion.D2.v,2); assert.equal(w.Sheets.Resumen_Facturacion.F2.v,200);
  assert.equal(w.Sheets.Resumen_Facturacion.I2.v,1); assert.equal(w.Sheets.Resumen_Facturacion.H2.v,1);
  assert.match(w.Sheets.Auditoria_Detalle.K3.v,/Sin cargo/); assert.equal(w.Sheets.Auditoria_Detalle.M3.v,incidencia.no_surtido_motivo);
});

test('API exige credenciales de panel, motivo y versión; la atribución viene del servidor', async () => {
  let rpc=null, conflicto=false;
  const db=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c; rpc={url:req.url,datos:JSON.parse(raw)};
    res.setHeader('content-type','application/json');
    if(conflicto){res.statusCode=400;res.end('{"code":"P0001","message":"estado_entrega_actualizado"}');return;}
    res.end(JSON.stringify({id:12,...incidencia}));
  });
  await new Promise(r=>db.listen(0,'127.0.0.1',r));
  process.env.SUPABASE_URL='http://127.0.0.1:'+db.address().port;process.env.SUPABASE_KEY='solo-prueba';process.env.ADMIN_KEY='admin-prueba';process.env.GERENTE_KEY='gerente-prueba';
  const {adminRouter}=await import('../routes/admin.js'); const app=express();app.use(express.json());app.use('/api',adminRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+server.address().port+'/api/incidencias/regular/12';
  const entrada={motivo:incidencia.no_surtido_motivo,entregado_esperado:null,p_rol:'admin',no_surtido_por:'inventado'};
  const post=(datos,clave='gerente-prueba')=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(clave?{'x-admin-key':clave}:{})},body:JSON.stringify(datos)});
  try {
    assert.equal((await post(entrada,null)).status,401);assert.equal(rpc,null);
    for(const d of [{motivo:'error'},{...entrada,motivo:'x'},{...entrada,motivo:'a'.repeat(501)},{...entrada,entregado_esperado:'invalido'}])assert.equal((await post(d)).ok,false);
    assert.equal(rpc,null);
    for(const [clave,rol] of [['gerente-prueba','gerente'],['admin-prueba','admin']]){
      const res=await post(entrada,clave);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
      assert.equal(rpc.datos.p_rol,rol); assert.equal(rpc.datos.p_id,12);assert.equal(rpc.datos.no_surtido_por,undefined);
    }
    conflicto=true;const res=await post(entrada);assert.equal(res.status,409);assert.match((await res.json()).error,/Cambió el estado/);
    for(const t of ['otra','regular'])assert.throws(()=>validarIncidencia(t,'0',entrada));
  }finally{await new Promise(r=>server.close(r));await new Promise(r=>db.close(r));}
});
