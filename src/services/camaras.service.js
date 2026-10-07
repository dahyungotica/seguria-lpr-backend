// Servicio de cámaras IP del recinto de la sesión
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { construirUpdate } = require('../utils/sql');
const auditoria = require('./auditoria.service');

const CAMPOS_EDITABLES = ['nombre', 'ubicacion', 'sentido', 'ip', 'url_stream', 'estado', 'dispositivo_id'];

const SQL_CAMARAS = `
  SELECT c.*, d.nombre AS dispositivo_nombre, d.estado AS dispositivo_estado
  FROM camaras c
  LEFT JOIN dispositivos d ON d.id = c.dispositivo_id
`;

const resumen = (c) => c && Object.fromEntries(CAMPOS_EDITABLES.map((k) => [k, c[k]]));

async function listar(actor) {
  const { rows } = await query(`${SQL_CAMARAS} WHERE c.recinto_id = $1 ORDER BY c.nombre`, [actor.recinto_id]);
  return rows;
}

async function obtener(actor, id) {
  const { rows } = await query(`${SQL_CAMARAS} WHERE c.id = $1 AND c.recinto_id = $2`, [id, actor.recinto_id]);
  if (!rows[0]) throw new HttpError(404, 'Cámara no encontrada');
  return rows[0];
}

// El dispositivo asignado debe ser del mismo recinto
async function validarDispositivo(recintoId, dispositivoId) {
  if (!dispositivoId) return;
  const { rows } = await query('SELECT 1 FROM dispositivos WHERE id = $1 AND recinto_id = $2', [dispositivoId, recintoId]);
  if (!rows[0]) throw new HttpError(400, 'El dispositivo no pertenece a este recinto');
}

async function crear(actor, datos) {
  await validarDispositivo(actor.recinto_id, datos.dispositivo_id);
  const { rows } = await query(
    `INSERT INTO camaras (recinto_id, dispositivo_id, nombre, ubicacion, sentido, ip, url_stream, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'activa')) RETURNING id`,
    [actor.recinto_id, datos.dispositivo_id || null, datos.nombre, datos.ubicacion, datos.sentido,
      datos.ip, datos.url_stream, datos.estado]
  );
  const camara = await obtener(actor, rows[0].id);
  await auditoria.registrar(actor, { accion: 'crear', entidad: 'camaras', entidadId: camara.id, despues: resumen(camara), detalle: camara.nombre });
  return camara;
}

async function actualizar(actor, id, datos) {
  await validarDispositivo(actor.recinto_id, datos.dispositivo_id);
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const anterior = await obtener(actor, id);
  await query(
    `UPDATE camaras SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, actor.recinto_id, ...update.valores]
  );
  const camara = await obtener(actor, id);
  await auditoria.registrar(actor, { accion: 'editar', entidad: 'camaras', entidadId: id, antes: resumen(anterior), despues: resumen(camara), detalle: camara.nombre });
  return camara;
}

// Si la cámara ya registró accesos, la BD lo impide (se responde 409 y se sugiere desactivarla)
async function eliminar(actor, id) {
  const camara = await obtener(actor, id);
  await query('DELETE FROM camaras WHERE id = $1 AND recinto_id = $2', [id, actor.recinto_id]);
  await auditoria.registrar(actor, { accion: 'eliminar', entidad: 'camaras', entidadId: id, antes: resumen(camara), detalle: camara.nombre });
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
