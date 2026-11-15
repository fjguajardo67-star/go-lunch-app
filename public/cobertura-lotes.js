// La sesión de supervisor conserva su alcance; cada pedido es un folio propio.
const LS = 'golunch_cobertura_sesion';
const $ = id => document.getElementById(id);
const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hora = iso => iso ? new Intl.DateTimeFormat('es-MX', { timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).format(new Date(iso)) : 'Por confirmar';
let SESION = null, ESTADO = null, MENU_EDITOR = null, FILAS = [], RESPONSABLE = null, EDITANDO = null, INTENTO = null, DESFASE = 0, OCUPADO = false;
try { SESION = JSON.parse(localStorage.getItem(LS) || 'null'); } catch {}
const auth = () => ({ Authorization:'Bearer ' + SESION?.token, 'Content-Type':'application/json' });
function aviso(id, texto) { $(id).textContent = texto; $(id).classList.toggle('oculto', !texto); }
async function pedir(ruta, opciones = {}) {
  const r = await fetch('/cobertura' + ruta, { ...opciones, headers:auth(), cache:'no-store' });
  const d = await r.json();
  if (r.status === 401) { salir(false); aviso('login-error',d.error || 'Vuelve a iniciar sesión.'); throw new Error(d.error || 'Vuelve a iniciar sesión.'); }
  if (!r.ok) throw new Error((d.error || 'No se pudo completar la solicitud.') + (d.detalle ? ' ' + d.detalle : ''));
  return d;
}
async function entrar() {
  $('btn-login').disabled = true; aviso('login-error','');
  try {
    const r = await fetch('/cobertura/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({numero_empleado:$('numero').value.trim(),clave:$('clave').value}) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'No se pudo entrar.');
    SESION = d; localStorage.setItem(LS,JSON.stringify(d)); $('clave').value = ''; await cargar();
  } catch (e) { aviso('login-error',e.message); } finally { $('btn-login').disabled = false; }
}
async function cargar() {
  if (OCUPADO) return false;
  try {
    const d = await pedir('/lotes'); ESTADO = d; DESFASE = new Date(d.ahora).getTime() - Date.now();
    $('login').classList.add('oculto'); $('contenido').classList.remove('oculto');
    $('supervisor-nombre').textContent = d.supervisor.nombre; $('supervisor-numero').textContent = '#' + d.supervisor.numero_empleado + ' · Supervisor autorizado';
    $('historial-fecha').textContent = 'Servicio ' + d.fecha.split('-').reverse().join('/') + ' · Hora local del comedor';
    $('btn-nuevo').disabled = !d.abierto;
    $('estado-cerrado').classList.toggle('oculto', d.abierto);
    $('cerrado-titulo').textContent = d.motivo === 'sin_menu_especial' ? 'Menú especial pendiente' : 'Sin horario disponible hoy';
    $('cerrado-texto').textContent = d.motivo === 'sin_menu_especial' ? 'CICSA todavía no publica las opciones de hoy. Tus folios anteriores siguen disponibles.' : 'Ya no hay dos horas disponibles antes de terminar hoy. Tus pedidos confirmados siguen vigentes.';
    pintarPedidos(); actualizarReloj(); return true;
  } catch (e) {
    aviso(SESION ? 'pedidos-aviso' : 'login-error','No se pudo actualizar. ' + e.message + ' La última consulta no confirma cambios nuevos.'); return false;
  }
}
function pintarPedidos() {
  $('pedidos-lista').innerHTML = ESTADO.solicitudes.length ? ESTADO.solicitudes.map(s => {
    const estado = s.estado === 'cancelada' ? 'Cancelado' : s.estado === 'entregada' ? 'Entregado' : 'Confirmado';
    return '<article class="pedido"><h3>' + escapar(s.folio) + ' · ' + estado + '</h3><p><b>' + (s.turno === 'turno_a' ? 'Turno A' : 'Turno B y extras') + ' · ' + escapar(GoLunchOperacion.ZONAS[s.zona]) + ' · ' + hora(s.entrega_programada_en) + '</b></p><p>' + s.total_porciones + ' alimento(s) · Recibe ' + escapar(s.responsable_nombre_snapshot) + ' #' + escapar(s.responsable_numero_snapshot) + '</p>' +
      (s.estado === 'confirmada' ? '<small>' + (s.editable ? 'Cambios y cancelación hasta las ' : 'Cambios cerrados a las ') + hora(s.limite_cambios_en) + '.</small>' : '') +
      '<details><summary>Ver empleados y platillos</summary><ul>' + s.items.map(i => '<li>#' + escapar(i.empleado_numero_snapshot) + ' · ' + escapar(i.empleado_nombre_snapshot) + ' — ' + escapar(i.opcion_texto) + (i.no_surtido_en ? ' · No surtido · Sin cargo al empleado' : '') + '</li>').join('') + '</ul></details>' +
      (s.editable ? '<div class="pedido-acciones" data-limite="' + escapar(s.limite_cambios_en) + '"><button class="btn sec" onclick="editarSolicitud(' + s.id + ')">Modificar</button><button class="btn sec danger" onclick="cancelarSolicitud(' + s.id + ')">Cancelar pedido</button></div>' : '') + '</article>';
  }).join('') : '<p>No has registrado pedidos para hoy.</p>';
}
function descartarEditor() {
  return $('editor').classList.contains('oculto') || (!FILAS.some(f => f.numero || f.opcion_id) && !$('zona').value && !$('hora-entrega-input').value) || confirm('¿Volver sin guardar los cambios de este pedido?');
}
function abrirNuevo() {
  if (OCUPADO || !ESTADO?.abierto || !descartarEditor()) return;
  EDITANDO = null; INTENTO = crypto.randomUUID(); FILAS = [{ numero:'',nombre:'',opcion_id:'' }];
  MENU_EDITOR = structuredClone(ESTADO.menu);
  RESPONSABLE = {numero:ESTADO.supervisor.numero_empleado,nombre:ESTADO.supervisor.nombre};
  $('responsable').value = RESPONSABLE.numero; $('responsable-nombre').textContent = RESPONSABLE.nombre;
  $('zona').value = ''; $('turno-servicio').value = 'turno_b'; $('hora-entrega-input').value = '';
  mostrarEditor();
}
function editarSolicitud(id) {
  const s = ESTADO.solicitudes.find(s => s.id === id);
  if (OCUPADO || !s?.editable || !descartarEditor()) return;
  if (!s.menu && !ESTADO.menu) { aviso('pedidos-aviso','El menú de este folio no está disponible. Actualiza tus pedidos.'); return; }
  MENU_EDITOR = structuredClone(s.menu || ESTADO.menu);
  EDITANDO = s; INTENTO = s.idempotencia || crypto.randomUUID();
  FILAS = s.items.map(i => ({numero:i.empleado_numero_snapshot,nombre:i.empleado_nombre_snapshot,opcion_id:i.opcion_id}));
  RESPONSABLE = {numero:s.responsable_numero_snapshot,nombre:s.responsable_nombre_snapshot};
  $('responsable').value = RESPONSABLE.numero; $('responsable-nombre').textContent = RESPONSABLE.nombre;
  $('zona').value = s.zona; $('turno-servicio').value = s.turno; $('hora-entrega-input').value = hora(s.entrega_programada_en);
  mostrarEditor();
}
function mostrarEditor() {
  $('editor').classList.remove('oculto'); $('historial').classList.add('oculto');
  $('editor-titulo').textContent = EDITANDO ? 'Modificar ' + EDITANDO.folio : 'Nuevo pedido de hoy.';
  $('btn-guardar').textContent = EDITANDO ? 'Guardar cambios de este folio' : 'Confirmar pedido';
  aviso('solicitud-error','');
  $('menu-opciones').innerHTML = MENU_EDITOR.opciones.map((o,i) => '<div class="menu-option"><i>' + (i+1) + '</i><b>' + escapar(o.texto) + '</b></div>').join('');
  $('menu-contexto').textContent=EDITANDO ? 'Este folio conserva su menú original.' : 'Menú vigente para pedidos nuevos de hoy.';
  $('menu-opciones').setAttribute('aria-label', EDITANDO ? 'Menú original de este folio' : 'Menú vigente para pedidos nuevos');
  pintarFilas(); actualizarHorario(); actualizarTotal(); $('turno-servicio').focus();
}
function cerrarEditor() {
  if (OCUPADO || !descartarEditor()) return;
  $('editor').classList.add('oculto'); $('historial').classList.remove('oculto'); EDITANDO = null; FILAS = [];
}
function actualizarHorario() {
  const texto = ($('turno-servicio').value === 'turno_a' ? 'Turno A' : 'Turno B y extras') + ' · ' + (GoLunchOperacion.ZONAS[$('zona').value] || 'Selecciona zona') + ' · ' + ($('hora-entrega-input').value || 'Selecciona horario');
  $('fecha-servicio').textContent = texto; $('hora-entrega').textContent = $('hora-entrega-input').value || 'Selecciona horario'; actualizarReloj();
}
function actualizarReloj() {
  if (!ESTADO) return;
  const ahora = Date.now() + DESFASE;
  const minima = new Date(Math.ceil((ahora + 120*60000) / 60000) * 60000);
  const fecha = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(minima);
  $('btn-nuevo').disabled = !ESTADO.menu || fecha !== ESTADO.fecha;
  $('hora-ayuda').textContent = 'Ejemplo: 17:30 = 5:30 p. m. ' + (fecha === ESTADO.fecha ? 'Hora mínima de entrega: ' + hora(minima.toISOString()) + '. ' : 'Ya no hay ventana de dos horas para hoy. ') + 'Hora local del comedor.';
  $('cuenta-regresiva').textContent = EDITANDO ? 'Cambios hasta las ' + hora(EDITANDO.limite_cambios_en) : 'Anticipación mínima: 2 horas';
  document.querySelectorAll('.pedido-acciones[data-limite]').forEach(grupo => grupo.querySelectorAll('button').forEach(b => { b.disabled = OCUPADO || ahora > new Date(grupo.dataset.limite).getTime(); }));
}
function agregarPersona() { FILAS.push({numero:'',nombre:'',opcion_id:''}); pintarFilas(); actualizarTotal(); $('persona-num-' + (FILAS.length-1)).focus(); }
function quitarPersona(i) { if (FILAS.length === 1) FILAS = [{numero:'',nombre:'',opcion_id:''}]; else FILAS.splice(i,1); pintarFilas(); actualizarTotal(); }
function cambiarNumero(i,v) { FILAS[i].numero = v.trim(); FILAS[i].nombre = ''; FILAS[i].error = ''; }
function pintarFilas() {
  $('personas').innerHTML = FILAS.map((f,i) => '<div class="persona"><div class="persona-top"><input id="persona-num-' + i + '" value="' + escapar(f.numero) + '" inputmode="numeric" placeholder="Número de empleado" oninput="cambiarNumero(' + i + ',this.value)" onblur="buscarPersona(' + i + ')" aria-label="Número de empleado ' + (i+1) + '"><button class="persona-remove" type="button" onclick="quitarPersona(' + i + ')" aria-label="Quitar empleado">×</button></div><div id="persona-nombre-' + i + '" class="persona-nombre">' + escapar(f.error || f.nombre) + '</div><label for="persona-op-' + i + '">Platillo</label><select id="persona-op-' + i + '" onchange="FILAS[' + i + '].opcion_id=this.value;actualizarTotal()"><option value="">Seleccionar opción</option>' + MENU_EDITOR.opciones.map(o => '<option value="' + o.id + '" ' + (f.opcion_id === o.id ? 'selected' : '') + '>' + escapar(o.texto) + '</option>').join('') + '</select></div>').join('');
}
async function buscarPersona(i) {
  const f = FILAS[i]; if (!f?.numero) return;
  const numero = f.numero;
  try { const d = await pedir('/empleado/' + encodeURIComponent(numero)); if (f.numero !== numero) return; f.nombre = d.empleado.nombre; f.numero = d.empleado.numero_empleado; f.error = ''; }
  catch (e) { if (f.numero !== numero) return; f.nombre = ''; f.error = e.message; }
  const actual = FILAS.indexOf(f), el = actual >= 0 ? $('persona-nombre-' + actual) : null;
  if (el) { el.textContent = f.error || f.nombre; el.classList.toggle('error-text',!!f.error); }
}
async function buscarResponsable() {
  const numero = $('responsable').value.trim(); RESPONSABLE = null;
  if (!numero) { $('responsable-nombre').textContent = ''; return; }
  try { const d = await pedir('/empleado/' + encodeURIComponent(numero)); if ($('responsable').value.trim() !== numero) return; RESPONSABLE = {numero:d.empleado.numero_empleado,nombre:d.empleado.nombre}; $('responsable-nombre').textContent = RESPONSABLE.nombre; }
  catch (e) { if ($('responsable').value.trim() === numero) $('responsable-nombre').textContent = e.message; }
}
function actualizarTotal() { $('total').textContent = FILAS.filter(f => f.numero && f.opcion_id).length + ' alimentos'; }
async function guardarSolicitud() {
  if (OCUPADO) return; OCUPADO = true; aviso('solicitud-error','');
  const controles = [...document.querySelectorAll('#editor input,#editor select,#editor button')]; controles.forEach(e => { e.disabled = true; });
  try {
    await buscarResponsable(); for (let i=0;i<FILAS.length;i++) if (FILAS[i].numero && !FILAS[i].nombre) await buscarPersona(i);
    const items = FILAS.filter(f => f.numero || f.opcion_id);
    if (!RESPONSABLE) throw new Error('Verifica el número del responsable.');
    if (!$('zona').value) throw new Error('Selecciona la zona de entrega.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test($('hora-entrega-input').value)) { $('hora-entrega-input').setAttribute('aria-invalid','true'); throw new Error('Escribe una hora completa de 24 horas, por ejemplo 17:30.'); }
    $('hora-entrega-input').removeAttribute('aria-invalid');
    if (!items.length || items.some(f => !f.numero || !f.nombre || !f.opcion_id)) throw new Error('Completa y verifica cada empleado y su platillo.');
    if (new Set(items.map(f => f.numero)).size !== items.length) throw new Error('Un empleado aparece más de una vez en este pedido.');
    const respuesta = await pedir('/lotes' + (EDITANDO ? '/' + EDITANDO.id : ''), { method:EDITANDO ? 'PUT' : 'POST', body:JSON.stringify({
      fecha:ESTADO.fecha, turno:$('turno-servicio').value, zona:$('zona').value, hora_entrega:$('hora-entrega-input').value, menu_version:MENU_EDITOR?.version || null,
      responsable_numero:RESPONSABLE.numero, items:items.map(f => ({numero_empleado:f.numero,opcion_id:f.opcion_id})), idempotencia:INTENTO, version:EDITANDO?.actualizado_en || null
    }) });
    $('editor').classList.add('oculto'); $('historial').classList.remove('oculto'); EDITANDO = null; FILAS = []; INTENTO = null;
    aviso('pedidos-aviso','Pedido confirmado: ' + respuesta.solicitud.folio + '. Cocina ya puede consultarlo.');
    OCUPADO = false; await cargar();
  } catch (e) { aviso('solicitud-error',e.message); }
  finally { OCUPADO = false; controles.forEach(e => { e.disabled = false; }); actualizarReloj(); }
}
async function cancelarSolicitud(id) {
  const s = ESTADO.solicitudes.find(s => s.id === id);
  if (OCUPADO || !s?.editable || !confirm('¿Cancelar únicamente el pedido ' + s.folio + '?')) return;
  OCUPADO = true;
  try { await pedir('/lotes/' + id, {method:'DELETE',body:JSON.stringify({version:s.actualizado_en})}); aviso('pedidos-aviso','Pedido cancelado: ' + s.folio); OCUPADO = false; await cargar(); }
  catch (e) { aviso('pedidos-aviso',e.message); } finally { OCUPADO = false; actualizarReloj(); }
}
function salir(recargar = true) { SESION = null; localStorage.removeItem(LS); if (recargar) location.reload(); else { $('contenido').classList.add('oculto'); $('login').classList.remove('oculto'); } }
setInterval(actualizarReloj,30000);
if (SESION?.token) cargar();
if ('serviceWorker' in navigator) window.addEventListener('load',() => navigator.serviceWorker.register('/sw.js').catch(() => {}));
