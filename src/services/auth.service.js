// Lógica de autenticación: validar credenciales, generar JWT y obtener el usuario actual
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { env } = require('../config/env');
const HttpError = require('../utils/HttpError');

const MENSAJE_CREDENCIALES = 'Credenciales inválidas';

// Hash ficticio para comparar cuando el email no existe. Así la respuesta tarda
// lo mismo exista o no el usuario (evita adivinar emails registrados por tiempo).
const HASH_FICTICIO = bcrypt.hashSync('contraseña-ficticia', 10);

const SQL_USUARIO = `
  SELECT u.id, u.nombre, u.apellido, u.email, u.password_hash, u.activo,
         u.recinto_id, u.unidad_id, r.nombre AS rol,
         COALESCE(re.activo, TRUE) AS recinto_activo
  FROM usuarios u
  JOIN roles r ON r.id = u.rol_id
  LEFT JOIN recintos re ON re.id = u.recinto_id
`;

// Datos públicos del usuario (nunca se devuelve el hash)
function formatearUsuario(fila) {
  return {
    id: fila.id,
    nombre: `${fila.nombre} ${fila.apellido}`.trim(),
    email: fila.email,
    rol: fila.rol,
    recinto_id: fila.recinto_id,
  };
}

async function login(email, password) {
  const { rows } = await query(`${SQL_USUARIO} WHERE u.email = $1`, [email]);
  const usuario = rows[0];

  const passwordOk = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_FICTICIO);
  if (!usuario || !passwordOk) {
    throw new HttpError(401, MENSAJE_CREDENCIALES);
  }

  if (!usuario.activo) {
    throw new HttpError(403, 'Tu cuenta está desactivada. Contacta al administrador.');
  }

  if (!usuario.recinto_activo) {
    throw new HttpError(403, 'El recinto está desactivado. Contacta al administrador de la plataforma.');
  }

  await query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [usuario.id]);

  const token = jwt.sign(
    { id: usuario.id, rol: usuario.rol, recinto_id: usuario.recinto_id },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

  return { token, usuario: formatearUsuario(usuario) };
}

// Datos actualizados del usuario del token (por si fue desactivado o cambió de rol)
async function obtenerUsuarioActual(id) {
  const { rows } = await query(`${SQL_USUARIO} WHERE u.id = $1`, [id]);
  const usuario = rows[0];

  if (!usuario || !usuario.activo || !usuario.recinto_activo) {
    throw new HttpError(401, 'Sesión no válida');
  }

  return formatearUsuario(usuario);
}

module.exports = { login, obtenerUsuarioActual };
