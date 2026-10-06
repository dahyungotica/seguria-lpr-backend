// Servicio de usuarios
//  - admin_plataforma: gestiona administradores de recinto (de cualquier recinto).
//  - admin_recinto:    gestiona propietarios y guardias de SU recinto.
//  - guardia:          solo consulta propietarios de su recinto.
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { construirUpdate, Filtros } = require('../utils/sql');
const { formatearRut } = require('../utils/rut');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');

// Roles que cada actor puede VER
const ROLES_VISIBLES = {
  [ROLES.ADMIN_PLATAFORMA]: [ROLES.ADMIN_RECINTO],
  [ROLES.ADMIN_RECINTO]: [ROLES.PROPIETARIO, ROLES.GUARDIA],
  [ROLES.GUARDIA]: [ROLES.PROPIETARIO],
};

// Roles que cada actor puede CREAR / EDITAR / DESACTIVAR
const ROLES_GESTIONABLES = {
  [ROLES.ADMIN_PLATAFORMA]: [ROLES.ADMIN_RECINTO],
  [ROLES.ADMIN_RECINTO]: [ROLES.PROPIETARIO, ROLES.GUARDIA],
};

const CAMPOS_EDITABLES = ['rut', 'nombre', 'apellido', 'email', 'telefono', 'recinto_id', 'unidad_id', 'password_hash'];

// Nunca se devuelve password_hash
const SQL_USUARIOS = `
  SELECT u.id, u.rut, u.nombre, u.apellido, u.email, u.telefono, u.activo, u.ultimo_login,
         u.created_at, u.recinto_id, u.unidad_id,
         r.nombre AS rol, re.nombre AS recinto_nombre, un.identificador AS unidad,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', v.id, 'patente', v.patente, 'marca', v.marca, 'modelo', v.modelo,
                    'color', v.color, 'tipo', v.tipo, 'activo', v.activo) ORDER BY v.patente)
           FROM vehiculos v WHERE v.propietario_id = u.id
         ), '[]') AS vehiculos
  FROM usuarios u
  JOIN roles r ON r.id = u.rol_id
  LEFT JOIN recintos re ON re.id = u.recinto_id
  LEFT JOIN unidades un ON un.id = u.unidad_id
`;

// Filtra por los roles indicados y, salvo el admin de plataforma, por el recinto del actor
function filtrosDeAlcance(actor, roles) {
  const f = new Filtros();
  f.agregar('r.nombre = ANY(?)', roles);
  if (actor.rol !== ROLES.ADMIN_PLATAFORMA) {
    f.agregar('u.recinto_id = ?', actor.recinto_id);
  }
  return f;
}

async function listar(actor, filtros) {
  const visibles = ROLES_VISIBLES[actor.rol] || [];
  const roles = filtros.rol ? visibles.filter((r) => r === filtros.rol) : visibles;
  const paginacion = obtenerPaginacion(filtros);
  const f = filtrosDeAlcance(actor, roles);

  if (filtros.busqueda) {
    // Busca por nombre, email, RUT, unidad o patente de alguno de sus vehículos
    f.agregar(
      `(u.nombre || ' ' || u.apellido ILIKE '%' || ? || '%'
        OR u.email ILIKE '%' || ? || '%'
        OR u.rut ILIKE '%' || ? || '%'
        OR un.identificador ILIKE '%' || ? || '%'
        OR EXISTS (SELECT 1 FROM vehiculos v WHERE v.propietario_id = u.id AND v.patente ILIKE '%' || ? || '%'))`,
      ...Array(5).fill(filtros.busqueda)
    );
  }
  if (filtros.activo !== undefined) f.agregar('u.activo = ?', filtros.activo);
  if (filtros.unidad_id) f.agregar('u.unidad_id = ?', filtros.unidad_id);
  if (filtros.recinto_id && actor.rol === ROLES.ADMIN_PLATAFORMA) {
    f.agregar('u.recinto_id = ?', filtros.recinto_id);
  }

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT x.*, COUNT(*) OVER() AS total_filas
     FROM (${SQL_USUARIOS} ${f.where}) x
     ORDER BY x.apellido, x.nombre
     LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  return respuestaPaginada(rows, paginacion);
}

