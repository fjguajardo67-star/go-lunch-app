/* Programación por fecha: un error en un día no afecta los otros seis. */
window.MenuCoberturaSemanal = (() => {
  const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sumar = (fecha, dias) => {const d=new Date(fecha+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+dias);return d.toISOString().slice(0,10);};
  const lunes = fecha => {const d=new Date(fecha+'T12:00:00Z');return sumar(fecha,-((d.getUTCDay()+6)%7));};
  const formato = (fecha, opciones) => new Intl.DateTimeFormat('es-MX',{timeZone:'UTC',...opciones}).format(new Date(fecha+'T12:00:00Z'));

  function montar({raiz,api,fechaHoy,puedeEditar,alPublicar}) {
    let inicio=null,dias=[],consulta=0,publicando=false,cargando=false;
    const $ = selector => raiz.querySelector(selector);
    const pendiente = d => puedeEditar() && d.edicion.permitido && ((!d.menu?.activo && d.valores.some(v=>v.trim())) || d.valores.some((v,i) => v !== (d.menu?.['opcion_'+(i+1)] || '')));
    const tieneBorradores = () => dias.some(pendiente);
    raiz.innerHTML = '<div class="cov-semana-navegacion"><button type="button" class="accion sec" data-anterior>Semana anterior</button><div><label for="cov-semana-fecha">Semana que contiene</label><input id="cov-semana-fecha" type="date" required min="2000-01-01" max="2100-12-31"><p data-rango></p></div><button type="button" class="accion sec" data-siguiente>Semana siguiente</button><button type="button" class="accion sec" data-actualizar>Actualizar semana</button></div><p data-aviso role="status" aria-live="polite"></p><div data-dias></div>';
    function aviso(texto) {$('[data-aviso]').textContent=texto;}
    function estado(d) {
      return pendiente(d) ? 'Cambios sin publicar' : d.menu?.activo ? 'Publicado' : 'Sin menú';
    }
    function actualizarFila(d) {
      const fila=$('[data-fecha="'+d.fecha+'"]');
      fila.querySelector('[data-estado]').textContent=estado(d);
      const boton=fila.querySelector('[data-publicar]');
      boton.disabled=publicando || cargando || !puedeEditar() || !d.edicion.permitido || !pendiente(d) || d.conflicto;
      boton.textContent=d.menu?.activo ? 'Actualizar día' : 'Publicar día';
    }
    function pintar() {
      $('[data-rango]').textContent=formato(inicio,{day:'numeric',month:'long',year:'numeric'})+' — '+formato(sumar(inicio,6),{day:'numeric',month:'long',year:'numeric'});
      $('[data-dias]').innerHTML=dias.map(d => {
        const bloqueado=!puedeEditar() || !d.edicion.permitido;
        return '<section class="cov-menu-dia" data-fecha="'+d.fecha+'" aria-labelledby="cov-dia-'+d.fecha+'"><div class="cov-dia-cabecera"><h4 id="cov-dia-'+d.fecha+'">'+formato(d.fecha,{weekday:'long'})+'<span>'+formato(d.fecha,{day:'numeric',month:'short',year:'numeric'})+'</span></h4><p data-estado role="status">'+estado(d)+'</p></div><div class="cov-dia-opciones">'+d.valores.map((v,i) => '<div><label for="cov-'+d.fecha+'-'+i+'">Opción '+(i+1)+'</label><input type="text" id="cov-'+d.fecha+'-'+i+'" data-opcion="'+i+'" value="'+escapar(v)+'" '+(bloqueado?'readonly':'')+' aria-describedby="cov-nota-'+d.fecha+'"></div>').join('')+'</div><div class="cov-dia-accion"><button class="accion" type="button" data-publicar aria-label="Publicar menú del '+formato(d.fecha,{day:'numeric',month:'long',year:'numeric'})+'" disabled>Publicar día</button></div><p id="cov-nota-'+d.fecha+'" class="cov-dia-nota">'+escapar(d.edicion.motivo)+'</p><p class="cov-dia-error" data-error role="status" aria-live="polite"></p></section>';
      }).join('');
      dias.forEach(d => {
        const fila=$('[data-fecha="'+d.fecha+'"]');
        fila.querySelectorAll('[data-opcion]').forEach(input => input.addEventListener('input',() => {
          d.valores[Number(input.dataset.opcion)]=input.value; actualizarFila(d);
        }));
        fila.querySelector('[data-publicar]').addEventListener('click',() => publicar(d));
        actualizarFila(d);
      });
    }
    async function cargar(fecha=fechaHoy(), forzar=false) {
      if(publicando)return;
      const proximo=lunes(fecha);
      if(inicio===proximo && dias.length && !forzar)return;
      if(tieneBorradores() && !confirm('Hay cambios sin publicar. ¿Descartarlos y consultar la semana?')) {
        $('#cov-semana-fecha').value=inicio;return;
      }
      const turno=++consulta;
      cargando=true;dias.forEach(actualizarFila);
      aviso('Consultando la semana…');
      try {
        const r=await api('/api/cobertura/menu?inicio='+proximo,{cache:'no-store'});
        if(turno!==consulta)return;
        inicio=r.inicio;dias=r.dias.map(d => ({...d,valores:[1,2,3].map(i => d.menu?.['opcion_'+i] || ''),conflicto:false}));
        $('#cov-semana-fecha').value=inicio;pintar();aviso('Cada día se publica por separado. Los folios confirmados conservan su menú original.');
      } catch(e) {
        if(turno!==consulta)return;
        $('#cov-semana-fecha').value=inicio || fechaHoy();
        aviso('No se pudo actualizar la semana. '+e.message+' Pulsa Actualizar semana para reintentar.');
      } finally {
        if(turno===consulta) {cargando=false;dias.forEach(actualizarFila);}
      }
    }
    async function publicar(d) {
      if(publicando || cargando || !puedeEditar() || !d.edicion.permitido || !pendiente(d) || d.conflicto)return;
      const fila=$('[data-fecha="'+d.fecha+'"]');
      const opciones=d.valores.map(v => v.trim());
      if(opciones.some(v => !v) || new Set(opciones.map(v => v.toLocaleUpperCase('es-MX'))).size!==3) {
        fila.querySelector('[data-error]').textContent='Completa tres platillos distintos antes de publicar este día.';
        fila.querySelector('[data-opcion="'+Math.max(0,opciones.findIndex(v=>!v))+'"]').focus();return;
      }
      publicando=true;
      const controles=[...raiz.querySelectorAll('button,input')];
      controles.forEach(c => {c.disabled=true;});
      fila.querySelector('[data-publicar]').textContent='Publicando…';
      fila.querySelector('[data-error]').textContent='';
      try {
        const r=await api('/api/cobertura/menu/'+d.fecha,{method:'POST',body:JSON.stringify({version:d.menu?.actualizado_en || null,opcion_1:opciones[0],opcion_2:opciones[1],opcion_3:opciones[2]})});
        d.menu=r.menu;d.valores=opciones;
        d.edicion.motivo='Publicado. Las nuevas opciones aplican a pedidos nuevos; los folios anteriores conservan su menú.';
        fila.querySelector('.cov-dia-nota').textContent=d.edicion.motivo;
        fila.querySelectorAll('[data-opcion]').forEach((input,i)=>{input.value=opciones[i];});
        fila.querySelector('[data-error]').textContent='Publicado para '+formato(d.fecha,{day:'numeric',month:'long',year:'numeric'})+'. Los pedidos anteriores conservan sus platillos.';
        try {await alPublicar?.(d.fecha);} catch {aviso('El menú se publicó. Actualiza Solicitudes y producción para consultar sus pedidos.');}
      } catch(e) {
        d.conflicto=true;
        fila.querySelector('[data-error]').textContent=e.message+' Conservamos lo escrito. Consulta Actualizar semana antes de reintentar para comprobar si se publicó.';
      } finally {
        publicando=false;controles.forEach(c=>{c.disabled=false;});dias.forEach(actualizarFila);
      }
    }
    $('[data-anterior]').addEventListener('click',()=>cargar(sumar(inicio || lunes(fechaHoy()),-7)));
    $('[data-siguiente]').addEventListener('click',()=>cargar(sumar(inicio || lunes(fechaHoy()),7)));
    $('[data-actualizar]').addEventListener('click',()=>cargar(inicio || fechaHoy(),true));
    $('#cov-semana-fecha').addEventListener('change',e=>{if(e.target.reportValidity())cargar(e.target.value);});
    return {cargar};
  }
  return {montar,lunes,sumar};
})();
