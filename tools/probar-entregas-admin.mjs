// PostgreSQL real embebido (PGlite); instalación temporal, sin dependencia de producción.
// node tools/probar-entregas-admin.mjs /ruta/node_modules/@electric-sql/pglite
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const modulo=path.resolve(process.argv[2] || '');
const {PGlite}=await import(pathToFileURL(path.join(modulo,'dist/index.js')));
const {pgcrypto}=await import(pathToFileURL(path.join(modulo,'dist/contrib/pgcrypto.js')));
const pg=new PGlite({extensions:{pgcrypto}});
const schema=await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8');
const migraciones=['20261109194358_cobertura_supervisor_lotes_dos_horas.sql','20261110172632_incidencias_comidas_sin_cargo.sql',
  '20261117053225_entrega_conciliacion_administrativa.sql','20261121003218_confirmar_entregas_admin_lote.sql'];
const query=async(sql,params=[])=>(await pg.query(sql,params)).rows;
const one=async(sql,params)=>(await query(sql,params))[0];
const reject=(fn,marca)=>assert.rejects(fn,e=>String(e.message).includes(marca));
const preview=async(fecha)=>(await one('select public.preview_entregas_admin($1) as r',[fecha])).r;
const motivo='Entrega física verificada; no se registró el escaneo.';
const confirmar=async(fecha,items,id=randomUUID(),m=motivo,confirmado=true)=>(await one('select public.confirmar_entregas_admin($1,$2,$3,$4,$5) as r',[fecha,JSON.stringify(items),m,confirmado,id])).r;
const regular=id=>one('select to_jsonb(p) as r from pedidos p where id=$1',[id]).then(x=>x.r);
const item=id=>one('select to_jsonb(i) as r from solicitudes_cobertura_items i where id=$1',[id]).then(x=>x.r);
const padre=id=>one('select to_jsonb(s) as r from solicitudes_cobertura s where id=$1',[id]).then(x=>x.r);
const seleccion=v=>v.items.map(({tipo,id,version})=>({tipo,id,version}));
let checks=0;
const check=async(nombre,fn)=>{await fn();checks++;console.log('OK:',nombre);};
try {
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  // Ruta de actualización: schema histórico + migraciones EXACTAS, sin regex SQL simulada.
  await pg.exec(schema.split('-- Confirmación administrativa por lote: backend exclusivo de administrador.')[0]);
  let guardAntes;
  for(const f of migraciones) {
    if(f===migraciones.at(-1)) guardAntes=(await one("select pg_get_functiondef('proteger_folio_con_incidencia'::regproc) d")).d;
    await pg.exec(await fs.readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  }
  assert.equal((await one("select pg_get_functiondef('proteger_folio_con_incidencia'::regproc) d")).d,guardAntes);
  const {hoy,ayer,manana}=await one("select timezone('America/Mexico_City',clock_timestamp())::date::text hoy,(timezone('America/Mexico_City',clock_timestamp())::date-1)::text ayer,(timezone('America/Mexico_City',clock_timestamp())::date+1)::text manana");
  await pg.exec(`insert into empleados(telefono,nombre,numero_empleado) select 'qa-'||i,'Persona QA '||i,lpad(i::text,5,'0') from generate_series(1,20)i;
    insert into menus(fecha,fija_a,fija_b,fija_c,var_1,var_2,var_3) select d,'QA','QA','QA','QA','QA','QA' from unnest(array[date '${ayer}',date '${hoy}',date '${manana}'])d;
    insert into pedidos(fecha_menu,empleado_telefono,opcion_id,opcion_texto,zona,turno) select date '${ayer}','qa-'||i,'fija_a','Platillo QA','zona_refris','turno_a' from generate_series(1,12)i;
    insert into pedidos(fecha_menu,empleado_telefono,opcion_id,opcion_texto,zona,turno) values(date '${manana}','qa-1','fija_a','Futuro QA','zona_refris','turno_a');
    insert into supervisores_cobertura(empleado_telefono,clave_hash,vigente_desde) values('qa-20','qa-no-usar','2020-01-01');
    insert into menus_cobertura(fecha,opcion_1,opcion_2,opcion_3) select d,'QA','QA','QA' from unnest(array[date '${ayer}',date '${hoy}'])d;
    insert into solicitudes_cobertura(folio,fecha_servicio,supervisor_id,supervisor_numero_snapshot,supervisor_nombre_snapshot,responsable_telefono,responsable_numero_snapshot,responsable_nombre_snapshot,zona,turno,total_porciones,idempotencia,entrega_programada_en)
      select 'QA-ADMIN-'||i,date '${ayer}',1,'00020','Responsable QA','qa-20','00020','Responsable QA','zona_refris','turno_a',3,gen_random_uuid(),(date '${ayer}'+time '10:00') at time zone 'America/Mexico_City' from generate_series(1,3)i;
    insert into solicitudes_cobertura(folio,fecha_servicio,supervisor_id,supervisor_numero_snapshot,supervisor_nombre_snapshot,responsable_telefono,responsable_numero_snapshot,responsable_nombre_snapshot,zona,turno,total_porciones,idempotencia,entrega_programada_en)
      values('QA-FUTURA',date '${hoy}',1,'00020','Responsable QA','qa-20','00020','Responsable QA','zona_refris','turno_b',1,gen_random_uuid(),(date '${hoy}'+time '23:59:59.999999') at time zone 'America/Mexico_City');
    insert into solicitudes_cobertura_items(solicitud_id,fecha_servicio,empleado_telefono,empleado_numero_snapshot,empleado_nombre_snapshot,opcion_id,opcion_texto)
      select s.id,s.fecha_servicio,'qa-'||i,lpad(i::text,5,'0'),'Persona QA '||i,'especial_1','Cobertura QA' from solicitudes_cobertura s cross join generate_series(1,3)i where s.id<=3;
    insert into solicitudes_cobertura_items(solicitud_id,fecha_servicio,empleado_telefono,empleado_numero_snapshot,empleado_nombre_snapshot,opcion_id,opcion_texto)
      values(4,date '${hoy}','qa-1','00001','Persona QA 1','especial_1','Futura QA');
    update solicitudes_cobertura set estado='cancelada' where id=3;`);
  // Asegurar ids predecibles por padre, sin depender del orden de INSERT SELECT.
  const hijos1=(await query('select id from solicitudes_cobertura_items where solicitud_id=1 order by id')).map(x=>x.id);
  const hijos2=(await query('select id from solicitudes_cobertura_items where solicitud_id=2 order by id')).map(x=>x.id);
  const cancelado=(await one('select id from solicitudes_cobertura_items where solicitud_id=3 order by id limit 1')).id;
  await query("select registrar_comida_no_surtida('cobertura',$1,'Cocina no surtió esta porción.','admin',null,$2)",[hijos1[2],ayer]);
  await query('update solicitudes_cobertura_items set entregado_en=clock_timestamp(),entrega_lat=19.1,entrega_lon=-102.1 where id=$1',[hijos2[0]]);
  const base=await preview(ayer);
  const buscar=(tipo,id)=>seleccion(base).find(x=>x.tipo===tipo&&x.id===id);
  await check('preview sin teléfonos, cancelados, no surtidos ni entregados; versiones SQL estables',async()=>{
    await pg.exec("set timezone='Pacific/Auckland'");
    assert.deepEqual(await preview(ayer),base);assert.equal(base.total,16);
    for(const x of base.items) assert.deepEqual(Object.keys(x).sort(),['tipo','id','version','nombre','numero_empleado','platillo','zona','turno','horario','folio'].sort());
    assert.ok(base.items.every(x=>/^[a-f0-9]{64}$/.test(x.version)));
    const v=await preview(hoy);assert.equal(v.total,0);assert.equal(v.futuras,1);assert.deepEqual(v.items,[]);
    await reject(()=>preview(manana),'servicio_futuro');
  });
  await check('horario SQL respeta vigencia histórica y zona del comedor',async()=>{
    for(const [fecha,zona,esperada] of [['2026-11-06',null,'17:00'],['2026-11-19','zona_refris','17:00'],['2026-11-20','zona_refris','17:30'],['2026-11-20','zona_vdc','18:00']]){
      const x=await one("select to_char(timezone('America/Mexico_City',horario_entregas_admin($1,'turno_b',$2)),'HH24:MI') h",[fecha,zona]);assert.equal(x.h,esperada);
    }
  });
  await check('todo o nada ante faltante, duplicado, fecha distinta, cancelación, futuro, motivo y confirmación',async()=>{
    const elegida=buscar('regular',1),inventada={tipo:'cobertura',id:cancelado,version:'a'.repeat(64)};
    for(const [items,f,marca,m,c] of [
      [[elegida,{...elegida,id:9999}],ayer,'comida_no_encontrada'],
      [[elegida,elegida],ayer,'entrada_entregas_invalida'],
      [[elegida],hoy,'fecha_servicio_actualizada'],
      [[elegida,inventada],ayer,'solicitud_cancelada'],
      [[{...elegida,id:13}],manana,'servicio_futuro'],
      [[elegida],ayer,'entrada_entregas_invalida','corto'],
      [[elegida],ayer,'entrada_entregas_invalida',motivo,false]]) {
      await reject(()=>confirmar(f,items,randomUUID(),m??motivo,c??true),marca);
      assert.equal((await regular(1)).entrega_conciliada_en,null);
    }
    const i=(await one('select id from solicitudes_cobertura_items where solicitud_id=4')).id;
    await reject(()=>confirmar(hoy,[{tipo:'cobertura',id:i,version:'a'.repeat(64)}]),'servicio_futuro');
    assert.equal((await one('select count(*)::int n from entregas_admin_operaciones')).n,0);
  });
  await check('cambios de dependencia invalidan versiones de selección completa',async()=>{
    const casos=[
      ["update pedidos set opcion_texto='Otro plato' where id=2",'regular',2],
      ["update pedidos set zona='zona_vdc' where id=2",'regular',2],
      ["update pedidos set turno='turno_b' where id=2",'regular',2],
      ["update empleados set nombre='Otro nombre' where telefono='qa-2'",'regular',2],
      ["update empleados set numero_empleado='ZZ002' where telefono='qa-2'",'regular',2],
      ["update solicitudes_cobertura set entrega_programada_en=entrega_programada_en+interval '1 minute' where id=1",'cobertura',hijos1[0]],
      ["update solicitudes_cobertura set zona='zona_vdc' where id=1",'cobertura',hijos1[0]],
      ["update solicitudes_cobertura set turno='turno_b' where id=1",'cobertura',hijos1[0]],
      ["update solicitudes_cobertura_items set empleado_nombre_snapshot='Otra persona' where id="+hijos1[0],'cobertura',hijos1[0]]
    ];
    // El padre 1 tiene incidencia: probar cambios de dependencia en padre 2.
    casos.splice(5,4,
      ["update solicitudes_cobertura set entrega_programada_en=entrega_programada_en+interval '1 minute' where id=2",'cobertura',hijos2[1]],
      ["update solicitudes_cobertura set zona='zona_vdc' where id=2",'cobertura',hijos2[1]],
      ["update solicitudes_cobertura set turno='turno_b' where id=2",'cobertura',hijos2[1]],
      ["update solicitudes_cobertura_items set empleado_nombre_snapshot='Otra persona' where id="+hijos2[1],'cobertura',hijos2[1]]);
    for(const [sql,tipo,id] of casos) {
      await pg.exec('begin');try {
        await pg.exec(sql);
        await reject(()=>confirmar(ayer,[buscar('regular',1),buscar(tipo,id)]),'version_entrega_actualizada');
      } finally {await pg.exec('rollback');}
      assert.equal((await regular(1)).entrega_conciliada_en,null);
    }
  });
  await check('rechaza escaneo e incidencia nuevos sin tocar la otra comida del lote',async()=>{
    for(const sql of ["update pedidos set entregado_en=clock_timestamp() where id=2",`select registrar_comida_no_surtida('regular',2,'No se surtió esta comida.','admin',null,date '${ayer}')`]){
      await pg.exec('begin');try{await pg.exec(sql);await reject(()=>confirmar(ayer,[buscar('regular',1),buscar('regular',2)]),'comida_no_pendiente');}finally{await pg.exec('rollback');}
    }
  });
  await check('fallo después de escribir las marcas revierte comidas y bitácora; UUID reutilizable tras rollback',async()=>{
    const antes=await regular(3),id=randomUUID();
    await pg.exec("create function qa_fallo_bitacora() returns trigger language plpgsql as $$begin raise exception 'qa_fallo_final';end;$$;create trigger qa_fallo_bitacora before insert on entregas_admin_operaciones for each row execute function qa_fallo_bitacora();");
    try{await reject(()=>confirmar(ayer,[buscar('regular',3)],id),'qa_fallo_final');}finally{await pg.exec('drop trigger qa_fallo_bitacora on entregas_admin_operaciones;drop function qa_fallo_bitacora();');}
    assert.deepEqual(await regular(3),antes);
    assert.equal((await one('select count(*)::int n from entregas_admin_operaciones where idempotencia=$1',[id])).n,0);
    assert.equal((await confirmar(ayer,[buscar('regular',3)],id)).registradas,1);
  });
  await check('guardas directas rechazan no surtida, escaneada, sin horario y dependencia de fecha del padre',async()=>{
    await reject(()=>confirmar(ayer,[{tipo:'cobertura',id:hijos1[2],version:'a'.repeat(64)}]),'comida_no_pendiente');
    await reject(()=>confirmar(ayer,[{tipo:'cobertura',id:hijos2[0],version:'a'.repeat(64)}]),'comida_no_pendiente');
    await pg.exec('begin');try{
      await pg.exec("update pedidos set turno=null where id=12");
      assert.equal((await preview(ayer)).sin_horario,1);
      await reject(()=>confirmar(ayer,[buscar('regular',12)]),'horario_invalido');
    }finally{await pg.exec('rollback');}
    await pg.exec('begin');try{
      await query('update solicitudes_cobertura set fecha_servicio=$1 where id=2',[hoy]);
      await reject(()=>confirmar(ayer,[buscar('cobertura',hijos2[1])]),'fecha_servicio_actualizada');
    }finally{await pg.exec('rollback');}
  });
  await check('folio mixto: concilia hijos, conserva incidencia y padre completos e inmutables',async()=>{
    const antesPadre=await padre(1),antesIncidencia=await item(hijos1[2]);
    const items=[buscar('cobertura',hijos1[0]),buscar('cobertura',hijos1[1]),buscar('regular',1)];
    const id=randomUUID();const r=await confirmar(ayer,items,id);assert.deepEqual(r,{ok:true,registradas:3,regulares:1,coberturas:2});
    assert.deepEqual(await padre(1),antesPadre);assert.deepEqual(await item(hijos1[2]),antesIncidencia);
    assert.equal((await regular(1)).entregado_en,null);assert.equal((await regular(1)).entrega_conciliada_por,'Administrador');
    const marcas=await Promise.all([regular(1),item(hijos1[0]),item(hijos1[1])]);
    for(const x of marcas){assert.equal(x.entregado_en,null);assert.equal(x.entrega_lat,null);assert.equal(x.entrega_conciliacion_motivo,motivo);}
    assert.equal(new Set(marcas.map(x=>x.entrega_conciliada_en)).size,1);
    // Mismo JSON con ids numéricos; orden y claves incidentales no alteran huella.
    const repetidos=await Promise.all([confirmar(ayer,[...items].reverse(),id),confirmar(ayer,JSON.parse(JSON.stringify(items)),id)]);
    for(const repetido of repetidos)assert.deepEqual(repetido,{...r,reintentada:true});
    assert.deepEqual(await Promise.all([regular(1),item(hijos1[0]),item(hijos1[1])]),marcas);
    await reject(()=>confirmar(ayer,items.slice(0,1),id),'idempotencia_entrega_invalida');
    await reject(()=>confirmar(ayer,items,id,'Otro motivo de entrega física verificada.'),'idempotencia_entrega_invalida');
    await reject(()=>confirmar(ayer,items.map(x=>({...x,version:'b'.repeat(64)})),id),'idempotencia_entrega_invalida');
    await reject(()=>confirmar(ayer,items),'comida_no_pendiente');
    await reject(()=>pg.exec("update solicitudes_cobertura set estado='cancelada' where id=1"),'folio_con_incidencia_no_surtido');
    await reject(()=>pg.exec("update pedidos set entrega_conciliacion_motivo='Otro motivo posterior' where id=1"),'conciliacion_entrega_inmutable');
  });
  await check('cierre parcial/final de cobertura conserva escaneos, GPS y hora desconocida del padre',async()=>{
    const real=await item(hijos2[0]);const r=await confirmar(ayer,[buscar('cobertura',hijos2[1])]);assert.equal(r.registradas,1);
    assert.equal((await padre(2)).estado,'confirmada');assert.deepEqual(await item(hijos2[0]),real);
    const actual=await preview(ayer),restante=seleccion(actual).find(x=>x.tipo==='cobertura'&&x.id===hijos2[2]);
    await confirmar(ayer,[restante]);const p=await padre(2);assert.equal(p.estado,'entregada');assert.equal(p.entregado_en,null);
    assert.deepEqual(await item(hijos2[0]),real);
  });
  await check('roles de BD: todas las RPC INVOKER, EXECUTE solo service_role; bitácora con RLS',async()=>{
    assert.ok((await one("select proconfig from pg_proc where proname='confirmar_entregas_admin'")).proconfig.includes('lock_timeout=3s'));
    const nombres=['horario_entregas_admin','version_entregas_admin','preview_entregas_admin','confirmar_entregas_admin'];
    const funcs=await query("select proname,prosecdef,has_function_privilege('anon',oid,'execute') a,has_function_privilege('authenticated',oid,'execute') u,has_function_privilege('service_role',oid,'execute') s from pg_proc where proname=any($1)",[nombres]);
    assert.equal(funcs.length,4);for(const f of funcs)assert.deepEqual([f.prosecdef,f.a,f.u,f.s],[false,false,false,true]);
    const t=await one("select relrowsecurity r,has_table_privilege('anon',oid,'select') a,has_table_privilege('authenticated',oid,'select') u,has_table_privilege('service_role',oid,'update') m from pg_class where relname='entregas_admin_operaciones'");assert.deepEqual(t,{r:true,a:false,u:false,m:false});
    // Ejecutar realmente con service_role (sin BYPASSRLS), no solo inspeccionar ACL.
    await pg.exec('grant select on pedidos,empleados,solicitudes_cobertura_items,solicitudes_cobertura to service_role; grant update on empleados,pedidos,solicitudes_cobertura_items,solicitudes_cobertura to service_role;');
    const [x]=seleccion(await preview(ayer)).filter(x=>x.tipo==='regular');
    await pg.exec('set role service_role');try{assert.equal((await confirmar(ayer,[x])).registradas,1);}finally{await pg.exec('reset role');}
    for(const rol of ['anon','authenticated']){await pg.exec('set role '+rol);try{await reject(()=>preview(ayer),'permission denied');await reject(()=>confirmar(ayer,[x]),'permission denied');}finally{await pg.exec('reset role');}}
  });
  await check('schema.sql completo instala el mismo backend en una base nueva',async()=>{
    const fresh=new PGlite({extensions:{pgcrypto}});try{
      await fresh.exec('create role anon;create role authenticated;create role service_role;');await fresh.exec(schema);
      // Como el resto del schema histórico, se completa con migraciones previas.
      for(const f of migraciones.slice(0,-1)) await fresh.exec(await fs.readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
      assert.deepEqual((await fresh.query('select preview_entregas_admin($1) as r',[ayer])).rows[0].r.items,[]);
      assert.equal((await fresh.query("select count(*)::int n from pg_proc where proname='confirmar_entregas_admin'")).rows[0].n,1);
    }finally{await fresh.close();}
  });
  console.log(`OK: ${checks} grupos de pruebas PostgreSQL/PGlite, migración exacta y schema nuevo.`);
}catch(e){console.error('FALLO SQL:',e.message);if(e.where)console.error(e.where);process.exitCode=1;}finally{await pg.close();}
