// Constructores compartidos por el panel y las pruebas. SheetJS ya existe en el panel.
(function (raiz) {
  const estado = p => p.no_surtido_en ? 'No surtido por cocina/reparto · Sin cargo al empleado' : p.entregado_en ? 'Entregado' : 'Pendiente';
  function libro(X, f) {
    const wb = X.utils.book_new();
    const hoja = (nombre, filas, anchos) => {
      const ws = X.utils.aoa_to_sheet(filas);
      ws['!cols'] = anchos.map(wch => ({ wch }));
      X.utils.book_append_sheet(wb, ws, nombre); return ws;
    };
    const filtros = (ini, fin, seleccion) => hoja('Filtros', [
      ['Periodo', ini + ' a ' + fin], ['Servicio', f.filtros(seleccion)],
      ['Unidad', 'Una fila por comida; una persona puede tener regular y cobertura.'],
      ['Coberturas', 'Incluye extraordinarias vigentes; excluye canceladas.']
    ], [20, 90]);
    return { wb, hoja, filtros };
  }

  function cocina(X, f, fecha, resumen, comidas) {
    if (resumen.total !== comidas.length) throw new Error('El conteo cambió entre consultas. Vuelve a descargar.');
    const { wb, hoja, filtros } = libro(X, f);
    const filas = [['Turno', 'Zona', 'Horario', 'Platillo', 'Regulares', 'Coberturas', 'Total']];
    for (const g of resumen.grupos) {
      for (const p of g.resumen) filas.push([f.turno(g.turno), f.zona(g.zona), g.horario, p.platillo, p.regulares, p.coberturas, p.porciones]);
      filas.push(['Subtotal', f.zona(g.zona), g.horario, '', g.regulares, g.coberturas, g.total]);
    }
    filas.push(['TOTAL GENERAL', '', '', '', resumen.regulares, resumen.coberturas, resumen.total]);
    hoja('Resumen_Cocina', filas, [24, 20, 16, 38, 12, 12, 12]);
    hoja('Etiquetas', [['Servicio', 'Folio', 'No_Empleado', 'Nombre_Comensal', 'Platillo', 'Zona', 'Turno', 'Horario', 'Fecha', 'Estado', 'Hora_Entrega', 'Recibe', 'Codigo_QR'],
      ...comidas.map(p => [f.servicio(p), p.folio || '', p.empleados?.numero_empleado || '', p.empleados?.nombre || '',
        p.opcion_texto || p.opcion_id, f.zona(p.zona), f.turno(p.turno), f.horario(p), fecha,
        estado(p), p.no_surtido_en ? '' : p.entregado_en || '', p.responsable_nombre || '', p.codigo_etiqueta || ''])],
      [24, 26, 14, 36, 36, 18, 24, 16, 14, 14, 28, 36, 52]);
    filtros(fecha, fecha, resumen.filtros); return wb;
  }

  function facturacion(X, f, ini, fin, costo, comidas, seleccion) {
    const { wb, hoja, filtros } = libro(X, f), dias = new Map();
    for (const p of comidas) {
      if (!dias.has(p.fecha_menu)) dias.set(p.fecha_menu, { regulares:0, coberturas:0, entregados:0, total:0, no_surtidos:0 });
      const d = dias.get(p.fecha_menu);
      if (p.no_surtido_en) { d.no_surtidos++; continue; }
      d.total++; d[p.tipo === 'cobertura' ? 'coberturas' : 'regulares']++;
      if (p.entregado_en) d.entregados++;
    }
    const filas = [['Fecha', 'Regulares_Con_Cargo', 'Coberturas_Con_Cargo', 'Total_Servicios_Con_Cargo', 'Costo_Unitario ($)', 'Subtotal ($)', 'Entregados', 'Pendientes', 'No_Surtidos_Sin_Cargo']];
    for (const [fecha, d] of [...dias].sort(([a],[b]) => a.localeCompare(b))) filas.push([fecha, d.regulares, d.coberturas, d.total, costo, d.total*costo, d.entregados, d.total-d.entregados, d.no_surtidos]);
    const total = filas.length + 1;
    filas.push(['TOTAL', 0, 0, 0, '', 0, 0, 0, 0]);
    const ws = hoja('Resumen_Facturacion', filas, [14, 22, 22, 25, 20, 18, 14, 14, 24]);
    for (let i=2; i<total; i++) {
      ws['F'+i] = { t:'n', v:filas[i-1][5], f:`D${i}*E${i}`, z:'$#,##0.00' };
      ws['E'+i].z = '$#,##0.00';
    }
    for (const [col, indice] of [['B',1],['C',2],['D',3],['F',5],['G',6],['H',7],['I',8]]) {
      const v = filas.slice(1,-1).reduce((n,r) => n+r[indice],0);
      ws[col+total] = { t:'n', v, ...(total>2 ? {f:`SUM(${col}2:${col}${total-1})`} : {}), ...(col==='F' ? {z:'$#,##0.00'} : {}) };
    }
    hoja('Auditoria_Detalle', [['Servicio', 'Folio', 'No_Empleado', 'Nombre', 'Telefono', 'Fecha_Servicio', 'Platillo', 'Zona', 'Turno', 'Horario', 'Estado', 'Entrega_Original', 'Motivo_Sin_Cargo', 'Autorizado_Por', 'Autorizado_En'],
      ...comidas.map(p => [f.servicio(p), p.folio || '', p.empleados?.numero_empleado || '', p.empleados?.nombre || '',
        f.telefono(p.empleados?.telefono || p.empleado_telefono), p.fecha_menu, p.opcion_texto || p.opcion_id,
        f.zona(p.zona), f.turno(p.turno), f.horario(p), estado(p), p.entregado_en || '', p.no_surtido_motivo || '', p.no_surtido_por || '', p.no_surtido_en || ''])],
      [26, 26, 14, 36, 16, 16, 38, 18, 24, 16, 35, 28, 60, 18, 28]);
    filtros(ini, fin, seleccion); return wb;
  }

  function operacion(X, f, d) {
    const { wb, hoja, filtros } = libro(X, f);
    hoja('Sin_Recoger', [['No_Empleado', 'Nombre', 'Comidas', 'No_Recogidos', 'Porcentaje'],
      ...d.sin_recoger.map(x => [x.numero_empleado,x.nombre,x.pedidos,x.no_recogidos,x.pct])], [14,36,12,16,14]);
    hoja('Merma', [['MERMA POR TURNO'], ['Turno','Evaluables','Entregados','No_Recogidos','Merma_%'],
      ...d.merma.por_turno.map(m => [f.turno(m.turno),m.evaluables,m.entregados,m.no_recogidos,m.pct_merma]),
      [], ['MERMA POR ZONA'], ['Zona','Evaluables','Entregados','No_Recogidos','Merma_%'],
      ...d.merma.por_zona.map(m => [f.zona(m.zona),m.evaluables,m.entregados,m.no_recogidos,m.pct_merma])], [26,14,14,16,12]);
    hoja('Tiempos_Ruta', [['Fecha','Turno','Zona','Horario','Entregas','Primera','Ultima','Duracion_Min'],
      ...d.ruta.por_dia.map(r => [r.fecha,f.turno(r.turno),f.zona(r.zona),r.horario,r.entregas,r.primera,r.ultima,r.entregas<2?'':r.minutos]),
      [], ['PROMEDIO POR TURNO'], ['Turno','Tramos','Minutos_Promedio'],
      ...d.ruta.promedio_por_turno.map(t => [f.turno(t.turno),t.tramos??t.dias,t.minutos_promedio])], [14,24,20,16,12,12,12,16]);
    hoja('Calificaciones', [['Platillo','Porciones_Regulares','Entregados','Me_gusto','Estuvo_bien','No_me_gusto','Opiniones','Aprobacion_%','Participacion_%'],
      ...d.rating_por_platillo.map(x => [x.platillo,x.porciones,x.entregados,x.si,x.tal_vez,x.no,x.respondidos,x.muestra_corta||x.aprobacion===null?'':x.aprobacion,x.participacion]),
      [], ['Solo pedidos regulares: las coberturas no tienen encuesta.'], ['Aprobación vacía: sin opiniones o muestra menor al mínimo.']], [38,20,12,12,14,14,12,16,18]);
    hoja('Resumen', [['Periodo', d.ini+' a '+d.fin], ['Regulares',d.regulares],['Coberturas',d.coberturas],['Total de comidas',d.total],
      ['Entregados a tiempo',d.entrega.entregados],['Entregados tarde',d.entrega.tardios],['Entregados sin puntualidad verificable',d.entrega.indeterminados],
      ['No entregados',d.entrega.no_entregados],['De esos, aún no vence su hora',d.entrega.pendientes],['No surtidos · Sin cargo al empleado', d.no_surtidos || 0],
      [],['Merma','Solo comidas cuya hora de entrega ya venció, incluida su tolerancia operativa.'],
      ['Extraordinarias','Se evalúan contra su hora de entrega autorizada.'],['Ruta','Intervalo entre marcas de entrega de cada zona y horario.']], [44,90]);
    hoja('Incidencias_Sin_Cargo', [['Fecha','No_Empleado','Nombre','Servicio','Folio','Platillo','Zona','Turno','Motivo','Autorizado_Por','Autorizado_En'],
      ...(d.incidencias || []).map(i => [i.fecha,i.numero_empleado,i.nombre,i.tipo,i.folio || '',i.platillo,f.zona(i.zona),f.turno(i.turno),i.motivo,i.registrado_por,i.registrado_en])],
      [14,14,36,18,26,38,18,24,60,18,28]);
    filtros(d.ini,d.fin,d.filtros); return wb;
  }
  raiz.GoLunchReportesExcel = { cocina, facturacion, operacion };
})(globalThis);
