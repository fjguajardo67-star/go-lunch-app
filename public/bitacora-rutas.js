// Itinerarios del comedor, compartidos por Entrega, el panel y la API.
(() => {
  const itinerarios = [
    { id: 'turno_a_asla', turno: 'turno_a', titulo: 'Turno A · ASLA', zonas: ['zona_vdc'] },
    { id: 'turno_a_refis', turno: 'turno_a', titulo: 'Turno A · REFIS', zonas: ['zona_refris'] },
    { id: 'turno_b', turno: 'turno_b', titulo: 'Turno B · REFIS y ASLA', zonas: ['zona_refris', 'zona_vdc'] }
  ].map(ruta => {
    const pasos = [{ titulo: 'Salida del comedor', boton: 'Iniciar ruta' }];
    for (const zona of ruta.zonas) {
      const nombre = zona === 'zona_vdc' ? 'ASLA' : 'REFIS';
      pasos.push({ titulo: 'Llegada a ' + nombre, boton: 'Registrar llegada a ' + nombre, zona, llegada: true });
      pasos.push({ titulo: 'Salida de ' + nombre, boton: 'Registrar salida de ' + nombre, zona });
    }
    pasos.push({ titulo: 'Regreso al comedor', boton: 'Cerrar ruta en el comedor' });
    return Object.freeze({ ...ruta, zonas: Object.freeze(ruta.zonas), pasos: Object.freeze(pasos.map(Object.freeze)) });
  });

  function permitidas(zonas) {
    return itinerarios.filter(ruta => zonas === null || ruta.zonas.every(zona => zonas.includes(zona)));
  }

  function porId(id) {
    return itinerarios.find(ruta => ruta.id === id);
  }

  function agrupar(marcas) {
    const rutas = new Map();
    for (const marca of marcas) {
      const plan = porId(marca.ruta);
      if (!plan || !plan.pasos[marca.paso]) continue;
      const clave = marca.fecha + '|' + marca.ruta;
      if (!rutas.has(clave)) rutas.set(clave, { plan, fecha: marca.fecha, marcas: [] });
      rutas.get(clave).marcas[marca.paso] = marca;
    }
    return [...rutas.values()].map(ruta => ({
      ...ruta, siguiente: ruta.plan.pasos.findIndex((_, paso) => !ruta.marcas[paso])
    }));
  }

  globalThis.GoLunchBitacora = Object.freeze({ permitidas, porId, agrupar });
})();
