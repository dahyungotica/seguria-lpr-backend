// Servicio de unidades (departamentos, casas, oficinas) del recinto del usuario
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { construirUpdate } = require('../utils/sql');

const CAMPOS_EDITABLES = ['identificador', 'tipo', 'activo'];

const SQL_UNIDADES = `
  SELECT un.*,
    (SELECT COUNT(*) FROM usuarios u WHERE u.unidad_id = un.id)::int AS total_propietarios
  FROM unidades un
`;

async function listar(recintoId) {
  const { rows } = await query(
    `${SQL_UNIDADES} WHERE un.recinto_id = $1 ORDER BY un.identificador`,
    [recintoId]
  );
  return rows;
}

async function obtener(recintoId, id) {
  const { rows } = await query(`${SQL_UNIDADES} WHERE un.id = $1 AND un.recinto_id = $2`, [id, recintoId]);
  if (!rows[0]) throw new HttpError(404, 'Unidad no encontrada');
  return rows[0];
}

async function crear(recintoId, datos) {
  const { rows } = await query(
    'INSERT INTO unidades (recinto_id, identificador, tipo) VALUES ($1, $2, $3) RETURNING id',
    [recintoId, datos.identificador, datos.tipo]
  );
  return obtener(recintoId, rows[0].id);
}

async function actualizar(recintoId, id, datos) {
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const { rowCount } = await query(
    `UPDATE unidades SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, recintoId, ...update.valores]
  );
  if (rowCount === 0) throw new HttpError(404, 'Unidad no encontrada');
  return obtener(recintoId, id);
}

// Solo se elimina si no tiene propietarios (si no, conviene desactivarla)
async function eliminar(recintoId, id) {
  const unidad = await obtener(recintoId, id);
  if (unidad.total_propietarios > 0) {
    throw new HttpError(409, 'La unidad tiene propietarios asignados. Reasígnalos o desactiva la unidad.');
  }
  await query('DELETE FROM unidades WHERE id = $1 AND recinto_id = $2', [id, recintoId]);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
