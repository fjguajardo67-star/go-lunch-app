// Formato horizontal de reparto: rollo de 62 mm, corte de 90 mm.
export const ANCHO_ETIQUETA = 90;
export const ALTO_ETIQUETA = 62;

export function estiloEtiquetaReparto(ancho, alto) {
  if (Number(ancho) !== ANCHO_ETIQUETA || Number(alto) !== ALTO_ETIQUETA) return `
    .etiqueta { position: relative; padding-top: 5mm; }
    .etiqueta > .ruta { position: absolute; top: 1.6mm; left: 2.2mm; right: 2.2mm; }
  `;
  return `
  .etiqueta {
    padding: 3mm; display: grid; grid-template-columns: minmax(0,1fr) 32mm;
    grid-template-rows: auto minmax(0,1fr); gap: 2mm 3mm;
    color: #000; background: #fff; break-inside: avoid;
  }
  .etiqueta .ruta {
    grid-column: 1 / -1; font-size: 21pt; line-height: 1.12; font-weight: 900;
    letter-spacing: 0; white-space: normal; overflow: visible; text-transform: none;
  }
  .etiqueta .texto { grid-column: 1; grid-row: 2; gap: 2mm; justify-content: center; }
  .etiqueta:not(:has(.qr)) .texto { grid-column: 1 / -1; }
  .etiqueta .nombre {
    font-size: 16pt; line-height: 1.12; font-weight: 900;
    overflow-wrap: anywhere; -webkit-line-clamp: unset; flex-shrink: 0;
  }
  .etiqueta .platillo, .etiqueta .numero {
    font-size: 12pt; line-height: 1.15; font-weight: 650;
    overflow-wrap: anywhere; -webkit-line-clamp: 3;
  }
  .etiqueta .recibe {
    font-size: 8pt; line-height: 1.2; flex-shrink: 0; white-space: normal; overflow-wrap: anywhere;
  }
  .etiqueta:has(.recibe) .texto { gap: 1.5mm; }
  .etiqueta:has(.recibe) .nombre { font-size: 15pt; }
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
