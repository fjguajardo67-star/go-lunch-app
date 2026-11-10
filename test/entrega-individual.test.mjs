import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { Settings } from 'luxon';
import { emitirToken } from '../services/sesion.js';

const fecha = '2026-11-10', zona = 'zona_refris', otraZona = 'zona_vdc';
const hora = fecha + 'T10:00:00-06:00';
const escuchar = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const cerrar = server => new Promise(resolve => server.close(resolve));

test('API de entrega individual: métodos, primera marca, colas antiguas y zonas de sesión', async t => {
  const variables = ['SUPABASE_URL', 'SUPABASE_KEY', 'ADMIN_KEY', 'ENTREGA_SESSION_SECRET', 'TZ'];
  const previas = Object.fromEntries(variables.map(k => [k, process.env[k]]));
  const reloj = Settings.now;
  Settings.now = () => Date.parse(fecha + 'T12:00:00-06:00');
  process.env.TZ = 'America/Mexico_City';
  let tablas, escrituras, alActualizar;
  function reiniciar() {
    const empleados = Array.from({ length: 7 }, (_, i) => ({
      telefono: 'QA-' + i, numero_empleado: '00' + (i + 1), nombre: 'Persona ficticia ' + i, activo: i !== 0
    }));
    tablas = {
      empleados,
      pedidos: empleados.slice(0, 6).map((e, i) => ({ id: i + 1, fecha_menu: fecha,
        empleado_telefono: e.telefono, zona: i === 4 ? otraZona : i === 5 ? null : zona,
        turno: 'turno_a', opcion_texto: 'Pollo QA', entregado_en: null, metodo_entrega: null, no_surtido_en: null })),
      solicitudes_cobertura: [zona, otraZona].map((z, i) => ({ id: i + 1, fecha_servicio: fecha, folio: 'QA-' + i,
        zona: z, turno: 'turno_a', estado: 'confirmada', origen: 'supervisor',
        responsable_numero_snapshot: '007', responsable_nombre_snapshot: 'Responsable QA' })),
      solicitudes_cobertura_items: [zona, otraZona].map((_, i) => ({ id: i + 1, solicitud_id: i + 1,
        codigo_entrega: 'EX-' + i, fecha_servicio: fecha, empleado_numero_snapshot: '007',
        empleado_nombre_snapshot: 'Persona cobertura QA', opcion_texto: 'Cobertura QA', entregado_en: null,
        metodo_entrega: null, no_surtido_en: null })),
      llegadas: [zona, otraZona, null].flatMap(z => ['turno_a', 'turno_b'].map(turno => ({ zona: z, turno, fecha_menu: fecha, llegada_en: hora }))),
      puntos_entrega: [zona, otraZona, null].map(z => ({ zona: z, lat: 18, lon: -102 })),
      repartidores: [{ id: 10, nombre: 'Repartidor QA', zonas: [zona], activo: true, version_sesion: 1 }]
    };
    escrituras = [];
    alActualizar = null;
  }
  reiniciar();
  // PostgREST local con filtros reales de cada petición; ninguna conexión externa.
  const base = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://qa'), tabla = u.pathname.split('/').at(-1);
      assert.ok(Object.hasOwn(tablas, tabla), 'Tabla inesperada: ' + tabla);
      if (req.method === 'PATCH' && alActualizar) { const fn = alActualizar; alActualizar = null; fn(tabla); }
      let filas = tablas[tabla].filter(p => [...u.searchParams].every(([k, v]) => {
        if (v.startsWith('eq.')) return String(p[k]) === v.slice(3);
        if (v.startsWith('neq.')) return String(p[k]) !== v.slice(4);
        if (v === 'is.null') return p[k] == null;
        if (v.startsWith('gte.')) return String(p[k]) >= v.slice(4);
        if (v.startsWith('lte.')) return String(p[k]) <= v.slice(4);
        if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(p[k]));
        return true;
      }));
      const total = filas.length;
      filas = filas.slice(Number(u.searchParams.get('offset') || 0),
        Number(u.searchParams.get('offset') || 0) + Number(u.searchParams.get('limit') || total));
      if (req.method === 'PATCH') {
        let raw = ''; for await (const parte of req) raw += parte;
        const cambios = JSON.parse(raw);
        for (const fila of filas) { Object.assign(fila, cambios); escrituras.push({ tabla, id: fila.id, cambios }); }
      }
      res.setHeader('content-type', 'application/json');
      res.setHeader('content-range', '0-' + Math.max(0, total - 1) + '/' + total);
      res.end(JSON.stringify(tabla === 'pedidos'
        ? filas.map(p => ({ ...p, empleados: tablas.empleados.find(e => e.telefono === p.empleado_telefono) })) : filas));
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ message: e.message })); }
  });
  await escuchar(base);
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + base.address().port;
  process.env.SUPABASE_KEY = 'solo-prueba';
  process.env.ADMIN_KEY = 'admin-prueba';
  process.env.ENTREGA_SESSION_SECRET = 'sesion-local-de-prueba';
  let server;
  try {
    const { entregaRouter } = await import('../routes/entrega.js');
    const app = express(); app.use(express.json()); app.use('/api/entrega', entregaRouter);
    server = http.createServer(app); await escuchar(server);
    const url = 'http://127.0.0.1:' + server.address().port + '/api/entrega';
    const admin = { 'x-admin-key': 'admin-prueba' };
    const sesion = () => ({ authorization: 'Bearer ' + emitirToken(tablas.repartidores[0]) });
    const regular = extra => ({ tipo: 'regular', numero_empleado: '001', zona, turno: 'turno_a',
      accion: 'entrega', entregado_en: hora, metodo_entrega: 'camara', ...extra });
    const cobertura = extra => regular({ tipo: 'cobertura', numero_empleado: '007', codigo_entrega: 'EX-0', ...extra });
    async function post(entregas, headers = admin, lote = {}) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ fecha, entregas, ...lote }) });
      return { status: r.status, ...await r.json() };
    }
    async function get(query = '', headers = sesion()) {
      const r = await fetch(url + '/hoy' + query, { headers }); return { status: r.status, ...await r.json() };
    }

    await t.test('una llegada de otro repartidor no se atribuye a la sesión actual', async () => {
      reiniciar();
      const antes=JSON.stringify(tablas.llegadas);
      const r=await fetch(url+'/llegada',{method:'POST',headers:{'content-type':'application/json',...sesion()},
        body:JSON.stringify({fecha,zona,turno:'turno_a',llegada_en:hora,repartidor_id:11})});
      assert.equal(r.status,403);assert.equal((await r.json()).motivo,'otro_repartidor');
      assert.equal(JSON.stringify(tablas.llegadas),antes);assert.equal(escrituras.length,0);
    });

    await t.test('cámara, lector y captura manual persisten en ambas clases; reintentos conservan TODA la evidencia', async () => {
      for (const metodo of ['camara', 'lector', 'manual']) for (const tipo of ['regular', 'cobertura']) {
        reiniciar();
        const entrada = tipo === 'regular' ? regular : cobertura;
        let r = await post([entrada({ metodo_entrega: metodo, lat: 18, lon: -102, precision_m: 5 })], sesion());
        assert.equal(r.resultados[0].ok, true); assert.equal(r.resultados[0].metodo_entrega, metodo);
        const tabla = tipo === 'regular' ? 'pedidos' : 'solicitudes_cobertura_items';
        const primera = structuredClone(tablas[tabla][0]), total = escrituras.length;
        r = await post([entrada({ metodo_entrega: metodo === 'manual' ? 'lector' : 'manual', entregado_en: fecha + 'T11:00:00-06:00',
          motivo_tardia: 'trafico', lat: 20, lon: -104, precision_m: 20, recibido_por: 'Otro receptor' })]);
        assert.equal(r.resultados[0].ya_entregado, true); assert.equal(r.resultados[0].metodo_entrega, metodo);
        assert.deepEqual(tablas[tabla][0], primera); assert.equal(escrituras.length, total);
        assert.equal((await get()).pedidos.find(p => p.tipo === tipo && p.numero_empleado === (tipo === 'regular' ? '001' : '007')).metodo_entrega, metodo);
      }
    });

    await t.test('colas individuales antiguas guardan null y un reintento nuevo no inventa escaneo histórico', async () => {
      for (const entrada of [regular, cobertura]) {
        reiniciar();
        const r = await post([entrada({ accion: undefined, metodo_entrega: undefined })]);
        assert.equal(r.resultados[0].ok, true); assert.equal(r.resultados[0].metodo_entrega, null);
        const n = escrituras.length;
        const repetido = await post([entrada({ metodo_entrega: 'lector' })]);
        assert.equal(repetido.resultados[0].ya_entregado, true); assert.equal(repetido.resultados[0].metodo_entrega, null);
        assert.equal(escrituras.length, n);
      }
    });

    await t.test('cierre y origen lista nunca registran pendientes, incluso con método y supervisor', async () => {
      reiniciar();
      for (const entrada of [regular, cobertura]) for (const obsoleto of [
        { accion: 'cierre_ruta' }, { origen: 'lista' }, { accion: 'cierre_ruta', entregado_a: 'supervisor' },
        { entregado_a: 'supervisor', accion: undefined }, { entregado_a: 'supervisor', metodo_entrega: undefined }
      ]) {
        const r = (await post([entrada(obsoleto)])).resultados[0];
        assert.equal(r.ok, false); assert.equal(r.motivo, 'entrega_requiere_revision'); assert.notEqual(r.definitivo, true);
      }
      for (const lote of [{ accion: 'cierre_ruta' }, { origen: 'lista' }]) {
        assert.equal((await post([regular({})], admin, lote)).resultados[0].ok, false);
      }
      assert.equal(escrituras.length, 0); assert.equal(tablas.pedidos[0].entregado_en, null);
      assert.equal(tablas.solicitudes_cobertura_items[0].entregado_en, null);
    });

    await t.test('un cierre/lista confirmado se libera sin escritura, incluso en colas sin grupo', async () => {
      for (const entrada of [regular, cobertura]) for (const metodo of [null, 'manual']) {
        reiniciar();
        const fila = entrada === regular ? tablas.pedidos[0] : tablas.solicitudes_cobertura_items[0];
        Object.assign(fila, { entregado_en: hora, metodo_entrega: metodo, entregado_por_nombre: 'Primera persona' });
        const original = structuredClone(fila);
        for (const extra of [{ accion: 'cierre_ruta' }, { origen: 'lista' }, { accion: 'cierre_ruta', turno: undefined, zona: undefined }]) {
          const r = (await post([entrada(extra)])).resultados[0];
          assert.equal(r.ok, true); assert.equal(r.ya_entregado, true); assert.equal(r.metodo_entrega, metodo);
        }
        assert.deepEqual(fila, original); assert.equal(escrituras.length, 0);
      }
    });

    await t.test('supervisor individual exige acción entrega y método válido; lote mezcla solo confirmaciones individuales', async () => {
      for (const metodo of ['camara', 'lector', 'manual']) {
        reiniciar();
        const r = await post([regular({ entregado_a: 'supervisor', recibido_por: 'Supervisora QA', metodo_entrega: metodo })]);
        assert.equal(r.resultados[0].ok, true); assert.equal(tablas.pedidos[0].entregado_a, 'supervisor');
        assert.equal(tablas.pedidos[0].recibido_por, 'Supervisora QA'); assert.equal(tablas.pedidos[0].metodo_entrega, metodo);
      }
      reiniciar();
      const r = await post([regular({}), regular({ numero_empleado: '002', accion: 'cierre_ruta' }), cobertura({ metodo_entrega: 'manual' })]);
      assert.equal(r.confirmadas, 2); assert.equal(tablas.pedidos[1].entregado_en, null);
    });

    await t.test('métodos inválidos no escriben; falta de grupo pendiente conserva revisión', async () => {
      reiniciar();
      for (const entrada of [regular, cobertura]) for (const metodo of ['', 'qr', 'CAMARA', 1, {}, []]) {
        assert.equal((await post([entrada({ metodo_entrega: metodo })])).resultados[0].motivo, 'metodo_entrega_invalido');
      }
      assert.equal((await post([regular({ turno: undefined })])).resultados[0].motivo, 'grupo_requerido');
      assert.equal(escrituras.length, 0);
    });

    await t.test('sin zona GET filtra pedidos, coberturas, índice, llegadas y puntos; reloj ISO México', async () => {
      reiniciar();
      let r = await get();
      assert.equal(r.status, 200); assert.equal(r.fecha, fecha); assert.equal(r.server_time, fecha + 'T12:00:00.000-06:00');
      assert.equal(r.total, 5); assert.equal(r.llegadas.length, 2); assert.equal(r.puntos.length, 1);
      for (const filas of [r.pedidos, r.llegadas, r.puntos]) assert.ok(filas.every(p => p.zona === zona));
      assert.deepEqual(Object.keys(r.indice_zonas).sort(), ['001', '002', '003', '004', 'EX|EX-0']);
      assert.ok(r.pedidos.every(p => p.metodo_entrega === null));
      assert.equal((await get('?zona=' + otraZona)).status, 403);
      r = await get('?zona=' + zona + '&turno=turno_a'); assert.equal(r.llegadas.length, 1);
      tablas.repartidores[0].zonas = [zona, otraZona];
      r = await get(); assert.equal(r.total, 7); assert.equal(r.puntos.length, 2); assert.equal(r.llegadas.length, 4);
      tablas.repartidores[0].zonas = [];
      r = await get(); assert.equal(r.total, 0); assert.deepEqual(r.indice_zonas, {}); assert.deepEqual(r.puntos, []); assert.deepEqual(r.llegadas, []);
      r = await get('', admin); assert.equal(r.total, 8);
    });

    await t.test('zona y sesión se verifican también para liberar colas confirmadas; ningún pendiente ajeno se modifica', async () => {
      reiniciar();
      for (const entregado of [null, hora]) {
        tablas.pedidos[4].entregado_en = entregado;
        for (const extra of [{ zona: otraZona }, { zona: undefined, turno: undefined, accion: 'cierre_ruta' }]) {
          const r = (await post([regular({ numero_empleado: '005', ...extra })], sesion())).resultados[0];
          assert.equal(r.ok, false);
        }
      }
      tablas.pedidos[0].entregado_en = hora;
      assert.equal((await post([regular({ accion: 'cierre_ruta', repartidor_id: 11 })], sesion())).resultados[0].motivo, 'otro_repartidor');
      assert.equal((await post([regular({})], {})).status, 401);
      assert.equal(escrituras.length, 0);
    });

    await t.test('concurrencia conserva la primera evidencia y no confirma una cobertura que sigue pendiente', async () => {
      for (const entrada of [regular, cobertura]) {
        reiniciar();
        const tabla = entrada === regular ? 'pedidos' : 'solicitudes_cobertura_items';
        alActualizar = nombre => { assert.equal(nombre, tabla); Object.assign(tablas[tabla][0], { entregado_en: hora, metodo_entrega: 'manual' }); };
        const r = (await post([entrada({ metodo_entrega: 'lector' })])).resultados[0];
        assert.equal(r.ya_entregado, true); assert.equal(r.metodo_entrega, 'manual'); assert.equal(escrituras.length, 0);
      }
      reiniciar();
      alActualizar = () => { tablas.solicitudes_cobertura_items.length = 0; };
      const r = (await post([cobertura({})])).resultados[0]; assert.equal(r.ok, false); assert.equal(r.motivo, 'grupo_actualizado');
    });
  } finally {
    if (server) await cerrar(server);
    await cerrar(base); Settings.now = reloj;
    for (const k of variables) if (previas[k] === undefined) delete process.env[k]; else process.env[k] = previas[k];
  }
});
