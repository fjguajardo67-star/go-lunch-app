import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { validarEntregasAdmin, validarFechaEntregasAdmin } from '../services/entregas-admin.js';

const solicitud = () => ({ fecha:'2026-11-20', items:[{tipo:'regular',id:12,version:'a'.repeat(64)}],
  motivo:'Entrega física verificada por administración.', confirmado:true, idempotencia:randomUUID() });

test('validación estricta de fecha, confirmación física, motivo, UUID, selección y versiones', () => {
  const d=solicitud();
  for (const fecha of ['2026-02-30','2026-1-20','2026-11-20T12:00:00Z',null]) assert.throws(()=>validarFechaEntregasAdmin(fecha));
  for (const cambio of [{confirmado:false},{confirmado:'true'},{motivo:'corto'},{motivo:'a'.repeat(501)},
    {motivo:'motivo con\nsalto de línea'},{idempotencia:null},{items:[]},{items:Array(1001).fill(d.items[0])},
    {items:[d.items[0],d.items[0]]},{items:[{tipo:'otro',id:1,version:d.items[0].version}]},
    {items:[{tipo:'regular',id:0,version:d.items[0].version}]},{items:[{tipo:'regular',id:Number.MAX_SAFE_INTEGER+1,version:d.items[0].version}]},
    {items:[{tipo:'regular',id:1,version:'vieja'}]}]) assert.throws(()=>validarEntregasAdmin({...d,...cambio}));
  assert.deepEqual(validarEntregasAdmin({...d,motivo:'  '+d.motivo+'  ',autor:'Falso',items:[{...d.items[0],id:'12',entregado_en:'inventado'}]}),d);
});

test('API admin: preview privado, atribución de servidor, RPC atómica, errores y reintento estable', async () => {
  const llamadas=[];let error=null;let siguiente=null;
  const db=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    llamadas.push({url:req.url,body:JSON.parse(raw)});
    res.setHeader('content-type','application/json');
    if(error){res.statusCode=400;res.end(JSON.stringify(error));return;}
    res.end(JSON.stringify(siguiente || (req.url.endsWith('preview_entregas_admin') ?
      {fecha:'2026-11-20',items:[{tipo:'regular',id:12,version:'a'.repeat(64),nombre:'Persona QA',numero_empleado:'00012',platillo:'Comida QA',zona:'zona_refris',turno:'turno_a',horario:'10:00',folio:null}],total:1,futuras:3} :
      {ok:true,registradas:1,regulares:1,coberturas:0})));
  });
  await new Promise(r=>db.listen(0,'127.0.0.1',r));
  Object.assign(process.env,{SUPABASE_URL:`http://127.0.0.1:${db.address().port}`,SUPABASE_KEY:'solo-qa',ADMIN_KEY:'admin-qa',GERENTE_KEY:'gerente-qa',MONITOREO_KEY:'monitoreo-qa'});
  const {adminRouter}=await import('../routes/admin.js');const app=express();app.use(express.json());app.use('/api',adminRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/entregas-admin`;
  const request=(method='POST',body=solicitud(),key='admin-qa',usuario='')=>fetch(url+(method==='GET'?'/2026-11-20':''),{
    method,headers:{'content-type':'application/json',...(key?{'x-admin-key':key}:{}),'x-panel-user':usuario},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  try {
    for(const method of ['GET','POST']) {
      assert.equal((await request(method,undefined,null)).status,401);
      assert.equal((await request(method,undefined,'gerente-qa','gerente')).status,403);
      assert.equal((await request(method,undefined,'monitoreo-qa','monitoreo')).status,403);
    }
    for(const method of ['GET','HEAD','POST','OPTIONS']) {
      const mayusculas=await fetch(url.replace('/entregas-admin','/ENTREGAS-ADMIN')+(method==='POST'?'':'/2026-11-20'),{
        method,headers:{'x-admin-key':'gerente-qa','x-panel-user':'gerente'}
      });
      assert.equal(mayusculas.status,403,method+' con ruta en mayúsculas');
    }
    assert.equal(llamadas.length,0);
    const preview=await request('GET');assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');
    const vista=await preview.json();assert.equal(vista.total,1);assert.equal(vista.futuras,3);assert.equal(vista.items[0].telefono,undefined);
    assert.deepEqual(llamadas.at(-1),{url:'/rest/v1/rpc/preview_entregas_admin',body:{p_fecha:'2026-11-20'}});
    for(const body of [{...solicitud(),confirmado:false},{...solicitud(),motivo:'muy corto'},{...solicitud(),idempotencia:''}]) assert.equal((await request('POST',body)).status,400);
    assert.equal(llamadas.length,1);
    const d=solicitud();const respuesta=await request('POST',{...d,autor:'Gerente',p_rol:'gerente',entregado_en:'inventado'});
    assert.equal(respuesta.status,200);assert.equal(respuesta.headers.get('cache-control'),'no-store');
    assert.deepEqual(await respuesta.json(),{ok:true,registradas:1,regulares:1,coberturas:0});
    assert.deepEqual(llamadas.at(-1).body,{p_fecha:d.fecha,p_items:d.items,p_motivo:d.motivo,p_confirmado:true,p_idempotencia:d.idempotencia});
    siguiente={ok:true,registradas:1,regulares:1,coberturas:0,reintentada:true};assert.equal((await (await request('POST',d)).json()).reintentada,true);siguiente=null;
    for(const message of ['servicio_futuro','version_entrega_actualizada','comida_no_encontrada','comida_no_pendiente','solicitud_cancelada','fecha_servicio_actualizada','idempotencia_entrega_invalida','horario_invalido']){
      error={code:'P0001',message};assert.equal((await request()).status,409,message);
    }
    error={code:'PGRST202',message:'missing RPC'};assert.equal((await request()).status,503);
    error={code:'42P01',message:'missing table'};assert.equal((await request('GET')).status,503);
    error={code:'55P03',message:'lock timeout'};assert.equal((await request()).status,409);
    error={code:'XX000',message:'secret database info'};const fallida=await request();assert.equal(fallida.status,500);assert.doesNotMatch(JSON.stringify(await fallida.json()),/secret/);
  } finally { await new Promise(r=>server.close(r));await new Promise(r=>db.close(r)); }
});
