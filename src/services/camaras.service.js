// Servicio de cámaras IP del recinto del usuario
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { construirUpdate } = require('../utils/sql');

const CAMPOS_EDITABLES = ['nombre', 'ubicacion', 'sentido', 'ip', 'url_stream', 'estado', 'dispositivo_id'];

const SQL_CAMARAS = `
  SELECT c.*, d.nombre AS dispositivo_nombre, d.estado AS dispositivo_estado
  FROM camaras c
  LEFT JOIN dispositivos d ON d.id = c.dispositivo_id
`;

async function listar(recintoId) {
  const { rows } = await query(`${SQL_CAMARAS} WHERE c.recinto_id = $1 ORDER BY c.nombre`, [recintoId]);
  return rows;
}

async function obtener(recintoId, id) {
  const { rows } = await query(`${SQL_CAMARAS} WHERE c.id = $1 AND c.recinto_id = $2`, [id, recintoId]);
  if (!rows[0]) throw new HttpError(404, 'Cámara no encontrada');
  return rows[0];
}

// El dispositivo asignado debe ser del mismo recinto
async function validarDispositivo(recintoId, dispositivoId) {
  if (!dispositivoId) return;
  const { rows } = await query('SELECT 1 FROM dispositivos WHERE id = $1 AND recinto_id = $2', [dispositivoId, recintoId]);
  if (!rows[0]) throw new HttpError(400, 'El dispositivo no pertenece a este recinto');
}

async function crear(recintoId, datos) {
  await validarDispositivo(recintoId, datos.dispositivo_id);
  const { rows } = await query(
    `INSERT INTO camaras (recinto_id, dispositivo_id, nombre, ubicacion, sentido, ip, url_stream, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'activa')) RETURNING id`,
    [recintoId, datos.dispositivo_id || null, datos.nombre, datos.ubicacion, datos.sentido,
      datos.ip, datos.url_stream, datos.estado]
  );
  return obtener(recintoId, rows[0].id);
}

async function actualizar(recintoId, id, datos) {
  await validarDispositivo(recintoId, datos.dispositivo_id);
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const { rowCount } = await query(
    `UPDATE camaras SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, recintoId, ...update.valores]
  );
  if (rowCount === 0) throw new HttpError(404, 'Cámara no encontrada');
  return obtener(recintoId, id);
}

// Si la cámara ya registró accesos, la BD lo impide (se responde 409 y se sugiere desactivarla)
async function eliminar(recintoId, id) {
  const { rowCount } = await query('DELETE FROM camaras WHERE id = $1 AND recinto_id = $2', [id, recintoId]);
  if (rowCount === 0) throw new HttpError(404, 'Cámara no encontrada');
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
