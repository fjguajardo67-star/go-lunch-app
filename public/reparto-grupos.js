// El mismo criterio para pantalla, cierre de ruta y validación del servidor.
(() => {
  const turnoValido = turno => ['turno_a', 'turno_b'].includes(turno);
  function pedidosDelGrupo(pedidos, zona, turno) {
    if (!zona || !turnoValido(turno)) return [];
    return pedidos.filter(p => p.zona === zona && p.turno === turno);
  }
  function pendientesDelCierre(pedidos, zona, turno) {
    return pedidosDelGrupo(pedidos, zona, turno).filter(p => p.tipo === 'regular' && !p.entregado_en);
  }
  function validarGrupo(pedido, zona, turno) {
    if (!zona || !turnoValido(turno)) return { ok: false, motivo: 'grupo_requerido' };
    if (pedido.zona !== zona) return { ok: false, motivo: 'zona_incorrecta', zona_esperada: pedido.zona };
    if (pedido.turno !== turno) return { ok: false, motivo: 'turno_incorrecto', turno_esperado: pedido.turno };
    return { ok: true };
  }
  globalThis.GoLunchReparto = Object.freeze({ turnoValido, pedidosDelGrupo, pendientesDelCierre, validarGrupo });
})();
