import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { autorizarPanel, rolPanel } from '../services/acceso-panel.js';

test('gerente consulta e imprime, pero no puede modificar menús ni empleados', async () => {
  process.env.ADMIN_KEY = 'admin-solo-prueba';
  process.env.GERENTE_KEY = 'gerente-solo-prueba';
  const app = express();
  app.use('/api', autorizarPanel, (req, res) => res.json({ rol: req.rolPanel }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const pedir = (path, method='GET', key=process.env.GERENTE_KEY, user='gerente') => fetch(url+'/api'+path, {
    method, headers: { 'x-admin-key': key, 'x-panel-user': user }
  });
  try {
    assert.equal((await pedir('/sesion')).status, 200);
    assert.equal((await pedir('/sesion','GET',process.env.GERENTE_KEY,'admin')).status,401);
    assert.equal((await pedir('/sesion','GET',process.env.ADMIN_KEY,'gerente')).status,401);
    assert.equal((await pedir('/sesion','GET','incorrecta')).status,401);
    for (const path of ['/empleados','/menu/2026-11-07','/cobertura/menu/2026-11-07','/pedidos','/reportes','/dashboard/2026-11-07']) {
      assert.equal((await pedir(path)).status,200,path);
    }
    for (const path of ['/empleados','/empleados/123/activo','/empleados/123/telefono','/menu','/cobertura/menu']) {
      for (const method of ['POST','PUT','PATCH','DELETE']) {
        assert.equal((await pedir(path,method)).status,403,method+' '+path);
        assert.equal((await pedir(path,method,process.env.ADMIN_KEY,'')).status,200,'admin '+method+' '+path);
      }
    }
    assert.equal((await pedir('/repartidores','POST')).status,200);
    assert.equal((await pedir('/cobertura/supervisores','POST')).status,200);
    assert.equal(rolPanel(process.env.GERENTE_KEY),'gerente');
    assert.equal(rolPanel(''),null);
    assert.equal(rolPanel(undefined),null);
    delete process.env.GERENTE_KEY;
    assert.equal(rolPanel('gerente-solo-prueba'),null);
  } finally {
    await new Promise(r => server.close(r));
    delete process.env.ADMIN_KEY;
    delete process.env.GERENTE_KEY;
  }
});
