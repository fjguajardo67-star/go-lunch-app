// Contrato compartido de impresión y lectura. El QR identifica; la lista
// autorizada sigue siendo la fuente de zona, turno y horario del pedido.
(() => {
  const zonas = ['zona_vdc', 'zona_refris'];
  const texto = valor => String(valor ?? '').trim();
  function crear(p, fecha = p.fecha_menu) {
    const numero = texto(p.numero_empleado ?? p.empleados?.numero_empleado);
    const zona = texto(p.zona);
    // Los impresos históricos incompletos conservan su formato anterior.
    const extra = zonas.includes(zona) && numero ? [zona, numero] : [];
    return p.tipo === 'cobertura'
      ? ['EX', p.codigo_entrega, fecha, ...extra].join('|')
      : [numero, fecha, ...(extra.length ? [zona] : [])].join('|');
  }
  function leer(codigo) {
    const partes = texto(codigo).split('|').map(texto);
    const cobertura = partes[0]?.toUpperCase() === 'EX';
    const [identificador, fecha, zona, numero] = cobertura ? partes.slice(1) : partes;
    const cantidad = cobertura ? [3, 5] : [1, 2, 3];
    if (!cantidad.includes(partes.length) || !identificador ||
        (partes.length > 1 && !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) ||
        (zona != null && !zonas.includes(zona.toLowerCase())) ||
        (cobertura && partes.length === 5 && !numero)) return null;
    return { tipo: cobertura ? 'cobertura' : 'regular', identificador,
      fecha: fecha || null, zona: zona?.toLowerCase() || null,
      numero: cobertura ? numero || null : identificador };
  }
  function resolver(codigo, pedidos, fecha, permitidas) {
    const qr = leer(codigo);
    if (!qr) return { error: 'codigo_invalido' };
    if (qr.fecha && qr.fecha !== fecha) return { error: 'otra_fecha', qr };
    const candidatos = pedidos.filter(p => (p.tipo === 'cobertura' ? 'cobertura' : 'regular') === qr.tipo &&
      texto(qr.tipo === 'cobertura' ? p.codigo_entrega : p.numero_empleado).toUpperCase() === qr.identificador.toUpperCase());
    if (!candidatos.length) return { error: 'sin_pedido', qr };
    const coinciden = candidatos.filter(p => (!qr.zona || p.zona === qr.zona) &&
      (!qr.numero || texto(p.numero_empleado) === qr.numero));
    if (!coinciden.length) return { error: 'etiqueta_distinta', qr };
    if (coinciden.length !== 1) return { error: 'ambiguo', qr };
    const pedido = coinciden[0];
    if (!permitidas.includes(pedido.zona)) return { error: 'zona_no_autorizada', qr };
    if (pedido.no_surtido_en) return { error: 'no_surtido', qr };
    return { pedido, qr };
  }
  globalThis.GoLunchEtiqueta = Object.freeze({ crear, leer, resolver });
})();
