// Servicio de cámaras IP del recinto de la sesión
//
// Cámara y Raspberry Pi tienen una relación 1 a 1, pero ninguna es obligatoria para registrar la otra:
// una cámara sin equipo queda "pendiente de asignación" y no se puede usar (no registra accesos
// ni aparece en el monitor del guardia). Solo una cámara con su Raspberry Pi está operativa.
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { construirUpdate } = require('../utils/sql');
const auditoria = require('./auditoria.service');

const CAMPOS_EDITABLES = ['nombre', 'ubicacion', 'sentido', 'ip', 'url_stream', 'estado', 'dispositivo_id'];

const SQL_CAMARAS = `
  SELECT c.*, d.nombre AS dispositivo_nombre, d.identificador AS dispositivo_identificador,
         d.estado AS dispositivo_estado, (c.dispositivo_id IS NOT NULL) AS asignada
  FROM camaras c
  LEFT JOIN dispositivos d ON d.id = c.dispositivo_id
`;

const resumen = (c) => c && Object.fromEntries(CAMPOS_EDITABLES.map((k) => [k, c[k]]));

// El guardia solo ve las cámaras operativas (con su Raspberry Pi); el admin las ve todas
async function listar(actor) {
  const soloAsignadas = actor.rol !== ROLES.ADMIN_RECINTO;
  const { rows } = await query(
    `${SQL_CAMARAS} WHERE c.recinto_id = $1 ${soloAsignadas ? 'AND c.dispositivo_id IS NOT NULL' : ''} ORDER BY c.nombre`,
    [actor.recinto_id]
  );
  return rows;
}

async function obtener(actor, id) {
  const { rows } = await query(`${SQL_CAMARAS} WHERE c.id = $1 AND c.recinto_id = $2`, [id, actor.recinto_id]);
  if (!rows[0]) throw new HttpError(404, 'Cámara no encontrada');
  return rows[0];
}

// El equipo debe ser del mismo recinto y no estar asignado a otra cámara (relación 1 a 1)
async function validarDispositivo(recintoId, dispositivoId, camaraId = null) {
  if (!dispositivoId) return;
  const { rows } = await query(
    `SELECT d.nombre, c.id AS camara_id, c.nombre AS camara_nombre
     FROM dispositivos d LEFT JOIN camaras c ON c.dispositivo_id = d.id
     WHERE d.id = $1 AND d.recinto_id = $2`,
    [dispositivoId, recintoId]
  );
  if (!rows[0]) throw new HttpError(400, 'El equipo no pertenece a este recinto');
  if (rows[0].camara_id && rows[0].camara_id !== camaraId) {
    throw new HttpError(409, `El equipo "${rows[0].nombre}" ya está asignado a la cámara "${rows[0].camara_nombre}". Cada Raspberry Pi atiende una sola cámara.`);
  }
}

const detalleAsignacion = (c) => c.nombre + (c.asignada ? ` (equipo ${c.dispositivo_nombre})` : ' (pendiente de asignación)');

async function crear(actor, datos) {
  await validarDispositivo(actor.recinto_id, datos.dispositivo_id);
  const { rows } = await query(
    `INSERT INTO camaras (recinto_id, dispositivo_id, nombre, ubicacion, sentido, ip, url_stream, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'activa')) RETURNING id`,
    [actor.recinto_id, datos.dispositivo_id || null, datos.nombre, datos.ubicacion, datos.sentido,
      datos.ip, datos.url_stream, datos.estado]
  );
  const camara = await obtener(actor, rows[0].id);
  await auditoria.registrar(actor, { accion: 'crear', entidad: 'camaras', entidadId: camara.id, despues: resumen(camara), detalle: detalleAsignacion(camara) });
  return camara;
}

async function actualizar(actor, id, datos) {
  await validarDispositivo(actor.recinto_id, datos.dispositivo_id, id);
  const update = construirUpdate(datos, CAMPOS_EDITABLES, 3);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  const anterior = await obtener(actor, id);
  await query(
    `UPDATE camaras SET ${update.set} WHERE id = $1 AND recinto_id = $2`,
    [id, actor.recinto_id, ...update.valores]
  );
  const camara = await obtener(actor, id);
  await auditoria.registrar(actor, { accion: 'editar', entidad: 'camaras', entidadId: id, antes: resumen(anterior), despues: resumen(camara), detalle: detalleAsignacion(camara) });
  return camara;
}

// Si la cámara ya registró accesos, la BD lo impide (se responde 409 y se sugiere desactivarla)
async function eliminar(actor, id) {
  const camara = await obtener(actor, id);
  await query('DELETE FROM camaras WHERE id = $1 AND recinto_id = $2', [id, actor.recinto_id]);
  await auditoria.registrar(actor, { accion: 'eliminar', entidad: 'camaras', entidadId: id, antes: resumen(camara), detalle: camara.nombre });
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
