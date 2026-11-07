export function fechaMexico(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year:'numeric',month:'2-digit',day:'2-digit' }).format(ahora);
}
export function mananaMexico(ahora = new Date()) {
  const dia = new Date(`${fechaMexico(ahora)}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate()+1);
  return dia.toISOString().slice(0,10);
}
export function ventanaDiaria(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(ahora);
  return partes >= '21:30';
}
export function htmlSinScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
}
export function puedeEnviar(estado, documento) {
  return !estado[documento]; // "enviando" también bloquea: revisar la cola antes de reintentar.
}
export function argumentosImpresora(impresora, archivo) {
  if (!impresora || /[\r\n\0]/.test(impresora)) throw new Error('Nombre de impresora inválido');
  return ['-print-to',impresora,'-print-settings','noscale','-silent',archivo];
}
