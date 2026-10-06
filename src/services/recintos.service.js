// Servicio de recintos: lo gestiona el admin de plataforma
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { construirUpdate, Filtros } = require('../utils/sql');

const CAMPOS_EDITABLES = ['nombre', 'direccion', 'comuna', 'region', 'tipo', 'telefono'];

// Recintos con contadores útiles para el listado
const SQL_RECINTOS = `
  SELECT r.*,
    (SELECT COUNT(*) FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
      WHERE u.recinto_id = r.id AND ro.nombre = '${ROLES.ADMIN_RECINTO}')::int AS total_administradores,
    (SELECT COUNT(*) FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
      WHERE u.recinto_id = r.id AND ro.nombre = '${ROLES.PROPIETARIO}')::int AS total_propietarios,
    (SELECT COUNT(*) FROM camaras c WHERE c.recinto_id = r.id)::int AS total_camaras
  FROM recintos r
`;

async function listar({ busqueda, activo }) {
  const f = new Filtros();
  if (busqueda) {
    f.agregar("(r.nombre ILIKE '%' || ? || '%' OR r.comuna ILIKE '%' || ? || '%')", busqueda, busqueda);
  }
  if (activo !== undefined) f.agregar('r.activo = ?', activo);

  const { rows } = await query(`${SQL_RECINTOS} ${f.where} ORDER BY r.nombre`, f.valores);
  return rows;
}

// El admin de recinto solo puede ver su propio recinto
async function obtener(usuario, id) {
  if (usuario.rol === ROLES.ADMIN_RECINTO && usuario.recinto_id !== id) {
    throw new HttpError(403, 'No tienes permiso para ver este recinto');
  }

  const { rows } = await query(`${SQL_RECINTOS} WHERE r.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Recinto no encontrado');
  return rows[0];
}

async function crear(datos) {
  const { rows } = await query(
    `INSERT INTO recintos (nombre, direccion, comuna, region, tipo, telefono)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [datos.nombre, datos.direccion, datos.comuna, datos.region, datos.tipo, datos.telefono]
  );
  return obtener({ rol: ROLES.ADMIN_PLATAFORMA }, rows[0].id);
}

async function actualizar(id, datos) {
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 2);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const { rowCount } = await query(`UPDATE recintos SET ${update.set} WHERE id = $1`, [id, ...update.valores]);
  if (rowCount === 0) throw new HttpError(404, 'Recinto no encontrado');
  return obtener({ rol: ROLES.ADMIN_PLATAFORMA }, id);
}

// Desactivar un recinto bloquea el ingreso de todos sus usuarios
async function cambiarEstado(id, activo) {
  const { rowCount } = await query('UPDATE recintos SET activo = $2 WHERE id = $1', [id, activo]);
  if (rowCount === 0) throw new HttpError(404, 'Recinto no encontrado');
  return obtener({ rol: ROLES.ADMIN_PLATAFORMA }, id);
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
