// Configuración compartida por Node y las páginas (incluido reparto sin señal).
// Conservamos las claves de BD para no perder permisos, historial ni colas offline.
// zona_vdc identifica ahora ASLA; zona_refris identifica REFIS.
(() => {
  const ZONAS = Object.freeze({ zona_vdc: 'ASLA (LZCA)', zona_refris: 'REFIS (LZCR)' });
  const ZONA_DESC = Object.freeze({ zona_vdc: 'Fuera del puerto', zona_refris: 'Dentro del puerto' });
  const VIGENCIA = '2026-11-07';
  const TURNOS = Object.freeze({ turno_a: 'Turno A — matutino', turno_b: 'Turno B — vespertino' });

  function horaEntrega(turno, zona, fecha = VIGENCIA) {
    if (!Object.hasOwn(TURNOS, turno)) return null;
    // El cambio no recalifica entregas históricas con un horario nuevo.
    if (fecha < VIGENCIA) return turno === 'turno_a' ? '10:00' : '17:00';
    if (!Object.hasOwn(ZONAS, zona)) return null;
    return turno === 'turno_a' ? '10:00' : (zona === 'zona_vdc' ? '18:00' : '17:00');
  }

  function horarioZona(zona, fecha) {
    return Object.fromEntries(Object.keys(TURNOS).map(t => [t, horaEntrega(t, zona, fecha)]));
  }

  function horaTexto(turno, zona, fecha) {
    const hora = horaEntrega(turno, zona, fecha);
    if (!hora) {
      if (turno === 'turno_a') return '10:00 AM';
      if (turno === 'turno_b') return 'REFIS 5:00 PM · ASLA 6:00 PM';
      return '';
    }
    const [h, m] = hora.split(':');
    return `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? 'PM' : 'AM'}`;
  }

  function textoTurno(turno, zona, fecha) {
    if (!Object.hasOwn(TURNOS, turno)) return turno || 'Sin turno';
    return `${turno === 'turno_a' ? 'Turno A' : 'Turno B'} — ${horaTexto(turno, zona, fecha)}`;
  }

  globalThis.GoLunchOperacion = Object.freeze({ ZONAS, ZONA_DESC, TURNOS, VIGENCIA, horaEntrega, horarioZona, horaTexto, textoTurno });
})();
