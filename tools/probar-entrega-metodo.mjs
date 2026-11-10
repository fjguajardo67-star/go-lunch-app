// PostgreSQL local: recibe la ruta de un @electric-sql/pglite ya instalado.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulo = path.resolve(process.argv[2] || '');
const { PGlite } = await import(pathToFileURL(path.join(modulo, 'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(path.join(modulo, 'dist/contrib/pgcrypto.js')));
const pg = new PGlite({ extensions: { pgcrypto } });
try {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await pg.exec(await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const nombre of ['20261109194358_cobertura_supervisor_lotes_dos_horas.sql', '20261110172632_incidencias_comidas_sin_cargo.sql']) {
    await pg.exec(await fs.readFile(new URL('../supabase/migrations/' + nombre, import.meta.url), 'utf8'));
  }
  await pg.exec(`
    INSERT INTO empleados(telefono,nombre,numero_empleado)
      SELECT 'qa-'||i,'Persona ficticia '||i,'0000'||i FROM generate_series(1,3)i;
    INSERT INTO menus(fecha,fija_a,fija_b,fija_c,var_1,var_2,var_3)
      VALUES('2026-11-10','QA','QA','QA','QA','QA','QA');
    INSERT INTO pedidos(fecha_menu,empleado_telefono,opcion_id,opcion_texto,zona,turno)
      SELECT '2026-11-10','qa-'||i,'fija_a','Comida QA','zona_refris','turno_a' FROM generate_series(1,2)i;
    UPDATE pedidos SET entregado_en='2026-11-10T10:00:00-06:00',
      entrega_recibido_en='2026-11-10T10:05:00-06:00',entregado_a='empleado',entregado_por_nombre='Reparto histórico QA' WHERE id=1;
    INSERT INTO supervisores_cobertura(empleado_telefono,clave_hash,vigente_desde) VALUES('qa-3','no-usar','2026-01-01');
    INSERT INTO menus_cobertura(fecha,opcion_1,opcion_2,opcion_3) VALUES('2026-11-10','QA','QA','QA');
    INSERT INTO solicitudes_cobertura(folio,fecha_servicio,supervisor_id,supervisor_numero_snapshot,supervisor_nombre_snapshot,
      responsable_telefono,responsable_numero_snapshot,responsable_nombre_snapshot,zona,turno,total_porciones)
      VALUES('QA-METODO','2026-11-10',1,'00003','Responsable QA','qa-3','00003','Responsable QA','zona_refris','turno_a',2);
    INSERT INTO solicitudes_cobertura_items(solicitud_id,fecha_servicio,empleado_telefono,empleado_numero_snapshot,
      empleado_nombre_snapshot,opcion_id,opcion_texto)
      SELECT 1,'2026-11-10','qa-'||i,'0000'||i,'Persona ficticia '||i,'especial_1','Comida QA' FROM generate_series(1,2)i;
    UPDATE solicitudes_cobertura_items SET entregado_en='2026-11-10T10:00:00-06:00',
      entrega_recibido_en='2026-11-10T10:05:00-06:00',receptor_nombre='Responsable histórico QA' WHERE id=1;
  `);
  const tablas = ['pedidos', 'solicitudes_cobertura_items'];
  const anteriores = await Promise.all(tablas.map(tabla => pg.query('SELECT * FROM ' + tabla + ' ORDER BY id')));
  const rlsAnterior = (await pg.query("SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('pedidos'::regclass,'solicitudes_cobertura_items'::regclass) ORDER BY relname")).rows;
  const migracion = await fs.readFile(new URL('../supabase/migrations/20261110213248_entrega_individual_metodo.sql', import.meta.url), 'utf8');
  await pg.exec('BEGIN;');
  await pg.exec(migracion);
  assert.equal((await pg.query('SHOW lock_timeout')).rows[0].lock_timeout, '3s');
  await pg.exec('COMMIT;');
  for (const [i, tabla] of tablas.entries()) {
    const actuales = (await pg.query('SELECT * FROM ' + tabla + ' ORDER BY id')).rows;
    assert.deepEqual(actuales, anteriores[i].rows.map(p => ({ ...p, metodo_entrega: null })), tabla + ': no cambiar datos existentes');
    const columna = (await pg.query(`SELECT is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name='metodo_entrega'`, [tabla])).rows[0];
    assert.deepEqual(columna, { is_nullable: 'YES', column_default: null });
    for (const metodo of ['camara', 'lector', 'manual', null]) {
      await pg.query('UPDATE ' + tabla + ' SET metodo_entrega=$1 WHERE id=2', [metodo]);
      assert.equal((await pg.query('SELECT metodo_entrega FROM ' + tabla + ' WHERE id=2')).rows[0].metodo_entrega, metodo);
    }
    for (const metodo of ['', 'qr', 'CAMARA', 'lista', 'cierre_ruta']) {
      await assert.rejects(() => pg.query('UPDATE ' + tabla + ' SET metodo_entrega=$1 WHERE id=2', [metodo]), e => e.code === '23514');
    }
    assert.equal((await pg.query('SELECT metodo_entrega FROM ' + tabla + ' WHERE id=1')).rows[0].metodo_entrega, null);
  }
  assert.deepEqual((await pg.query("SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('pedidos'::regclass,'solicitudes_cobertura_items'::regclass) ORDER BY relname")).rows, rlsAnterior);
  console.log('OK: migración exacta en PostgreSQL local; lock_timeout 3s, columnas nullable sin default, historial intacto, tres métodos válidos, CHECK rechaza otros valores y RLS conservado en ambas tablas.');
} finally { await pg.close(); }
