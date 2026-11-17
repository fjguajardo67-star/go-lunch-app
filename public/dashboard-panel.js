// Dos unidades distintas: una fila por comida y una fila por empleado activo.
(() => {
  const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ESTADOS = { pendiente:'Por entregar', entregado:'Entregada', tardia:'Entregada · Tardía', no_surtido:'No surtida · Sin cargo' };
  const esComida = fila => fila.tipo === 'regular' || fila.tipo === 'cobertura';

  function comidasVisibles(filas, filtro = 'todas') {
    // El índice es el de la respuesta completa, incluso después de filtrar.
    return filas.map((fila,indice) => ({fila,indice})).filter(({fila}) => esComida(fila) &&
      (filtro === 'todas' || (filtro === 'entregadas' ? ['entregado','tardia'].includes(fila.estado) : fila.estado === filtro)));
  }
  function personasVisibles(personas, filtro = 'sin_pedido', ingreso = 'todos') {
    return personas.filter(p => (filtro === 'todos' || (filtro === 'con_pedido' ? p.comidas > 0 : !p.comidas)) &&
      (filtro !== 'sin_pedido' || ingreso === 'todos' || p.ingreso === ingreso));
  }

  function montar({raiz, hora, registro = hora, horario, zona, motivo, puedeIncidencia, alIncidencia}) {
    let datos = null, vista = 'comidas', filtroComida = 'todas', filtroPersona = 'sin_pedido', filtroIngreso = 'todos';
    const focoNativo = Object.hasOwn(HTMLElement.prototype, 'focusGroup');
    const opcionesComidas = [['todas','Todas'],['pendiente','Por entregar'],['entregadas','Entregadas'],['no_surtido','No surtidas · Sin cargo']];
    const opcionesPersonas = [['todos','Activos'],['con_pedido','Con pedido'],['sin_pedido','Sin pedido']];
    const opcionesIngresos = [['todos','Todos sin pedido'],['registrado','Ingresaron'],['sin_registro','Sin ingreso registrado']];
    const meta = texto => '<span class="dash-meta">' + escapar(texto) + '</span>';
    const celda = (etiqueta, html) => '<td role="cell" data-label="' + escapar(etiqueta) + '"><div class="dash-celda-valor">' + html + '</div></td>';
    const tituloPersona = p => escapar(p.nombre) + meta('#' + (p.numero_empleado || '—'));
    function selector(opciones, actual, cantidades, grupo, desactivadas = []) {
      return '<div class="dash-filtros" role="group" aria-label="' + ({comida:'Estado de las comidas',persona:'Situación de los empleados',ingreso:'Ingresos de empleados sin pedido'}[grupo]) + '">' +
        opciones.map(([valor,nombre]) => '<button type="button" id="dash-' + grupo + '-' + valor + '" data-' + grupo + '="' + valor +
          '" aria-pressed="' + (valor === actual) + '"' + (desactivadas.includes(valor) ? ' disabled' : '') + '><span>' + nombre + '</span><strong>' +
          (cantidades[valor] ?? '—') + '</strong></button>').join('') + '</div>';
    }
    function tabla(id, nombre, columnas, cuerpo, vacio) {
      if (!cuerpo) return '<p class="dash-vacio" role="status">' + vacio + '</p>';
      return '<div class="dash-tabla" id="' + id + '-region" tabindex="0" role="region" aria-label="' + nombre + '"><table role="table"><caption id="' + id + '">' + nombre + '</caption><thead role="rowgroup"><tr role="row">' +
        columnas.map(c => '<th scope="col" role="columnheader">' + c + '</th>').join('') + '</tr></thead><tbody role="rowgroup">' + cuerpo + '</tbody></table></div>';
    }
    function renderComidas() {
      const r = datos.resumen;
      const elegidas = comidasVisibles(datos.filas || [], filtroComida);
      let html = '<div class="dash-total"><strong>' + r.total_comidas + '</strong><div><h4>Comidas solicitadas</h4><p>' + r.regulares + ' regulares + ' + r.coberturas + ' coberturas</p></div></div>';
      html += selector(opcionesComidas, filtroComida, {todas:r.total_comidas,pendiente:r.pendientes,entregadas:r.entregados,no_surtido:r.no_surtidos || 0}, 'comida');
      html += '<p class="dash-nota">Entregadas + por entregar + no surtidas = total solicitado. Las no surtidas quedan sin cargo al empleado.</p>';
      if (r.tardias) html += '<p class="dash-nota">' + r.tardias + (r.tardias === 1 ? ' entrega tardía, incluida' : ' entregas tardías, incluidas') + ' en Entregadas.</p>';
      html += '<h4 class="dash-listado-titulo" id="dash-lista-comidas">' + opcionesComidas.find(o=>o[0]===filtroComida)[1] + ' · ' + elegidas.length + (elegidas.length === 1 ? ' comida' : ' comidas') + '</h4>';
      const filas = elegidas.map(({fila:f,indice}) => {
        const servicio = f.tipo === 'cobertura' ? (f.origen === 'extraordinaria' ? 'Cobertura extraordinaria' : 'Cobertura') : 'Regular';
        let estado = escapar(ESTADOS[f.estado] || 'Sin estado');
        if (f.entrega_conciliada_en && !f.no_surtido_en) estado += meta('Confirmación administrativa') + meta('Confirmó: ' + f.entrega_conciliada_por + ' · ' + registro(f.entrega_conciliada_en)) + meta(f.entrega_conciliacion_motivo);
        if (f.no_surtido_en) estado += meta(f.no_surtido_motivo) + meta('Registró: ' + f.no_surtido_por + ' · ' + registro(f.no_surtido_en));
        else if (f.id && puedeIncidencia(datos.fecha)) estado += '<button class="dash-incidencia" id="dash-incidencia-' + indice + '" type="button" data-incidencia="' + indice + '">Registrar no surtido</button>';
        if (f.estado === 'tardia') estado += meta(f.motivo_tardia ? motivo(f.motivo_tardia) : 'Sin motivo registrado');
        return '<tr role="row" data-estado="' + escapar(f.estado) + '"><th scope="row" role="rowheader">' + tituloPersona(f) + '</th>' +
          celda('Platillo',escapar(f.platillo)) + celda('Servicio',servicio + (f.folio ? meta(f.folio) : '')) +
          celda('Zona y horario',escapar(zona(f.zona)) + meta(horario(f,datos.fecha))) +
          celda('Hora de entrega',f.no_surtido_en ? '—' + (f.entregado_en ? meta('Marca previa rectificada: ' + hora(f.entregado_en)) : '') : f.entrega_conciliada_en && !f.entregado_en ? 'Sin hora registrada' : escapar(hora(f.entregado_en))) +
          celda('Estado',estado) + '</tr>';
      }).join('');
      return html + tabla('dash-caption-comidas','Detalle de comidas',['Empleado','Platillo','Servicio','Zona y horario','Hora de entrega','Estado'],filas,
        r.total_comidas ? 'No hay comidas en este grupo para la fecha consultada.' : 'No hay comidas registradas para esta fecha. Consulta Empleados para revisar quiénes siguen sin pedido.');
    }
    function renderPersonas() {
      const r = datos.resumen;
      let html = '<p class="dash-nota">Cada empleado activo se cuenta una sola vez, aunque tenga pedido regular y cobertura.</p>';
      html += selector(opcionesPersonas, filtroPersona, {todos:r.activos,con_pedido:r.ordenaron,sin_pedido:r.no_ordenaron}, 'persona');
      html += '<p class="dash-nota">Con pedido + sin pedido = ' + r.activos + ' empleados activos.</p>';
      const accesoOk = r.accesos_ok !== false;
      if (filtroPersona === 'sin_pedido') {
        html += '<section class="dash-desglose" aria-labelledby="dash-desglose-titulo"><h4 id="dash-desglose-titulo">Dentro de Sin pedido · ' + r.no_ordenaron + '</h4>';
        html += selector(opcionesIngresos, filtroIngreso, {todos:r.no_ordenaron,registrado:accesoOk ? r.vieron_no_ordenaron : null,sin_registro:accesoOk ? r.no_abrieron : null}, 'ingreso', accesoOk ? [] : ['registrado','sin_registro']);
        html += '<p class="dash-nota">' + (accesoOk
          ? 'Ingresaron y sin ingreso registrado forman parte de Sin pedido. El registro corresponde a la fecha de servicio consultada.'
          : 'No se pudo consultar el registro de ingresos. El total sin pedido sigue siendo válido; no podemos clasificar quién ingresó.') + '</p></section>';
      } else if (!accesoOk) html += '<p class="dash-aviso" role="status">Registro de ingresos no disponible. Los pedidos y las entregas sí están disponibles.</p>';
      if (!Array.isArray(datos.personas)) return html + '<p class="dash-aviso" role="status">Vuelve a consultar para cargar el detalle de empleados.</p>';
      const elegidas = personasVisibles(datos.personas, filtroPersona, filtroIngreso);
      const grupoIngreso = filtroPersona === 'sin_pedido' && filtroIngreso !== 'todos' ? ' · ' + opcionesIngresos.find(o=>o[0]===filtroIngreso)[1] : '';
      html += '<h4 class="dash-listado-titulo">' + opcionesPersonas.find(o=>o[0]===filtroPersona)[1] + grupoIngreso + ' · ' + elegidas.length + (elegidas.length === 1 ? ' persona' : ' personas') + '</h4>';
      const filas = elegidas.map(p => '<tr role="row"><th scope="row" role="rowheader">' + tituloPersona(p) + '</th>' +
        celda('Situación',p.comidas ? 'Con pedido' : 'Sin pedido') +
        celda('Ingreso para esta fecha',p.ingreso === 'registrado' ? 'Ingreso registrado' + (p.visto_en ? meta(hora(p.visto_en)) : '') : p.ingreso === 'sin_dato' ? 'Sin dato disponible' : 'Sin ingreso registrado') +
        celda('Comidas solicitadas',String(p.comidas)) + '</tr>').join('');
      return html + tabla('dash-caption-personas','Detalle de empleados activos',['Empleado','Situación','Ingreso para esta fecha','Comidas solicitadas'],filas,
        'No hay empleados en este grupo para la fecha consultada.');
    }
    const posiciones = new Map();
    function render() {
      if (!datos) return;
      const foco = raiz.contains(document.activeElement) ? document.activeElement.id : null;
      const desplazamiento = raiz.querySelector('[role="tabpanel"]:not([hidden]) .dash-tabla');
      if (desplazamiento) posiciones.set(desplazamiento.id,{top:desplazamiento.scrollTop,left:desplazamiento.scrollLeft});
      raiz.innerHTML = '<div class="dash-vistas" role="tablist" focusgroup="tablist nomemory" aria-label="Vistas del dashboard">' +
        [['comidas','Comidas y entregas'],['personas','Empleados']].map(([id,nombre]) => '<button type="button" role="tab" id="dash-tab-' + id + '" data-vista="' + id + '" aria-selected="' + (vista === id) + '"' + (focoNativo ? '' : ' tabindex="' + (vista === id ? '0' : '-1') + '"') + (vista === id ? ' focusgroupstart' : '') + '>' + nombre + '</button>').join('') + '</div>' +
        '<section id="dash-panel-comidas" role="tabpanel" aria-labelledby="dash-tab-comidas"' + (vista === 'comidas' ? '' : ' hidden') + '><div class="dash-contenido">' + renderComidas() + '</div></section>' +
        '<section id="dash-panel-personas" role="tabpanel" aria-labelledby="dash-tab-personas"' + (vista === 'personas' ? '' : ' hidden') + '><div class="dash-contenido">' + renderPersonas() + '</div></section>' +
        '<p class="dash-frescura">' + (datos.enVivo ? 'Se actualiza cada 30 s' : 'Consulta de la fecha seleccionada') + ' · actualizado <span id="dashDesde">hace un momento</span></p>';
      const tabla = raiz.querySelector('[role="tabpanel"]:not([hidden]) .dash-tabla');
      const scroll = tabla && posiciones.get(tabla.id);
      if (scroll) { tabla.scrollTop=scroll.top; tabla.scrollLeft=scroll.left; }
      if (foco) raiz.querySelector('#' + foco)?.focus({preventScroll:true});
    }
    function cambiarVista(valor) {
      if (vista === valor) return;
      vista=valor; render();
      raiz.querySelector('#dash-tab-' + vista)?.focus({preventScroll:true});
    }
    raiz.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !raiz.contains(b) || b.disabled) return;
      if (b.dataset.vista) { cambiarVista(b.dataset.vista); return; }
      if (b.dataset.incidencia !== undefined) { alIncidencia(Number(b.dataset.incidencia)); return; }
      if (b.dataset.comida) filtroComida=b.dataset.comida;
      if (b.dataset.persona) { filtroPersona=b.dataset.persona; filtroIngreso='todos'; }
      if (b.dataset.ingreso) filtroIngreso=b.dataset.ingreso;
      render();
    });
    // focusgroup mueve el foco de forma nativa; la selección debe seguirlo.
    raiz.addEventListener('focusin', e => {
      const tab=e.target.closest('[role="tab"]');
      if (tab && tab.dataset.vista !== vista) cambiarVista(tab.dataset.vista);
    });
    raiz.addEventListener('keydown', e => {
      const tab=e.target.closest('[role="tab"]'); if (!tab) return;
      if (focoNativo) return;
      const siguiente = {ArrowRight:vista==='comidas'?'personas':'comidas',ArrowLeft:vista==='comidas'?'personas':'comidas',Home:'comidas',End:'personas'}[e.key];
      if (siguiente) { e.preventDefault(); cambiarVista(siguiente); }
    });
    return { actualizar(nuevos) {
      datos=nuevos;
      if (datos.resumen.accesos_ok === false) filtroIngreso='todos';
      render();
    } };
  }
  globalThis.GoLunchDashboard = Object.freeze({ comidasVisibles, personasVisibles, montar });
})();
