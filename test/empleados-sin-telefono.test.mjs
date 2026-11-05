import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import { guardarEmpleado } from '../services/empleados.js';
import { claveEmpleado, diezDigitos, esClaveInterna, formatoCanonico, variantesTelefono } from '../services/telefono.js';

// Usa el cliente Supabase real con transporte en memoria. Nunca envía datos
// a producción; simula las restricciones UNIQUE de número y clave primaria.
function basePrueba(inicial = []) {
  const filas = structuredClone(inicial), escrituras = [];
  const client = createClient('https://prueba.supabase.co', 'solo-pruebas', {
    global: { fetch: async (input, options) => {
      const url = new URL(input), method = options.method || 'GET';
      assert.equal(url.pathname, '/rest/v1/empleados');
      const coincide = fila => [...url.searchParams].every(([campo, filtro]) => {
        if (['select', 'limit'].includes(campo)) return true;
        if (filtro.startsWith('eq.')) return String(fila[campo]) === filtro.slice(3);
        if (filtro.startsWith('in.')) return filtro.slice(4, -1).split(',').map(x => x.replaceAll('"', '')).includes(fila[campo]);
        throw new Error('Filtro inesperado: ' + filtro);
      });
      let resultado = filas.filter(coincide);
      if (method !== 'GET') {
        const body = JSON.parse(options.body); escrituras.push({ method, body });
        if (method === 'POST') {
          if (filas.some(x => x.telefono === body.telefono || x.numero_empleado === body.numero_empleado)) {
            return new Response(JSON.stringify({code:'23505',message:'unique constraint'}), {status:409});
          }
          filas.push(body); resultado = [body];
        } else if (method === 'PATCH') resultado.forEach(x => Object.assign(x, body));
        else throw new Error('Método inesperado: ' + method);
      }
      const single = new Headers(options.headers).get('Accept')?.includes('vnd.pgrst.object');
      return new Response(JSON.stringify(single ? resultado[0] : resultado), {
        status: method === 'POST' ? 201 : 200, headers: {'Content-Type':'application/json'}
      });
    } }
  });
  return { client, filas, escrituras };
}

test('alta y recarga sin teléfono usan una identidad estable y no duplican', async () => {
  const db = basePrueba();
  const a = await guardarEmpleado(db.client, { nombre:'Persona de prueba', numero_empleado:'0012' });
  assert.equal(a.telefono, 'emp_30303132');
  assert.equal(a.numero_empleado, '0012');
  assert.ok(esClaveInterna(a.telefono));
  const b = await guardarEmpleado(db.client, { nombre:'Nombre actualizado', numero_empleado:'0012' });
  assert.equal(db.filas.length, 1); assert.equal(b.telefono, a.telefono);
  assert.equal(b.nombre, 'Nombre actualizado');
  assert.ok(!Object.hasOwn(db.escrituras[1].body, 'telefono'));
});

test('la recarga conserva teléfono real, clave e información omitida', async () => {
  const original = { nombre:'Anterior', numero_empleado:'123', telefono:'526361234567', activo:false, zona_default:'zona_vdc', turno_default:'turno_b' };
  const db = basePrueba([original]);
  const result = await guardarEmpleado(db.client, { nombre:'Actualizado', numero_empleado:'123', telefono:'', activo:true });
  assert.equal(result.telefono, original.telefono);
  assert.equal(result.zona_default, original.zona_default);
  assert.equal(result.turno_default, original.turno_default);
  assert.equal(result.activo, true);
  assert.equal(db.filas.length, 1);
});

test('asignación explícita puede cambiarse o quitarse sin alterar la identidad', async () => {
  const db = basePrueba();
  const a = await guardarEmpleado(db.client, { nombre:'Prueba', numero_empleado:'123', zona_default:'zona_vdc' });
  const b = await guardarEmpleado(db.client, { nombre:'Prueba', numero_empleado:'123', zona_default:null, turno_default:'turno_a' });
  assert.equal(b.zona_default, null); assert.equal(b.turno_default,'turno_a');
  assert.equal(b.telefono,a.telefono);
});

