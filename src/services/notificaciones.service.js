// Servicio de notificaciones: cada usuario ve solo las que le fueron enviadas
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { Filtros } = require('../utils/sql');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const { emitirNotificacion } = require('../sockets');

const SQL_NOTIFICACIONES = `
  SELECT n.*, o.nombre || ' ' || o.apellido AS origen_nombre, un.identificador AS origen_unidad
  FROM notificaciones n
  LEFT JOIN usuarios o ON o.id = n.usuario_origen_id
  LEFT JOIN usuario_recinto our ON our.usuario_id = o.id AND our.recinto_id = n.recinto_id AND our.unidad_id IS NOT NULL
  LEFT JOIN unidades un ON un.id = our.unidad_id
`;

// Cada usuario ve las notificaciones que le enviaron en el recinto de su sesión
async function listar(actor, filtros) {
  const paginacion = obtenerPaginacion(filtros);
  const f = new Filtros();
  f.agregar('n.usuario_destino_id = ?', actor.id);
  f.agregar('n.recinto_id = ?', actor.recinto_id);
  if (filtros.leida !== undefined) f.agregar('n.leida = ?', filtros.leida);
  if (filtros.tipo) f.agregar('n.tipo = ?', filtros.tipo);

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT x.*, COUNT(*) OVER() AS total_filas
     FROM (${SQL_NOTIFICACIONES} ${f.where}) x
     ORDER BY x.created_at DESC
     LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  return respuestaPaginada(rows, paginacion);
}

async function contarNoLeidas(actor) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS total FROM notificaciones WHERE usuario_destino_id = $1 AND recinto_id = $2 AND NOT leida',
    [actor.id, actor.recinto_id]
  );
  return rows[0].total;
}

async function marcarLeida(actor, id) {
  const { rowCount } = await query(
    'UPDATE notificaciones SET leida = TRUE WHERE id = $1 AND usuario_destino_id = $2 AND recinto_id = $3',
    [id, actor.id, actor.recinto_id]
  );
  if (rowCount === 0) throw new HttpError(404, 'Notificación no encontrada');
}

async function marcarTodasLeidas(actor) {
  const { rowCount } = await query(
    'UPDATE notificaciones SET leida = TRUE WHERE usuario_destino_id = $1 AND recinto_id = $2 AND NOT leida',
    [actor.id, actor.recinto_id]
  );
  return rowCount;
}

// Crea una notificación para cada administrador activo del recinto y la emite en tiempo real.
// datos: { tipo, mensaje, entidad, entidad_id, datos_anteriores, datos_nuevos, usuario_origen_id }
async function notificarAdmins(recintoId, datos) {
  const { rows } = await query(
    `INSERT INTO notificaciones (recinto_id, usuario_destino_id, usuario_origen_id, tipo, entidad, entidad_id,
                                 datos_anteriores, datos_nuevos, mensaje)
     SELECT $1, u.id, $2, $3, $4, $5, $6, $7, $8
     FROM usuario_recinto ur
     JOIN usuarios u ON u.id = ur.usuario_id
     JOIN roles r ON r.id = ur.rol_id
     WHERE ur.recinto_id = $1 AND r.nombre = 'admin_recinto' AND u.activo AND ur.activo
     RETURNING *`,
    [
      recintoId,
      datos.usuario_origen_id || null,
      datos.tipo,
      datos.entidad || null,
      datos.entidad_id || null,
      datos.datos_anteriores ? JSON.stringify(datos.datos_anteriores) : null,
      datos.datos_nuevos ? JSON.stringify(datos.datos_nuevos) : null,
      datos.mensaje,
    ]
  );
  for (const n of rows) emitirNotificacion(n.usuario_destino_id, n);
  return rows.length;
}

module.exports = { listar, contarNoLeidas, marcarLeida, marcarTodasLeidas, notificarAdmins };
