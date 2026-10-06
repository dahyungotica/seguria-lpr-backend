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

// ----- Llamadas de la propia Raspberry Pi (autenticada con API key) -----

// Busca el equipo por su identificador y compara la API key con el hash guardado
async function autenticar(identificador, apiKey) {
  const { rows } = await query(
    `SELECT d.id, d.recinto_id, d.nombre, d.api_key_hash, re.activo AS recinto_activo
     FROM dispositivos d JOIN recintos re ON re.id = d.recinto_id
     WHERE d.identificador = $1`,
    [identificador]
  );
  const dispositivo = rows[0];
  const valida = dispositivo && (await bcrypt.compare(apiKey, dispositivo.api_key_hash));
  if (!valida) throw new HttpError(401, 'Credenciales de dispositivo inválidas');
  if (!dispositivo.recinto_activo) throw new HttpError(403, 'El recinto está desactivado');
  return { id: dispositivo.id, recinto_id: dispositivo.recinto_id, nombre: dispositivo.nombre };
}

// Señal de vida: el equipo avisa que sigue conectado
async function heartbeat(dispositivo, ip) {
  await query(
    "UPDATE dispositivos SET ultimo_heartbeat = NOW(), estado = 'activo', ip = COALESCE($2, ip) WHERE id = $1",
    [dispositivo.id, ip || null]
  );
  return { ok: true, hora_servidor: new Date().toISOString() };
}

// Lista de patentes autorizadas del recinto para la copia local de la Raspberry Pi
async function obtenerPatentes(dispositivo) {
  const { rows } = await query(
    `SELECT patente, origen, vigente_hasta FROM vw_patentes_autorizadas
     WHERE recinto_id = $1 ORDER BY patente`,
    [dispositivo.recinto_id]
  );
  await query('UPDATE dispositivos SET ultima_sincronizacion = NOW() WHERE id = $1', [dispositivo.id]);
  await query(
    "INSERT INTO sincronizaciones (dispositivo_id, registros_enviados, estado) VALUES ($1, $2, 'ok')",
    [dispositivo.id, rows.length]
  );
  return { generado: new Date().toISOString(), total: rows.length, patentes: rows };
}

module.exports = {
  listar, obtener, crear, actualizar, eliminar, regenerarApiKey,
  autenticar, heartbeat, obtenerPatentes,
};
