// Verifica el token JWT enviado en el header Authorization: Bearer <token>
// y que la cuenta (y su vínculo con el recinto de la sesión) siga activa.
//
// El token guarda el recinto con el que se está trabajando. Quien pertenece a
// varios recintos inicia sesión sin recinto y debe elegir uno (POST /api/auth/recinto).
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { query } = require('../config/db');
const ROLES = require('../utils/roles');

// ¿La sesión sigue siendo válida? (permite que desactivar una cuenta tenga efecto inmediato)
async function sesionVigente({ id, rol, recinto_id: recintoId }) {
  if (rol === ROLES.ADMIN_PLATAFORMA || !recintoId) {
    const { rows } = await query('SELECT activo FROM usuarios WHERE id = $1', [id]);
    return Boolean(rows[0] && rows[0].activo);
  }
  const { rows } = await query(
    `SELECT 1 FROM usuarios u
     JOIN usuario_recinto ur ON ur.usuario_id = u.id
     JOIN recintos re ON re.id = ur.recinto_id
     WHERE u.id = $1 AND ur.recinto_id = $2 AND u.activo AND ur.activo AND re.activo`,
    [id, recintoId]
  );
  return rows.length > 0;
}

function crearAutenticador({ requiereRecinto }) {
  return async function autenticar(req, res, next) {
    const header = req.headers.authorization || '';
    const [tipo, token] = header.split(' ');

    if (tipo !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      const mensaje = err.name === 'TokenExpiredError' ? 'Sesión expirada' : 'Token inválido';
      return res.status(401).json({ error: mensaje });
    }

    // Queda disponible para los siguientes middlewares, controladores y la auditoría
    req.usuario = { id: payload.id, rol: payload.rol, recinto_id: payload.recinto_id || null, ip: req.ip };

    if (!(await sesionVigente(req.usuario))) {
      return res.status(401).json({ error: 'Tu acceso fue desactivado. Inicia sesión nuevamente.' });
    }

    if (requiereRecinto && req.usuario.rol !== ROLES.ADMIN_PLATAFORMA && !req.usuario.recinto_id) {
      return res.status(403).json({ error: 'Debes elegir el recinto en el que vas a trabajar', codigo: 'SELECCIONAR_RECINTO' });
    }
    next();
  };
}

// Uso normal: exige un recinto seleccionado (salvo el admin de plataforma)
const autenticar = crearAutenticador({ requiereRecinto: true });
// Para /auth/me y /auth/recinto: permite una sesión que aún no eligió recinto
autenticar.sinRecinto = crearAutenticador({ requiereRecinto: false });

module.exports = autenticar;
