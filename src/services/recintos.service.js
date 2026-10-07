// Servicio de recintos: lo gestiona el admin de plataforma
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { construirUpdate, Filtros } = require('../utils/sql');
const auditoria = require('./auditoria.service');

const CAMPOS_EDITABLES = ['nombre', 'direccion', 'comuna', 'region', 'tipo', 'telefono'];

// Cuenta las personas que tienen ese rol en el recinto
const contarRol = (rol) => `(SELECT COUNT(*) FROM usuario_recinto ur
      JOIN roles ro ON ro.id = ur.rol_id WHERE ur.recinto_id = r.id AND ro.nombre = '${rol}')::int`;

// Recintos con contadores útiles para el listado
const SQL_RECINTOS = `
  SELECT r.*,
    ${contarRol(ROLES.ADMIN_RECINTO)} AS total_administradores,
    ${contarRol(ROLES.PROPIETARIO)} AS total_propietarios,
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

// El admin de recinto solo puede ver el recinto de su sesión
async function obtener(usuario, id) {
  if (usuario.rol !== ROLES.ADMIN_PLATAFORMA && usuario.recinto_id !== id) {
    throw new HttpError(403, 'No tienes permiso para ver este recinto');
  }

  const { rows } = await query(`${SQL_RECINTOS} WHERE r.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Recinto no encontrado');
  return rows[0];
}

const resumen = (r) => r && Object.fromEntries([...CAMPOS_EDITABLES, 'activo'].map((c) => [c, r[c]]));

// Las acciones sobre recintos son de plataforma: se auditan sin recinto (recinto_id NULL)
async function crear(actor, datos) {
  const { rows } = await query(
    `INSERT INTO recintos (nombre, direccion, comuna, region, tipo, telefono)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [datos.nombre, datos.direccion, datos.comuna, datos.region, datos.tipo, datos.telefono]
  );
  const recinto = await obtener(actor, rows[0].id);
  await auditoria.registrar(actor, { accion: 'crear', entidad: 'recintos', entidadId: recinto.id, recintoId: null, despues: resumen(recinto), detalle: recinto.nombre });
  return recinto;
}

async function actualizar(actor, id, datos) {
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 2);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const anterior = await obtener(actor, id);
  await query(`UPDATE recintos SET ${update.set} WHERE id = $1`, [id, ...update.valores]);
  const recinto = await obtener(actor, id);
  await auditoria.registrar(actor, { accion: 'editar', entidad: 'recintos', entidadId: id, recintoId: null, antes: resumen(anterior), despues: resumen(recinto), detalle: recinto.nombre });
  return recinto;
}

// Desactivar un recinto bloquea el ingreso de todos sus usuarios
async function cambiarEstado(actor, id, activo) {
  const anterior = await obtener(actor, id);
  await query('UPDATE recintos SET activo = $2 WHERE id = $1', [id, activo]);
  const recinto = await obtener(actor, id);
  await auditoria.registrar(actor, {
    accion: activo ? 'activar' : 'desactivar', entidad: 'recintos', entidadId: id, recintoId: null,
    antes: { activo: anterior.activo }, despues: { activo }, detalle: recinto.nombre,
  });
  return recinto;
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
