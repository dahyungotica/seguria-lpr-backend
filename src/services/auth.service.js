// Lógica de autenticación: validar credenciales, elegir recinto, generar JWT y obtener el usuario actual
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { env } = require('../config/env');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');

const MENSAJE_CREDENCIALES = 'Credenciales inválidas';

// Hash ficticio para comparar cuando el email no existe. Así la respuesta tarda
// lo mismo exista o no el usuario (evita adivinar emails registrados por tiempo).
const HASH_FICTICIO = bcrypt.hashSync('contraseña-ficticia', 10);

const SQL_USUARIO = `
  SELECT u.id, u.nombre, u.apellido, u.email, u.password_hash, u.activo, r.nombre AS rol
  FROM usuarios u
  JOIN roles r ON r.id = u.rol_id
`;

// Recintos activos donde el usuario tiene un vínculo activo (HU-19 / HU-20)
async function recintosDelUsuario(usuarioId) {
  const { rows } = await query(
    `SELECT re.id AS recinto_id, re.nombre, re.comuna, un.identificador AS unidad
     FROM usuario_recinto ur
     JOIN recintos re ON re.id = ur.recinto_id
     LEFT JOIN unidades un ON un.id = ur.unidad_id
     WHERE ur.usuario_id = $1 AND ur.activo AND re.activo
     ORDER BY re.nombre`,
    [usuarioId]
  );
  return rows;
}

// Datos públicos del usuario y del recinto con el que está trabajando (nunca se devuelve el hash)
function formatearUsuario(fila, recinto) {
  return {
    id: fila.id,
    nombre: `${fila.nombre} ${fila.apellido}`.trim(),
    email: fila.email,
    rol: fila.rol,
    recinto_id: recinto ? recinto.recinto_id : null,
    recinto_nombre: recinto ? recinto.nombre : null,
    unidad: recinto ? recinto.unidad : null,
  };
}

function firmarToken(usuario, recintoId) {
  return jwt.sign({ id: usuario.id, rol: usuario.rol, recinto_id: recintoId || null }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

// Respuesta común de login y de cambio de recinto
function respuestaSesion(usuario, recintos, recinto) {
  return {
    token: firmarToken(usuario, recinto && recinto.recinto_id),
    usuario: formatearUsuario(usuario, recinto),
    recintos,
    // true si pertenece a varios recintos y todavía no eligió uno
    requiere_seleccion: usuario.rol !== ROLES.ADMIN_PLATAFORMA && !recinto,
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

  let recintos = [];
  let recinto = null;
  if (usuario.rol !== ROLES.ADMIN_PLATAFORMA) {
    recintos = await recintosDelUsuario(usuario.id);
    if (recintos.length === 0) {
      throw new HttpError(403, 'No tienes acceso activo a ningún recinto. Contacta al administrador.');
    }
    // Con un solo recinto se entra directo; con varios, el usuario elige (HU-20)
    if (recintos.length === 1) recinto = recintos[0];
  }

  await query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [usuario.id]);
  return respuestaSesion(usuario, recintos, recinto);
}

// Elegir (o cambiar) el recinto de trabajo: entrega un token nuevo con ese recinto
async function seleccionarRecinto(actor, recintoId) {
  const { rows } = await query(`${SQL_USUARIO} WHERE u.id = $1`, [actor.id]);
  const usuario = rows[0];
  if (usuario.rol === ROLES.ADMIN_PLATAFORMA) {
    throw new HttpError(400, 'El administrador de plataforma no trabaja dentro de un recinto');
  }
  const recintos = await recintosDelUsuario(usuario.id);
  const recinto = recintos.find((r) => r.recinto_id === recintoId);
  if (!recinto) throw new HttpError(403, 'No tienes acceso a ese recinto');
  return respuestaSesion(usuario, recintos, recinto);
}

// Datos actualizados del usuario del token
async function obtenerUsuarioActual(actor) {
  const { rows } = await query(`${SQL_USUARIO} WHERE u.id = $1`, [actor.id]);
  const usuario = rows[0];
  if (!usuario || !usuario.activo) {
    throw new HttpError(401, 'Sesión no válida');
  }
  const recintos = usuario.rol === ROLES.ADMIN_PLATAFORMA ? [] : await recintosDelUsuario(usuario.id);
  const recinto = recintos.find((r) => r.recinto_id === actor.recinto_id) || null;
  return { usuario: formatearUsuario(usuario, recinto), recintos };
}

module.exports = { login, seleccionarRecinto, obtenerUsuarioActual };
