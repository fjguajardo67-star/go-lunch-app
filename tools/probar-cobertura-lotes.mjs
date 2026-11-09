import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
// Uso: node tools/probar-cobertura-lotes.mjs /ruta/temporal/node_modules/@electric-sql/pglite
// Dependencia exclusivamente de prueba; no se instala en Railway.
if (!process.argv[2]) throw new Error('Indica la carpeta de PGlite instalada en un directorio temporal.');
const modulo = path.resolve(process.argv[2]);
const { PGlite } = await import(pathToFileURL(path.join(modulo,'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(path.join(modulo,'dist/contrib/pgcrypto.js')));
const repo = fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const pg=new PGlite({extensions:{pgcrypto}});
await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
await pg.exec(await fs.readFile(repo+'/schema.sql','utf8'));
const archivo=repo+'/supabase/migrations/20261109194358_cobertura_supervisor_lotes_dos_horas.sql';
const migracion=await fs.readFile(archivo,'utf8');
await pg.exec(migracion);
console.log('Migración original aplicada en PostgreSQL local');
await pg.exec("create table qa_reloj(ahora timestamptz); insert into qa_reloj values ('2026-11-09T12:00:00-06:00'); create function public.qa_ahora() returns timestamptz language sql as $$select ahora from qa_reloj$$;");
// Reloj controlado solo en la copia local de funciones; la migración original
// anterior ya compiló íntegra. No existe este reemplazo en el archivo desplegable.
for(const trozo of migracion.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]+?\n\$\$;/g))await pg.exec(trozo[0].replaceAll('clock_timestamp()','public.qa_ahora()'));
await pg.exec("insert into empleados(telefono,nombre,numero_empleado) select 'qa-'||i,'Persona ficticia '||i,lpad(i::text,5,'0') from generate_series(1,12) i; insert into supervisores_cobertura(empleado_telefono,clave_hash,vigente_desde) values ('qa-1','sin-credencial','2026-01-01'),('qa-2','sin-credencial','2026-01-01'); insert into menus_cobertura(fecha,opcion_1,opcion_2,opcion_3) values('2026-11-09','Pollo QA','Pescado QA','Ensalada QA');");
let n=0;
const items=numero=>JSON.stringify([{numero_empleado:String(numero).padStart(5,'0'),opcion_id:'especial_1'}]);
const crear=async({supervisor=1,turno='turno_a',zona='zona_refris',hora='14:00',persona=3,uuid=null,id=null,version=null,fecha='2026-11-09'}={})=>{
 const intento=uuid||'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');
 const r=await pg.query('select * from guardar_lote_cobertura_supervisor($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)',[supervisor,fecha,turno,zona,'QA-'+n,'00001',items(persona),fecha+'T'+hora+':00-06:00',intento,id,version]);return r.rows[0];
};
const rechaza=async(fn,marca)=>{await assert.rejects(fn,e=>String(e.message).includes(marca));};
const a=await crear({}); assert.equal(a.total_porciones,1);
assert.equal((await crear({uuid:a.idempotencia})).id,a.id);
await rechaza(()=>crear({hora:'13:59',persona:4}),'anticipacion_cobertura_insuficiente');
const b=await crear({zona:'zona_vdc',persona:4,hora:'15:00'});assert.notEqual(a.id,b.id);
const c=await crear({persona:3,turno:'turno_b',hora:'16:00'});assert.notEqual(c.id,a.id);
await rechaza(()=>crear({persona:3,turno:'turno_a',zona:'zona_vdc',hora:'18:00',supervisor:2}),'empleados_ya_asignados');
await rechaza(()=>crear({uuid:a.idempotencia,persona:4}),'idempotencia_cobertura_invalida');
await rechaza(()=>crear({id:b.id,supervisor:2,persona:4,version:b.actualizado_en}),'solicitud_cobertura_no_encontrada');
await rechaza(()=>crear({id:b.id,persona:4,hora:'16:00',version:'2026-01-01T00:00:00Z'}),'version_cobertura_desactualizada');
const qrAntes=(await pg.query('select codigo_entrega from solicitudes_cobertura_items where solicitud_id=$1',[b.id])).rows[0].codigo_entrega;
const editado=await crear({id:b.id,persona:4,hora:'16:00',zona:'zona_vdc',version:b.actualizado_en});
assert.equal(editado.id,b.id);assert.equal((await pg.query('select codigo_entrega from solicitudes_cobertura_items where solicitud_id=$1',[b.id])).rows[0].codigo_entrega,qrAntes);
await pg.exec("update qa_reloj set ahora='2026-11-09T12:00:01-06:00'");
assert.equal((await crear({uuid:a.idempotencia})).id,a.id,'el reintento posterior al corte debe recuperar el folio');
await rechaza(()=>crear({id:a.id,persona:3,hora:'18:00',version:a.actualizado_en}),'anticipacion_cobertura_insuficiente');
await rechaza(()=>pg.query('select * from cancelar_lote_cobertura_supervisor($1,$2,$3)',[1,a.id,a.actualizado_en]),'anticipacion_cobertura_insuficiente');
const cancelado=(await pg.query('select * from cancelar_lote_cobertura_supervisor($1,$2,$3)',[1,b.id,editado.actualizado_en])).rows[0];assert.equal(cancelado.estado,'cancelada');
await crear({persona:4,hora:'18:00',zona:'zona_vdc'});
await pg.query('update solicitudes_cobertura_items set entregado_en=qa_ahora() where solicitud_id=$1',[c.id]);
await rechaza(()=>crear({id:c.id,persona:3,turno:'turno_b',hora:'18:00',version:c.actualizado_en}),'solicitud_ya_entregada');
await rechaza(()=>pg.query('select * from cancelar_lote_cobertura_supervisor($1,$2,$3)',[1,c.id,c.actualizado_en]),'solicitud_ya_entregada');
await rechaza(()=>crear({fecha:'2026-11-10',persona:7}),'fecha_cobertura_invalida');
await pg.exec("update supervisores_cobertura set activo=false where id=2");await rechaza(()=>crear({supervisor:2,persona:8}),'supervisor_no_autorizado');
const priv=(await pg.query("select has_function_privilege('anon','public.guardar_lote_cobertura_supervisor(bigint,date,varchar,varchar,text,text,jsonb,timestamptz,uuid,bigint,timestamptz)','EXECUTE') as anon,has_function_privilege('service_role','public.guardar_lote_cobertura_supervisor(bigint,date,varchar,varchar,text,text,jsonb,timestamptz,uuid,bigint,timestamptz)','EXECUTE') as servicio")).rows[0];assert.equal(priv.anon,false);assert.equal(priv.servicio,true);
console.log('OK: igualdad exacta de dos horas, rechazo1h59, varios turnos/zonas, duplicados globales, reintentos, propiedad, versión, QR estable, entregas inmutables, cancelaciones y permisos');
await pg.close();
