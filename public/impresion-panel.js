// Impresos del panel: una fotografía de lo visible, sin consultar ni guardar datos.
(function () {
  const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const opciones = [
    ['fija_a', 'Opción A — Fija'], ['fija_b', 'Opción B — Fija'], ['fija_c', 'Opción C — Fija'],
    ['var_1', 'Variable 1'], ['var_2', 'Variable 2'], ['var_3', 'Variable 3']
  ];
  const fecha = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '')
    ? iso.split('-').reverse().join('/') : 'Sin fecha seleccionada';

  function documento(titulo, contenido, generado) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${escapar(titulo)} · Go Lunch</title><style>
      *{box-sizing:border-box}body{margin:0;background:#eef1f6;color:#17233b;font:12pt Arial,sans-serif;line-height:1.4}
      .acciones{padding:16px;text-align:center;background:#fff;border-bottom:1px solid #bcc5d3}
      button{padding:12px 18px;margin:4px;border:1px solid #003087;border-radius:6px;background:#003087;color:white;font:inherit;cursor:pointer}
      button:focus-visible{outline:3px solid #b67b12;outline-offset:3px}
      .acciones p{margin:6px 0;font-size:10pt}
      main{max-width:8.5in;margin:20px auto;padding:.55in;background:white;overflow-wrap:anywhere}
      .marca{font-weight:bold;color:#003087;margin:0 0 8px}h1{font-size:22pt;margin:0 0 8px;color:#003087;line-height:1.2}
      .resumen{margin:0 0 20px;font-size:10pt}.nota{font-size:9pt;margin-top:20px;color:#39465b}
      table{border-collapse:collapse;width:100%;font-size:9pt;table-layout:fixed}
      th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #bcc5d3;vertical-align:top;overflow-wrap:anywhere}
      th{font-weight:bold;border-top:1px solid #8290a5}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
      .menu-dia{break-before:page;page-break-before:always}.menu-dia:first-child{break-before:auto;page-break-before:auto}
      .platos{margin:18px 0;padding:0;list-style:none}.platos li{padding:12px 0;border-bottom:1px solid #bcc5d3;break-inside:avoid}
      .platos b{display:block;font-size:10pt;margin-bottom:4px}.platos span{font-size:15pt}
      @page{size:letter portrait;margin:14mm}
      @media print{body{background:white}.acciones{display:none}main{max-width:none;margin:0;padding:0}h1,h2{break-after:avoid;page-break-after:avoid}.nota{color:#17233b;break-inside:avoid;page-break-inside:avoid}.platos li{page-break-inside:avoid}}
      @media(max-width:600px){main{margin:0;padding:20px}h1{font-size:20pt}th,td{padding:8px 4px}}
      </style></head><body><div class="acciones">
      <button type="button" onclick="window.print()">Imprimir o guardar PDF</button>
      <p>Vista previa · Tamaño carta · Orientación vertical</p></div>
      <main>${contenido}<p class="nota">Generado: ${escapar(generado)} · Hora de Lázaro Cárdenas</p></main></body></html>`;
  }

  function lista(empleados, generado) {
    const activos = empleados.filter(e => e.activo).length;
    const filas = empleados.map(e => `<tr><td>${escapar(e.numero)}</td><td>${escapar(e.nombre)}</td>
      <td>${escapar(e.zona)}</td><td>${escapar(e.turno)}</td><td>${e.activo ? 'Activo' : 'Inactivo'}</td></tr>`).join('');
    return documento('Lista de empleados', `<p class="marca">CICSA Go Lunch · Hyundai Glovis</p>
      <h1>Lista de empleados</h1><p class="resumen">${empleados.length} empleados · ${activos} activos · ${empleados.length - activos} inactivos</p>
      <table><colgroup><col style="width:12%"><col style="width:38%"><col style="width:18%"><col style="width:18%"><col style="width:14%"></colgroup>
      <thead><tr><th>No.</th><th>Nombre</th><th>Zona habitual</th><th>Turno habitual</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>
      <p class="nota">Acceso a la aplicación con el número de empleado.</p>`, generado);
  }

  function menus(dias, generado) {
    const contenido = dias.map(dia => {
      const platos = opciones.filter(([campo]) => String(dia[campo] || '').trim());
      return `<section class="menu-dia"><p class="marca">CICSA Go Lunch · Hyundai Glovis</p>
        <h1>Menú del ${escapar(fecha(dia.fecha))}</h1>
        ${platos.length ? `<ul class="platos">${platos.map(([campo, etiqueta]) => `<li><b>${etiqueta}</b><span>${escapar(dia[campo])}</span></li>`).join('')}</ul>` : '<p>Sin platillos capturados en esta vista.</p>'}
        <p class="nota">Contenido visible en el panel. Esta copia no confirma la publicación del menú.</p></section>`;
    }).join('');
    return documento(dias.length === 1 ? 'Menú del ' + fecha(dias[0].fecha) : 'Menús del periodo', contenido, generado);
  }

  function abrir(html) {
    if (document.getElementById('panel-vista-impresion')) return;
    const foco = document.activeElement;
    const scroll = window.scrollY;
    const anteriores = [...document.body.children].map(elemento => [elemento, elemento.style.display]);
    const vista = document.createElement('section');
    vista.id = 'panel-vista-impresion';
    vista.setAttribute('aria-label', 'Vista previa de impresión');
    vista.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:#fff';
    const volver = document.createElement('button');
    volver.type = 'button';
    volver.textContent = 'Volver al panel';
    volver.className = 'accion sec';
    volver.style.cssText = 'align-self:flex-start;margin:12px 16px';
    const frame = document.createElement('iframe');
    frame.title = 'Documento listo para imprimir';
    frame.style.cssText = 'width:100%;flex:1;min-height:0;border:0';
    frame.srcdoc = html;
    volver.onclick = () => {
      vista.remove();
      anteriores.forEach(([elemento, display]) => { elemento.style.display = display; });
      foco?.focus({preventScroll:true});
      window.scrollTo(0, scroll);
    };
    anteriores.forEach(([elemento]) => { elemento.style.display = 'none'; });
    vista.append(volver, frame);
    document.body.append(vista);
    volver.focus();
  }
  globalThis.ImpresionPanel = Object.freeze({ lista, menus, abrir });
})();
