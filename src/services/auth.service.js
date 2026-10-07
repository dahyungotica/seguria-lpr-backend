// Lógica de autenticación: validar credenciales, elegir portal (recinto + rol), generar JWT y obtener el usuario actual
//
// Una persona tiene una sola cuenta (un email y una contraseña) aunque cumpla varios roles:
// por ejemplo, administradora de 3 recintos, guardia en 2 y propietaria en 1.
// Cada combinación recinto + rol es un "portal". Con un solo portal se entra directo;
// con varios, la persona elige con cuál trabajar y puede cambiar después sin volver a iniciar sesión.
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

// Orden en que se muestran los roles dentro de cada recinto
const ORDEN_ROLES = [ROLES.ADMIN_RECINTO, ROLES.GUARDIA, ROLES.PROPIETARIO];

const SQL_USUARIO = `
  SELECT u.id, u.nombre, u.apellido, u.email, u.password_hash, u.activo, u.es_admin_plataforma
  FROM usuarios u
`;

// Recintos activos donde la persona tiene algún rol activo, con sus roles en cada uno:
// [{ recinto_id, nombre, comuna, roles: [{ rol, unidad }] }]
async function recintosDelUsuario(usuarioId) {
  const { rows } = await query(
    `SELECT re.id AS recinto_id, re.nombre, re.comuna, r.nombre AS rol, un.identificador AS unidad
     FROM usuario_recinto ur
     JOIN roles r ON r.id = ur.rol_id
     JOIN recintos re ON re.id = ur.recinto_id
     LEFT JOIN unidades un ON un.id = ur.unidad_id
     WHERE ur.usuario_id = $1 AND ur.activo AND re.activo
     ORDER BY re.nombre, re.id`,
    [usuarioId]
  );
  const recintos = [];
  for (const fila of rows) {
    let recinto = recintos.find((r) => r.recinto_id === fila.recinto_id);
    if (!recinto) {
      recinto = { recinto_id: fila.recinto_id, nombre: fila.nombre, comuna: fila.comuna, roles: [] };
      recintos.push(recinto);
    }
    recinto.roles.push({ rol: fila.rol, unidad: fila.unidad });
  }
  for (const r of recintos) r.roles.sort((a, b) => ORDEN_ROLES.indexOf(a.rol) - ORDEN_ROLES.indexOf(b.rol));
  return recintos;
}

// Cantidad total de portales (recinto + rol)
const totalPortales = (recintos) => recintos.reduce((suma, r) => suma + r.roles.length, 0);

// Busca el portal pedido. Si no se indica el rol y en ese recinto tiene uno solo, se usa ese.
function buscarPortal(recintos, recintoId, rol) {
  const recinto = recintos.find((r) => r.recinto_id === recintoId);
  if (!recinto) return null;
  const elegido = rol ? recinto.roles.find((x) => x.rol === rol) : recinto.roles.length === 1 ? recinto.roles[0] : null;
  return elegido ? { recinto, rol: elegido.rol, unidad: elegido.unidad } : null;
}

// Datos públicos del usuario y del portal con el que está trabajando (nunca se devuelve el hash)
function formatearUsuario(fila, portal) {
  return {
    id: fila.id,
    nombre: `${fila.nombre} ${fila.apellido}`.trim(),
    email: fila.email,
    rol: fila.es_admin_plataforma ? ROLES.ADMIN_PLATAFORMA : portal ? portal.rol : null,
    recinto_id: portal ? portal.recinto.recinto_id : null,
    recinto_nombre: portal ? portal.recinto.nombre : null,
    unidad: portal ? portal.unidad : null,
  };
}

// Respuesta común de login y de cambio de portal
function respuestaSesion(fila, recintos, portal) {
  const usuario = formatearUsuario(fila, portal);
  return {
    token: jwt.sign({ id: usuario.id, rol: usuario.rol, recinto_id: usuario.recinto_id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    }),
    usuario,
    recintos,
    // true si tiene más de un rol o recinto y todavía no eligió con cuál trabajar
    requiere_seleccion: !usuario.rol,
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
  let portal = null;
  if (!usuario.es_admin_plataforma) {
    recintos = await recintosDelUsuario(usuario.id);
    if (recintos.length === 0) {
      throw new HttpError(403, 'No tienes acceso activo a ningún recinto. Contacta al administrador.');
    }
    // Con un solo portal se entra directo; con varios, la persona elige (HU-19 / HU-20)
    if (totalPortales(recintos) === 1) portal = buscarPortal(recintos, recintos[0].recinto_id);
  }

  await query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [usuario.id]);
  return respuestaSesion(usuario, recintos, portal);
}

// Elegir (o cambiar) el portal de trabajo: entrega un token nuevo con ese recinto y rol
async function seleccionarRecinto(actor, recintoId, rol) {
  const { rows } = await query(`${SQL_USUARIO} WHERE u.id = $1`, [actor.id]);
  const usuario = rows[0];
  if (usuario.es_admin_plataforma) {
    throw new HttpError(400, 'El administrador de plataforma no trabaja dentro de un recinto');
  }
  const recintos = await recintosDelUsuario(usuario.id);
  const portal = buscarPortal(recintos, recintoId, rol);
  if (!portal) {
    const recinto = recintos.find((r) => r.recinto_id === recintoId);
    throw new HttpError(recinto && !rol ? 400 : 403, recinto && !rol ? 'Indica con qué rol vas a entrar' : 'No tienes acceso a ese recinto con ese rol');
  }
  return respuestaSesion(usuario, recintos, portal);
}

// Datos actualizados del usuario del token y sus portales disponibles
async function obtenerUsuarioActual(actor) {
  const { rows } = await query(`${SQL_USUARIO} WHERE u.id = $1`, [actor.id]);
  const usuario = rows[0];
  if (!usuario || !usuario.activo) {
    throw new HttpError(401, 'Sesión no válida');
  }
  const recintos = usuario.es_admin_plataforma ? [] : await recintosDelUsuario(usuario.id);
  const portal = actor.recinto_id ? buscarPortal(recintos, actor.recinto_id, actor.rol) : null;
  return { usuario: formatearUsuario(usuario, portal), recintos };
}

module.exports = { login, seleccionarRecinto, obtenerUsuarioActual, recintosDelUsuario };
