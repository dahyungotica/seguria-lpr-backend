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
  LEFT JOIN unidades un ON un.id = o.unidad_id
`;

async function listar(usuarioId, filtros) {
  const paginacion = obtenerPaginacion(filtros);
  const f = new Filtros();
  f.agregar('n.usuario_destino_id = ?', usuarioId);
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

async function contarNoLeidas(usuarioId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS total FROM notificaciones WHERE usuario_destino_id = $1 AND NOT leida',
    [usuarioId]
  );
  return rows[0].total;
}

async function marcarLeida(usuarioId, id) {
  const { rowCount } = await query(
    'UPDATE notificaciones SET leida = TRUE WHERE id = $1 AND usuario_destino_id = $2',
    [id, usuarioId]
  );
  if (rowCount === 0) throw new HttpError(404, 'Notificación no encontrada');
}

async function marcarTodasLeidas(usuarioId) {
  const { rowCount } = await query(
    'UPDATE notificaciones SET leida = TRUE WHERE usuario_destino_id = $1 AND NOT leida',
    [usuarioId]
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
     FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE u.recinto_id = $1 AND r.nombre = 'admin_recinto' AND u.activo
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
