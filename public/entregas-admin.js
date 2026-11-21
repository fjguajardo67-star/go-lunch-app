// Recuperación administrativa desde Dashboard; cada comida conserva su identidad.
(() => {
  const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clave = fila => fila.tipo + ':' + fila.id;
  function filtrar(items, filtros) {
    return items.filter(f => (!filtros.turno || f.turno === filtros.turno) &&
      (!filtros.zona || f.zona === filtros.zona) && (!filtros.tipo || f.tipo === filtros.tipo));
  }

  function montar({dialogo, api, puedeRegistrar, alActualizar, uuid = () => globalThis.crypto.randomUUID()}) {
    const $ = id => dialogo.querySelector('#ea-' + id);
    const form = dialogo.querySelector('form');
    const campos = $('campos'), lista = $('lista'), error = $('error'), enviar = $('enviar');
    const turno = $('turno'), zona = $('zona'), tipo = $('tipo'), todas = $('todas');
    let items = [], seleccion = new Set(), fecha = '', consulta = 0, enviando = false, intento = null, conflicto = false;
    const filtros = () => ({turno:turno.value,zona:zona.value,tipo:tipo.value});
    const visibles = () => filtrar(items,filtros());
    const seleccionadas = () => items.filter(f => seleccion.has(clave(f)));

    function contar() {
      const filas=visibles(), cantidad=seleccionadas().length;
      $('seleccion').textContent = cantidad + ' seleccionadas de ' + filas.length + ' visibles';
      enviar.textContent = cantidad === 1 ? 'Reportar 1 como entregada' : 'Reportar ' + cantidad + ' como entregadas';
      enviar.disabled = enviando || conflicto || !cantidad;
      todas.checked = filas.length > 0 && filas.every(f=>seleccion.has(clave(f)));
      todas.indeterminate = cantidad > 0 && !todas.checked;
      todas.disabled = !filas.length;
    }

    function pintar() {
      const filas=visibles();
      lista.innerHTML = filas.map((f,i) => {
        const servicio=f.tipo==='cobertura'?'Cobertura':'Regular';
        const lugar=f.zona==='zona_refris'?'REFIS':'ASLA';
        return '<div class="ea-comida"><input type="checkbox" id="ea-comida-' + i + '" data-clave="' + escapar(clave(f)) + '"' +
          (seleccion.has(clave(f))?' checked':'') + '><label for="ea-comida-' + i + '"><strong>' + escapar(f.nombre) + ' · N.º ' +
          escapar(f.numero_empleado) + '</strong><span>' + escapar(f.platillo) + '</span><small>' + servicio +
          (f.folio?' · '+escapar(f.folio):'') + ' · ' + lugar + ' · ' + (f.turno==='turno_a'?'Turno A':'Turno B') + ' · ' +
          escapar(f.horario) + '</small></label></div>';
      }).join('');
      $('vacio').hidden = filas.length > 0;
      $('vacio').textContent = items.length ? 'No hay comidas pendientes con estos filtros.' : 'No hay entregas omitidas disponibles para esta fecha.';
      contar();
    }

    for (const control of [turno,zona,tipo]) control.addEventListener('change',()=>{
      seleccion.clear(); $('confirmado').checked=false; intento=null; pintar();
    });
    todas.addEventListener('change',()=>{
      seleccion=new Set(todas.checked?visibles().map(clave):[]);
      $('confirmado').checked=false; intento=null; pintar();
    });
    lista.addEventListener('change',e=>{
      const valor=e.target.dataset.clave; if(!valor)return;
      if(e.target.checked)seleccion.add(valor);else seleccion.delete(valor);
      $('confirmado').checked=false; intento=null; contar();
    });
    $('cancelar').addEventListener('click',()=>dialogo.close());
    dialogo.addEventListener('close',()=>{ consulta++; dialogo.returnValue=''; });
    $('reintentar').addEventListener('click',()=>cargar(fecha));

    async function cargar(dia) {
      const turnoConsulta=++consulta;
      campos.disabled=true; error.textContent=''; lista.textContent='';
      $('estado').textContent='Consultando comidas pendientes…'; $('reintentar').hidden=true; $('vacio').hidden=true;
      try {
        const datos=await api('/api/entregas-admin/'+dia);
        if(turnoConsulta!==consulta || !dialogo.open)return;
        items=datos.items || []; seleccion.clear(); conflicto=false;
        $('estado').textContent=items.length + ' comidas disponibles para registrar.' +
          (datos.futuras ? ' Otras '+datos.futuras+' aún no llegan a su hora de entrega.' : '') +
          (datos.sin_horario ? ' Hay '+datos.sin_horario+' sin horario definido; revisa esos pedidos.' : '');
        campos.disabled=false; pintar();
      } catch(err) {
        if(turnoConsulta!==consulta || !dialogo.open)return;
        $('estado').textContent='No se pudo consultar la lista.'; error.textContent=err.message;
        $('reintentar').hidden=false;
      }
    }

    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(enviando || conflicto || !puedeRegistrar() || !seleccion.size || !$('confirmado').checked || !form.reportValidity())return;
      const motivo=$('motivo').value.trim().replace(/\s+/g,' ');
      if(motivo.length<10){error.textContent='Describe el motivo con al menos 10 caracteres.'; $('motivo').focus();return;}
      const filas=seleccionadas().map(({tipo,id,version})=>({tipo,id,version}));
      const firma=JSON.stringify({fecha,items:filas,motivo});
      if(!intento || intento.firma!==firma)intento={firma,datos:{fecha,items:filas,motivo,confirmado:true,idempotencia:uuid()}};
      enviando=true; campos.disabled=true; enviar.disabled=true; error.textContent='';
      $('estado').textContent='Registrando las entregas seleccionadas…';
      let resultado;
      try {
        resultado=await api('/api/entregas-admin',{method:'POST',body:JSON.stringify(intento.datos)});
      } catch(err) {
        error.textContent=err.message;
        $('estado').textContent='No se confirmó el resultado. Puedes reintentar el mismo registro.';
        if(err.status===409){conflicto=true; $('estado').textContent='La lista cambió. Vuelve a consultar antes de registrar.'; $('reintentar').hidden=false;}
      } finally {
        enviando=false; campos.disabled=false; contar();
      }
      if(resultado){
        dialogo.close(); intento=null;
        await alActualizar(resultado);
      }
    });

    return { async abrir(dia) {
      if(!puedeRegistrar() || enviando)return;
      fecha=dia; items=[]; seleccion.clear(); intento=null; conflicto=false;
      form.reset(); contar(); $('error').textContent='';
      $('fecha').textContent='Servicio: '+dia.split('-').reverse().join('/');
      dialogo.showModal();
      await cargar(dia);
    } };
  }
  globalThis.GoLunchEntregasAdmin=Object.freeze({filtrar,montar});
})();