async function obtener(actor, id) {
  const f = filtrosDeAlcance(actor, ROLES_VISIBLES[actor.rol] || []);
  f.agregar('u.id = ?', id);
  const { rows } = await query(`${SQL_USUARIOS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  return rows[0];
}

// Obtiene un usuario que el actor puede modificar (si no, 404 para no revelar que existe)
async function obtenerGestionable(actor, id) {
  const f = filtrosDeAlcance(actor, ROLES_GESTIONABLES[actor.rol] || []);
  f.agregar('u.id = ?', id);
  const { rows } = await query(`${SQL_USUARIOS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  return rows[0];
}

// Revisa que la unidad exista, esté activa y pertenezca al recinto
async function validarUnidad(unidadId, recintoId) {
  const { rows } = await query('SELECT activo FROM unidades WHERE id = $1 AND recinto_id = $2', [unidadId, recintoId]);
  if (!rows[0]) throw new HttpError(400, 'La unidad no pertenece a este recinto');
  if (!rows[0].activo) throw new HttpError(400, 'La unidad está desactivada');
}

async function validarRecinto(recintoId) {
  const { rows } = await query('SELECT 1 FROM recintos WHERE id = $1', [recintoId]);
  if (!rows[0]) throw new HttpError(400, 'El recinto no existe');
}

// Normaliza los datos que vienen del formulario
async function prepararDatos(datos) {
  const limpio = { ...datos };
  if (limpio.rut) limpio.rut = formatearRut(limpio.rut);
  if (limpio.email) limpio.email = limpio.email.toLowerCase();
  if (limpio.password) limpio.password_hash = await bcrypt.hash(limpio.password, 10);
  delete limpio.password;
  return limpio;
}

async function crear(actor, datos) {
  const permitidos = ROLES_GESTIONABLES[actor.rol] || [];
  if (!permitidos.includes(datos.rol)) {
    throw new HttpError(403, 'No puedes crear usuarios con ese rol');
  }

  // El admin de plataforma elige el recinto; el admin de recinto usa el suyo
  const recintoId = actor.rol === ROLES.ADMIN_PLATAFORMA ? datos.recinto_id : actor.recinto_id;
  if (!recintoId) throw new HttpError(400, 'Debes indicar el recinto');
  if (actor.rol === ROLES.ADMIN_PLATAFORMA) await validarRecinto(recintoId);

  const unidadId = datos.rol === ROLES.PROPIETARIO ? datos.unidad_id || null : null;
  if (datos.rol === ROLES.PROPIETARIO && !unidadId) {
    throw new HttpError(400, 'Debes asignar una unidad al propietario');
  }
  if (unidadId) await validarUnidad(unidadId, recintoId);

  const d = await prepararDatos(datos);
  const { rows } = await query(
    `INSERT INTO usuarios (rut, nombre, apellido, email, password_hash, telefono, rol_id, recinto_id, unidad_id)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM roles WHERE nombre = $7), $8, $9)
     RETURNING id`,
    [d.rut, d.nombre, d.apellido, d.email, d.password_hash, d.telefono || null, d.rol, recintoId, unidadId]
  );
  return obtener(actor, rows[0].id);
}

async function actualizar(actor, id, datos) {
  const actual = await obtenerGestionable(actor, id);
  const d = await prepararDatos(datos);

  // Solo el admin de plataforma puede mover un administrador a otro recinto
  if (actor.rol !== ROLES.ADMIN_PLATAFORMA) delete d.recinto_id;
  else if (d.recinto_id) await validarRecinto(d.recinto_id);

  // La unidad solo aplica a propietarios
  if (actual.rol !== ROLES.PROPIETARIO) delete d.unidad_id;
  else if (d.unidad_id !== undefined) {
    if (!d.unidad_id) throw new HttpError(400, 'El propietario debe tener una unidad');
    await validarUnidad(d.unidad_id, actual.recinto_id);
  }

  const update = construirUpdate(d, CAMPOS_EDITABLES, 2);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  await query(`UPDATE usuarios SET ${update.set} WHERE id = $1`, [id, ...update.valores]);
  return obtener(actor, id);
}

async function cambiarEstado(actor, id, activo) {
  if (id === actor.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta');
  await obtenerGestionable(actor, id);
  await query('UPDATE usuarios SET activo = $2 WHERE id = $1', [id, activo]);
  return obtener(actor, id);
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
