import * as db from './supabase.js';
import { validarPeriodo, unirComidas } from './comidas.js';

export async function comidasDelPeriodo(ini, fin = ini) {
  validarPeriodo(ini, fin);
  const [pedidos, coberturas] = await Promise.all([
    db.getPedidosRango(ini, fin), db.getSolicitudesCoberturaRango(ini, fin)
  ]);
  return unirComidas(pedidos, coberturas);
}
