// Verifica el token JWT enviado en el header Authorization: Bearer <token>
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    // Queda disponible para los siguientes middlewares y controladores
    req.usuario = { id: payload.id, rol: payload.rol, recinto_id: payload.recinto_id };
    next();
  } catch (err) {
    const mensaje = err.name === 'TokenExpiredError' ? 'Sesión expirada' : 'Token inválido';
    return res.status(401).json({ error: mensaje });
  }
}

module.exports = autenticar;
