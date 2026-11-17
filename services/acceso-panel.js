// Roles del panel: la clave de gerente nunca permite editar menús ni empleados.
import { timingSafeEqual } from 'node:crypto';

function coincide(valor, secreto) {
  if (typeof valor !== 'string' || !secreto) return false;
  const a = Buffer.from(valor), b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function rolPanel(clave) {
  if (coincide(clave, process.env.ADMIN_KEY)) return 'admin';
  if (coincide(clave, process.env.GERENTE_KEY)) return 'gerente';
  if (coincide(clave, process.env.MONITOREO_KEY)) return 'monitoreo';
  return null;
}

export function autorizarPanel(req, res, next) {
  const rol = rolPanel(req.headers['x-admin-key']);
  if (!rol) return res.status(401).json({ error: 'No autorizado' });
  const usuario = String(req.headers['x-panel-user'] || '').trim().toLowerCase();
  if ((rol === 'gerente' && (usuario || req.path === '/sesion') && usuario !== 'gerente') ||
      (rol === 'monitoreo' && usuario !== 'monitoreo') ||
      (rol === 'admin' && ['gerente', 'monitoreo'].includes(usuario)) ||
      (rol === 'gerente' && usuario === 'monitoreo')) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.rolPanel = rol;
  const escritura = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (rol === 'monitoreo' && escritura) {
    return res.status(403).json({ error: 'Monitoreo es de solo lectura: puedes consultar y descargar reportes, sin modificar registros.' });
  }
  if (rol === 'gerente' && escritura && /^\/(?:empleados|menu|cobertura\/menu)(?:\/|$)/.test(req.path)) {
    return res.status(403).json({ error: 'El gerente puede consultar e imprimir, pero no modificar menús ni empleados.' });
  }
  next();
}
