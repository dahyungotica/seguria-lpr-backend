// Servicio de dispositivos (Raspberry Pi) del recinto de la sesión
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { construirUpdate } = require('../utils/sql');
const auditoria = require('./auditoria.service');

const CAMPOS_EDITABLES = ['nombre', 'identificador', 'ip', 'estado'];

// Nunca se devuelve api_key_hash. Cada equipo atiende UNA cámara (o ninguna: pendiente de asignación).
const SQL_DISPOSITIVOS = `
  SELECT d.id, d.recinto_id, d.nombre, d.identificador, d.ip, d.estado,
         d.ultima_sincronizacion, d.ultimo_heartbeat, d.created_at, d.updated_at,
         c.id AS camara_id, c.nombre AS camara_nombre, c.sentido AS camara_sentido
  FROM dispositivos d
  LEFT JOIN camaras c ON c.dispositivo_id = d.id
`;

// Genera una API key aleatoria y su hash. La key en claro se muestra UNA sola vez.
async function generarApiKey() {
  const apiKey = crypto.randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(apiKey, 10);
  return { apiKey, hash };
}

const resumen = (d) => d && { nombre: d.nombre, identificador: d.identificador, ip: d.ip, estado: d.estado };

async function listar(actor) {
  const { rows } = await query(`${SQL_DISPOSITIVOS} WHERE d.recinto_id = $1 ORDER BY d.nombre`, [actor.recinto_id]);
  return rows;
}

async function obtener(actor, id) {
  const { rows } = await query(`${SQL_DISPOSITIVOS} WHERE d.id = $1 AND d.recinto_id = $2`, [id, actor.recinto_id]);
  if (!rows[0]) throw new HttpError(404, 'Dispositivo no encontrado');
  return rows[0];
}

async function crear(actor, datos) {
  const { apiKey, hash } = await generarApiKey();
  const { rows } = await query(
    `INSERT INTO dispositivos (recinto_id, nombre, identificador, api_key_hash, ip)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [actor.recinto_id, datos.nombre, datos.identificador, hash, datos.ip]
  );
  const dispositivo = await obtener(actor, rows[0].id);
  await auditoria.registrar(actor, { accion: 'crear', entidad: 'dispositivos', entidadId: dispositivo.id, despues: resumen(dispositivo), detalle: dispositivo.nombre });
  return { dispositivo, api_key: apiKey };
}

async function actualizar(actor, id, datos) {
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const anterior = await obtener(actor, id);
  await query(
    `UPDATE dispositivos SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, actor.recinto_id, ...update.valores]
  );
  const dispositivo = await obtener(actor, id);
  await auditoria.registrar(actor, { accion: 'editar', entidad: 'dispositivos', entidadId: id, antes: resumen(anterior), despues: resumen(dispositivo), detalle: dispositivo.nombre });
  return dispositivo;
}

// Al eliminarlo, su cámara queda pendiente de asignación y los accesos se conservan
async function eliminar(actor, id) {
  const dispositivo = await obtener(actor, id);
  await query('DELETE FROM dispositivos WHERE id = $1 AND recinto_id = $2', [id, actor.recinto_id]);
  await auditoria.registrar(actor, { accion: 'eliminar', entidad: 'dispositivos', entidadId: id, antes: resumen(dispositivo), detalle: dispositivo.nombre });
}

// Invalida la key anterior (por ejemplo, si se filtró o se reinstaló el equipo)
async function regenerarApiKey(actor, id) {
  const dispositivo = await obtener(actor, id);
  const { apiKey, hash } = await generarApiKey();
  await query('UPDATE dispositivos SET api_key_hash = $3 WHERE id = $1 AND recinto_id = $2', [id, actor.recinto_id, hash]);
  // Se registra el cambio, nunca la clave
  await auditoria.registrar(actor, { accion: 'regenerar_clave', entidad: 'dispositivos', entidadId: id, detalle: `Nueva API key para ${dispositivo.nombre}` });
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