test('rechaza un teléfono inválido o una clave interna presentada como alta', async () => {
  const db = basePrueba();
  for (const telefono of ['123', 'emp_1234']) {
    await assert.rejects(guardarEmpleado(db.client,{nombre:'Prueba',numero_empleado:'123',telefono}), {status:400});
  }
  assert.equal(db.filas.length,0);
});

test('un teléfono de otra persona o cambio de teléfono no reemplaza identidades', async () => {
  const original = { nombre:'Anterior', numero_empleado:'123', telefono:'5216361234567', activo:true };
  const db = basePrueba([original]);
  await assert.rejects(guardarEmpleado(db.client,{nombre:'Otra',numero_empleado:'456',telefono:'6361234567'}),{status:409});
  await assert.rejects(guardarEmpleado(db.client,{nombre:'Anterior',numero_empleado:'123',telefono:'6367654321'}),{status:409});
  assert.deepEqual(db.filas,[original]); assert.equal(db.escrituras.length,0);
});

test('teléfono real sigue guardándose en formato compatible con los registros anteriores', async () => {
  const db=basePrueba();
  const a=await guardarEmpleado(db.client,{nombre:'Prueba',numero_empleado:'1',telefono:'6361234567'});
  assert.equal(a.telefono,'5216361234567');
  const b=await guardarEmpleado(db.client,{nombre:'Prueba',numero_empleado:'1',telefono:'526361234567'});
  assert.equal(b.telefono,a.telefono); assert.equal(db.filas.length,1);
});

test('normalización conserva claves internas y no las confunde con teléfonos', () => {
  for(const id of ['emp_30303132','emp_616263','emp_3132']) {
    assert.deepEqual(variantesTelefono(id),[id]);
    assert.equal(formatoCanonico(id),id); assert.equal(diezDigitos(id),'');
    assert.equal(claveEmpleado(id),id);
  }
  assert.equal(new Set(['emp_616263','emp_3132','5216361234567'].map(claveEmpleado)).size,3);
  assert.equal(claveEmpleado('526361234567'),claveEmpleado('5216361234567'));
});

function vistaImportacion(filas) {
  const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
  const src=html.slice(html.indexOf('  const COLUMNAS ='),html.indexOf('  function pintarPrevia('));
  const ctx=vm.createContext({filas, aviso:()=>{throw new Error('Error en vista previa')}, pintarPrevia:()=>{}});
  vm.runInContext(src+'\nanalizarFilas(filas); resultado=IMPORTACION;',ctx);
  return ctx.resultado;
}

test('Excel con Número y Nombre acepta 114 filas y omite asignaciones ausentes', () => {
  const filas=[['Número','Nombre'],...Array.from({length:114},(_,i)=>[String(4000+i),'Persona de prueba '+i])];
  const resultado=vistaImportacion(filas);
  assert.equal(resultado.length,114);
  assert.equal(resultado.filter(x=>x.problemas.length).length,0);
  assert.ok(resultado.every(x=>x.telefono===''&&x.zona_default===undefined&&x.turno_default===undefined));
});

test('Excel sigue rechazando números repetidos y teléfonos capturados incorrectamente', () => {
  const resultado=vistaImportacion([['Número','Nombre','Teléfono'],['1','Uno',''],['1','Otro','123']]);
  assert.equal(resultado[0].problemas.length,0);
  assert.ok(resultado[1].problemas.includes('número repetido en el archivo'));
  assert.ok(resultado[1].problemas.includes('teléfono de 3 dígitos'));
});

test('claves seguras funcionan en botones y no se muestran como teléfonos', () => {
  const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
  const src=html.slice(html.indexOf('  const esClaveInterna ='),html.indexOf('  function escaparHtml('));
  const ctx=vm.createContext({});vm.runInContext(src,ctx);
  assert.equal(vm.runInContext("telParaAtributo('emp_30303132')",ctx),'emp_30303132');
  assert.equal(vm.runInContext("telefonoVisible('emp_30303132')",ctx),'');
  assert.equal(vm.runInContext('telParaAtributo("bad\' onclick=bad")',ctx),'');
});

test('WhatsApp rechaza una clave interna antes de realizar cualquier petición', async () => {
  const { enviarTexto }=await import('../services/whatsapp.js');
  await assert.rejects(enviarTexto('emp_30303132','No se envía'),/no tiene teléfono/);
});
