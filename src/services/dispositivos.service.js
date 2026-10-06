// Servicio de dispositivos (Raspberry Pi) del recinto del usuario
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { construirUpdate } = require('../utils/sql');

const CAMPOS_EDITABLES = ['nombre', 'identificador', 'ip', 'estado'];

// Nunca se devuelve api_key_hash
const SQL_DISPOSITIVOS = `
  SELECT d.id, d.recinto_id, d.nombre, d.identificador, d.ip, d.estado,
         d.ultima_sincronizacion, d.ultimo_heartbeat, d.created_at, d.updated_at,
         (SELECT COUNT(*) FROM camaras c WHERE c.dispositivo_id = d.id)::int AS total_camaras
  FROM dispositivos d
`;

// Genera una API key aleatoria y su hash. La key en claro se muestra UNA sola vez.
async function generarApiKey() {
  const apiKey = crypto.randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(apiKey, 10);
  return { apiKey, hash };
}

async function listar(recintoId) {
  const { rows } = await query(`${SQL_DISPOSITIVOS} WHERE d.recinto_id = $1 ORDER BY d.nombre`, [recintoId]);
  return rows;
}

async function obtener(recintoId, id) {
  const { rows } = await query(`${SQL_DISPOSITIVOS} WHERE d.id = $1 AND d.recinto_id = $2`, [id, recintoId]);
  if (!rows[0]) throw new HttpError(404, 'Dispositivo no encontrado');
  return rows[0];
}

async function crear(recintoId, datos) {
  const { apiKey, hash } = await generarApiKey();
  const { rows } = await query(
    `INSERT INTO dispositivos (recinto_id, nombre, identificador, api_key_hash, ip)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [recintoId, datos.nombre, datos.identificador, hash, datos.ip]
  );
  return { dispositivo: await obtener(recintoId, rows[0].id), api_key: apiKey };
}

async function actualizar(recintoId, id, datos) {
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const { rowCount } = await query(
    `UPDATE dispositivos SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, recintoId, ...update.valores]
  );
  if (rowCount === 0) throw new HttpError(404, 'Dispositivo no encontrado');
  return obtener(recintoId, id);
}

// Al eliminarlo, sus cámaras quedan sin dispositivo y los accesos se conservan
async function eliminar(recintoId, id) {
  const { rowCount } = await query('DELETE FROM dispositivos WHERE id = $1 AND recinto_id = $2', [id, recintoId]);
  if (rowCount === 0) throw new HttpError(404, 'Dispositivo no encontrado');
}

// Invalida la key anterior (por ejemplo, si se filtró o se reinstaló el equipo)
async function regenerarApiKey(recintoId, id) {
  await obtener(recintoId, id);
  const { apiKey, hash } = await generarApiKey();
  await query('UPDATE dispositivos SET api_key_hash = $3 WHERE id = $1 AND recinto_id = $2', [id, recintoId, hash]);
  return { api_key: apiKey };
}

module.exports = { listar, obtener, crear, actualizar, eliminar, regenerarApiKey };
