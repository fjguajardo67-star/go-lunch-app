import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {autorizarPanel,rolPanel} from '../services/acceso-panel.js';

test('monitoreo exige usuario/clave propios y bloquea cualquier escritura, incluso rutas futuras',async()=>{
 process.env.MONITOREO_KEY='monitoreo-qa';process.env.ADMIN_KEY='admin-qa';process.env.GERENTE_KEY='gerente-qa';
 const app=express();let llamadas=0;
 app.use(autorizarPanel,(req,res)=>{llamadas++;res.json({rol:req.rolPanel});});
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 const url=`http://127.0.0.1:${s.address().port}`;
 const pedir=(path,method='GET',usuario='monitoreo',key='monitoreo-qa')=>fetch(url+path,{method,headers:{'x-admin-key':key,'x-panel-user':usuario}});
 try{
  for(const p of ['/sesion','/dashboard/2026-11-17','/pedidos/2026-11-17','/cobertura/solicitudes/2026-11-17','/reporte-periodo','/reportes/operacion.xlsx','/reportes/facturacion.xlsx'])assert.equal((await pedir(p)).status,200,p);
  const antes=llamadas;
  for(const p of ['/menu','/empleados/1','/cobertura/supervisores/1/clave','/cobertura/extraordinarias','/repartidores/1/clave','/incidencias/regular/1','/enviar-menu','/ruta-futura']){
   for(const metodo of ['POST','PUT','PATCH','DELETE'])assert.equal((await pedir(p,metodo)).status,403,metodo+p);
  }
  assert.equal(llamadas,antes);
  for(const usuario of ['','admin','gerente'])assert.equal((await pedir('/sesion','GET',usuario)).status,401);
  assert.equal((await pedir('/sesion','GET','monitoreo','admin-qa')).status,401);
  assert.equal((await pedir('/sesion','GET','monitoreo','gerente-qa')).status,401);
  assert.equal((await pedir('/sesion','GET','monitoreo','incorrecta')).status,401);
  assert.equal(rolPanel('monitoreo-qa'),'monitoreo');delete process.env.MONITOREO_KEY;
  assert.equal((await pedir('/sesion')).status,401);
 }finally{await new Promise(r=>s.close(r));}
});

test('router real admite sesión, reportes y bitácora pero impide usar monitoreo para entregar o administrar GPS',async()=>{
 process.env.MONITOREO_KEY='monitoreo-qa';process.env.ADMIN_KEY='admin-qa';
 const db=http.createServer((req,res)=>{assert.equal(req.method,'GET');res.setHeader('Content-Type','application/json');res.end('[]');});
 await new Promise(r=>db.listen(0,'127.0.0.1',r));
 process.env.SUPABASE_URL=`http://127.0.0.1:${db.address().port}`;process.env.SUPABASE_KEY='qa';
 const {adminRouter}=await import('../routes/admin.js');const {entregaRouter}=await import('../routes/entrega.js');
 const app=express();app.use(express.json());app.use('/api/entrega',entregaRouter);app.use('/api',adminRouter);
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 const url=`http://127.0.0.1:${s.address().port}`;
 const pedir=(p,method='GET',usuario='monitoreo')=>fetch(url+p,{method,headers:{'x-admin-key':'monitoreo-qa','x-panel-user':usuario}});
 try{
  assert.deepEqual(await(await pedir('/api/sesion')).json(),{usuario:'monitoreo',rol:'monitoreo'});
  assert.equal((await pedir('/api/entrega/bitacora?fecha=2026-11-17')).status,200);
  for(const p of ['/api/reportes/operacion.xlsx?ini=2026-11-17&fin=2026-11-17','/api/reportes/facturacion.xlsx?ini=2026-11-17&fin=2026-11-17&costo=118','/api/reporte-periodo?ini=2026-11-17&fin=2026-11-17'])assert.equal((await pedir(p)).status,200,p);
  for(const p of ['/api/entrega/2026-11-17','/api/entrega/propuestas-punto'])assert.equal((await pedir(p)).status,403);
  assert.equal((await pedir('/api/entrega/bitacora?fecha=2026-11-17','GET','admin')).status,403);
  for(const p of ['/api/entrega/marcar','/api/entrega/ruta','/api/entrega/punto','/api/entrega/propuestas-punto','/api/entrega/propuestas-punto/1/resolver','/api/entrega/cualquier-ruta-nueva'])assert.equal((await pedir(p,'POST')).status,403,p);
 }finally{await new Promise(r=>s.close(r));await new Promise(r=>db.close(r));}
});

test('cliente rechaza escrituras antes de enviar y conserva las consultas',async()=>{
 const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
 const funcion=html.match(/  async function api\(path, opts = \{\}\) \{[\s\S]*?\n  \}/)[0];
 let llamadas=0;
 const c=vm.createContext({PANEL_ROL:'monitoreo',API_BASE:'',ADMIN_KEY:'qa',PANEL_USUARIO:'monitoreo',fetch:async()=>{llamadas++;return {ok:true,json:async()=>({ok:true})};}});
 vm.runInContext(funcion,c);
 await c.api('/api/sesion');assert.equal(llamadas,1);
 for(const method of ['POST','PUT','PATCH','DELETE'])await assert.rejects(c.api('/api/incidencias/regular/1',{method}),/solo lectura/);
 assert.equal(llamadas,1);
});
