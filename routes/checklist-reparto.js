import express from 'express';
import { rolPanel } from '../services/acceso-panel.js';
import { checklistReparto } from '../services/cocina.js';
import { htmlChecklistReparto } from '../services/checklist-reparto.js';

export const checklistRepartoRouter = express.Router();

checklistRepartoRouter.get('/:fecha', async (req, res) => {
  if (!rolPanel(req.query.key)) return res.status(401).send('No autorizado');
  try {
    const datos = await checklistReparto(req.params.fecha, req.query);
    res.type('html').send(htmlChecklistReparto(datos));
  } catch (error) {
    if (!error.status) console.error('[Checklist reparto] Error generando la lista:', error.message);
    res.status(error.status || 500).send(error.status ? error.message : 'No se pudo generar el checklist de salida.');
  }
});
