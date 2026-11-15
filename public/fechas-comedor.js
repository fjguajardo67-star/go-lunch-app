// Fechas civiles del comedor, compartidas por el pedido y el panel.
// Temporal es progresivo: Safari conserva una alternativa local, sin CDN.
(() => {
  const ZONA = 'America/Mexico_City';
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const pad = n => String(n).padStart(2, '0');

  function fechaComedor(ahora = Date.now()) {
    const ms = ahora instanceof Date ? ahora.getTime() : Number(ahora);
    if (globalThis.Temporal?.Instant) {
      return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(ZONA).toPlainDate().toString();
    }
    return formato.format(ms);
  }

  function sumarDias(fecha, dias) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isInteger(dias)) throw new RangeError('Fecha o días inválidos');
    if (globalThis.Temporal?.PlainDate) return Temporal.PlainDate.from(fecha).add({ days: dias }).toString();
    const [a, m, d] = fecha.split('-').map(Number);
    // Solo aritmética de calendario: nunca se interpreta la fecha como una
    // medianoche local ni se convierte una hora de servicio a UTC.
    const civil = new Date(0);
    civil.setUTCFullYear(a, m - 1, d);
    if (civil.getUTCFullYear() !== a || civil.getUTCMonth() !== m - 1 || civil.getUTCDate() !== d) throw new RangeError('Fecha inválida');
    civil.setUTCDate(civil.getUTCDate() + dias);
    return String(civil.getUTCFullYear()).padStart(4, '0') + '-' + pad(civil.getUTCMonth() + 1) + '-' + pad(civil.getUTCDate());
  }

  function notaServicio(fecha, abierto, ahora = Date.now()) {
    const manana = sumarDias(fechaComedor(ahora), 1);
    return abierto && fecha > manana
      ? 'Mañana no hay servicio en el comedor. Tu pedido es para la fecha indicada.'
      : '';
  }

  globalThis.GoLunchFechas = Object.freeze({ ZONA, fechaComedor, sumarDias, notaServicio });
})();
