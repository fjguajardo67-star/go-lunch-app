// Formato horizontal de reparto: rollo de 62 mm, corte de 90 mm.
export const ANCHO_ETIQUETA = 90;
export const ALTO_ETIQUETA = 62;

export function estiloEtiquetaReparto(ancho, alto) {
  if (Number(ancho) !== ANCHO_ETIQUETA || Number(alto) !== ALTO_ETIQUETA) return `
    .etiqueta { position: relative; padding-top: 5mm; padding-bottom: 4mm; }
    .etiqueta .identificacion { position: absolute; bottom: 1mm; left: 2.2mm; right: 2.2mm; display: flex; justify-content: space-between; font-size: 6pt; }
    .etiqueta > .ruta { position: absolute; top: 1.6mm; left: 2.2mm; right: 2.2mm; }
  `;
  return `
  .etiqueta {
    position: relative; padding: 5mm 5mm 10mm; display: grid; grid-template-columns: minmax(0,1fr) 32mm;
    grid-template-rows: auto minmax(0,1fr); gap: 1.5mm 3mm;
    color: #000; background: #fff; break-inside: avoid;
  }
  .etiqueta .ruta {
    grid-column: 1 / -1; font-size: 21pt; line-height: 1.12; font-weight: 900;
    letter-spacing: 0; white-space: normal; overflow: visible; text-transform: none;
  }
  .etiqueta .texto { grid-column: 1; grid-row: 2; gap: 1.5mm; justify-content: center; min-height: 0; }
  .etiqueta:not(:has(.qr)) .texto { grid-column: 1 / -1; }
  .etiqueta .nombre {
    font-size: 16pt; line-height: 1.12; font-weight: 900;
    overflow-wrap: anywhere; -webkit-line-clamp: unset; flex-shrink: 0;
  }
  .etiqueta .platillo, .etiqueta .numero {
    font-size: 12pt; line-height: 1.15; font-weight: 650;
    overflow-wrap: anywhere; -webkit-line-clamp: unset; flex-shrink: 0;
  }
  .etiqueta .recibe {
    font-size: 8pt; line-height: 1.2; flex-shrink: 0; white-space: normal; overflow-wrap: anywhere;
  }
  .etiqueta:has(.recibe) .texto { gap: 1.5mm; }
  .etiqueta:has(.recibe) .nombre { font-size: 15pt; }
  .etiqueta .identificacion {
    position: absolute; left: 5mm; right: 5mm; bottom: 5mm; display: flex; justify-content: space-between;
    gap: 2mm; font-size: 9pt; line-height: 1.15; font-weight: 750;
  }
  .etiqueta .qr {
    grid-column: 2; grid-row: 2; width: 32mm; height: 32mm;
    align-self: center; background: #fff; padding: 2mm;
  }
  @media print {
    html, body { margin: 0; padding: 0; }
    .hoja.rollo { display: block; }
    .hoja.rollo .etiqueta { margin: 0; break-inside: avoid; }
  }
  `;
}

// Conserva el nombre completo cuando un apellido o platillo ocupa más líneas.
// Se ejecuta en pantalla y antes de imprimir, sin cambiar las dimensiones del papel.
export const scriptAjustarTextoEtiqueta = `<script>
(function(){
  function ajustar(){
    document.querySelectorAll('.etiqueta').forEach(function(etiqueta){
      if(Math.abs(etiqueta.getBoundingClientRect().width - 90 * 96 / 25.4)>2)return;
      var texto=etiqueta.querySelector('.texto');
      if(!texto)return;
      var campos=Array.from(texto.children);
      campos.forEach(function(c){c.style.removeProperty('font-size')});
      function altoNecesario(){return campos.reduce(function(n,c){return n+c.getBoundingClientRect().height},0)+parseFloat(getComputedStyle(texto).rowGap||0)*Math.max(0,campos.length-1)}
      for(var paso=0;paso<16 && altoNecesario()>texto.clientHeight;paso++){
        var cambio=false;
        campos.forEach(function(c){
          var piso=c.classList.contains('nombre')?16:c.classList.contains('recibe')?9.33:12;
          var actual=parseFloat(getComputedStyle(c).fontSize);
          if(actual>piso){c.style.fontSize=Math.max(piso,actual-0.67)+'px';cambio=true}
        });
        if(!cambio)break;
      }
    });
  }
  window.addEventListener('load',function(){
    ajustar();if(document.fonts)document.fonts.ready.then(ajustar);
  });
  window.addEventListener('beforeprint',ajustar);
})();
</script>`;
