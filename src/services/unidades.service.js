// Servicio de unidades (departamentos, casas, oficinas) del recinto de la sesión
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { construirUpdate } = require('../utils/sql');
const auditoria = require('./auditoria.service');

const CAMPOS_EDITABLES = ['identificador', 'tipo', 'activo'];

const SQL_UNIDADES = `
  SELECT un.*,
    (SELECT COUNT(*) FROM usuario_recinto ur WHERE ur.unidad_id = un.id)::int AS total_propietarios
  FROM unidades un
`;

const resumen = (u) => u && { identificador: u.identificador, tipo: u.tipo, activo: u.activo };

async function listar(actor) {
  const { rows } = await query(
    `${SQL_UNIDADES} WHERE un.recinto_id = $1 ORDER BY un.identificador`,
    [actor.recinto_id]
  );
  return rows;
}

async function obtener(actor, id) {
  const { rows } = await query(`${SQL_UNIDADES} WHERE un.id = $1 AND un.recinto_id = $2`, [id, actor.recinto_id]);
  if (!rows[0]) throw new HttpError(404, 'Unidad no encontrada');
  return rows[0];
}

async function crear(actor, datos) {
  const { rows } = await query(
    'INSERT INTO unidades (recinto_id, identificador, tipo) VALUES ($1, $2, $3) RETURNING id',
    [actor.recinto_id, datos.identificador, datos.tipo]
  );
  const unidad = await obtener(actor, rows[0].id);
  await auditoria.registrar(actor, { accion: 'crear', entidad: 'unidades', entidadId: unidad.id, despues: resumen(unidad), detalle: unidad.identificador });
  return unidad;
}

async function actualizar(actor, id, datos) {
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const anterior = await obtener(actor, id);
  await query(
    `UPDATE unidades SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, actor.recinto_id, ...update.valores]
  );
  const unidad = await obtener(actor, id);
  await auditoria.registrar(actor, { accion: 'editar', entidad: 'unidades', entidadId: id, antes: resumen(anterior), despues: resumen(unidad), detalle: unidad.identificador });
  return unidad;
}

// Solo se elimina si no tiene propietarios (si no, conviene desactivarla)
async function eliminar(actor, id) {
  const unidad = await obtener(actor, id);
  if (unidad.total_propietarios > 0) {
    throw new HttpError(409, 'La unidad tiene propietarios asignados. Reasígnalos o desactiva la unidad.');
  }
  await query('DELETE FROM unidades WHERE id = $1 AND recinto_id = $2', [id, actor.recinto_id]);
  await auditoria.registrar(actor, { accion: 'eliminar', entidad: 'unidades', entidadId: id, antes: resumen(unidad), detalle: unidad.identificador });
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
