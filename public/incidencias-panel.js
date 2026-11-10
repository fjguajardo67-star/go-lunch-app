(function (raiz) {
  let dialogo;
  raiz.GoLunchIncidencias = { abrir(fila, fecha, api, actualizar) {
    if (!dialogo) {
      dialogo = document.createElement('dialog');
      dialogo.className = 'incidencia-dialog';
      dialogo.setAttribute('aria-labelledby', 'incidencia-titulo');
      dialogo.innerHTML = '<h2 id="incidencia-titulo">Registrar comida no surtida</h2>' +
        '<p id="incidencia-comida"></p><p>Esta comida quedará sin cargo al empleado y se excluirá de las entregas. El pedido y sus marcas previas se conservarán en el historial.</p>' +
        '<p id="incidencia-previa"></p><form><fieldset><label for="incidencia-motivo">Motivo de cocina o reparto</label>' +
        '<input id="incidencia-motivo" type="text" required minlength="5" maxlength="500" autocomplete="off" placeholder="Ejemplo: cocina omitió cargar esta comida en la ruta">' +
        '<label class="confirmacion"><input type="checkbox" required>Confirmo que esta comida no fue surtida por cocina o reparto.</label>' +
        '<p role="alert" id="incidencia-error"></p><div class="acciones"><button class="accion sec" type="button" id="incidencia-cancelar">Cancelar</button>' +
        '<button class="accion" type="submit">Autorizar sin cargo</button></div></fieldset></form>';
      document.body.append(dialogo);
    }
    const form = dialogo.querySelector('form'), campos = form.querySelector('fieldset'), motivo = form.querySelector('input[type=text]');
    const error = dialogo.querySelector('#incidencia-error'), enviar = form.querySelector('button[type=submit]');
    form.reset(); campos.disabled = false; error.textContent = ''; enviar.textContent = 'Autorizar sin cargo';
    const operacion = raiz.GoLunchOperacion;
    const horario = fila.entrega_programada_en
      ? new Date(fila.entrega_programada_en).toLocaleTimeString('es-MX',{timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit'})
      : operacion.horaTexto(fila.turno,fila.zona,fecha);
    dialogo.querySelector('#incidencia-comida').textContent = fecha + ' · #' + fila.numero_empleado + ' · ' + fila.nombre + ' · ' + fila.platillo +
      ' · ' + (operacion.ZONAS[fila.zona] || 'Sin zona') + ' · ' + (operacion.TURNOS[fila.turno] || 'Sin turno') + ' · ' + horario + (fila.folio ? ' · ' + fila.folio : '');
    dialogo.querySelector('#incidencia-previa').textContent = fila.entregado_en
      ? 'Hay una entrega registrada. Esta autorización la rectificará para los reportes; verifica el caso antes de continuar.' : '';
    dialogo.querySelector('#incidencia-cancelar').onclick = () => dialogo.close();
    dialogo.oncancel = evento => { if (campos.disabled) evento.preventDefault(); };
    form.onsubmit = async evento => {
      evento.preventDefault(); if (campos.disabled) return;
      error.textContent = ''; campos.disabled = true; enviar.textContent = 'Registrando…';
      try {
        await api('/api/incidencias/' + fila.tipo + '/' + fila.id, { method:'POST', body:JSON.stringify({ motivo:motivo.value.trim(), entregado_esperado:fila.entregado_en || null }) });
        dialogo.close(); await actualizar();
      } catch (err) { error.textContent = err.message; }
      finally { campos.disabled = false; enviar.textContent = 'Autorizar sin cargo'; }
    };
    dialogo.showModal(); motivo.focus();
  } };
})(globalThis);
