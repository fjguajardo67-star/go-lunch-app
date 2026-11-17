// Constructores compartidos por el panel y las pruebas. SheetJS ya existe en el panel.
(function (raiz) {
  const entregada = p => !!(p.entregado_en || p.entrega_conciliada_en) && !p.no_surtido_en;
  const estado = p => p.no_surtido_en ? 'No surtido por cocina/reparto · Sin cargo al empleado' : p.entrega_conciliada_en && !p.entregado_en ? 'Entregado · Conciliación administrativa sin hora real' : entregada(p) ? 'Entregado' : 'Pendiente';
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
      if (entregada(p)) d.entregados++;
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
    hoja('Auditoria_Detalle', [['Servicio', 'Folio', 'No_Empleado', 'Nombre', 'Telefono', 'Fecha_Servicio', 'Platillo', 'Zona', 'Turno', 'Horario', 'Estado', 'Entrega_Original', 'Motivo_Sin_Cargo', 'Autorizado_Por', 'Autorizado_En', 'Conciliada_En', 'Conciliada_Por', 'Motivo_Conciliacion'],
      ...comidas.map(p => [f.servicio(p), p.folio || '', p.empleados?.numero_empleado || '', p.empleados?.nombre || '',
        f.telefono(p.empleados?.telefono || p.empleado_telefono), p.fecha_menu, p.opcion_texto || p.opcion_id,
        f.zona(p.zona), f.turno(p.turno), f.horario(p), estado(p), p.entregado_en || '', p.no_surtido_motivo || '', p.no_surtido_por || '', p.no_surtido_en || '', p.entrega_conciliada_en || '', p.entrega_conciliada_por || '', p.entrega_conciliacion_motivo || ''])],
      [26, 26, 14, 36, 16, 16, 38, 18, 24, 16, 35, 28, 60, 18, 28, 28, 30, 65]);
    filtros(ini, fin, seleccion); return wb;
  }

  raiz.GoLunchReportesExcel = { cocina, facturacion };
})(globalThis);
