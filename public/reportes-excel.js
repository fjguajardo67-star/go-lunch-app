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

  raiz.GoLunchReportesExcel = { cocina };
})(globalThis);
