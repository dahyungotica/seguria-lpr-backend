// Servicio de accesos: historial con filtros y estadísticas del recinto
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { Filtros, ZONA_HORARIA } = require('../utils/sql');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const { normalizarPatente } = require('../utils/patente');

// El propietario se obtiene del vehículo o, si fue una visita, de quien la programó
const SQL_ACCESOS = `
  SELECT a.id, a.recinto_id, a.patente_detectada, a.confianza_ocr, a.imagen_url, a.sentido,
         a.fecha_hora, a.resultado, a.detalle_autorizacion,
         a.camara_id, c.nombre AS camara_nombre,
         a.vehiculo_id, v.marca AS vehiculo_marca, v.modelo AS vehiculo_modelo, v.color AS vehiculo_color,
         a.visita_id, vi.nombre_visitante,
         p.id AS propietario_id, p.nombre || ' ' || p.apellido AS propietario_nombre,
         un.identificador AS unidad,
         a.guardia_id, g.nombre || ' ' || g.apellido AS guardia_nombre
  FROM accesos a
  JOIN camaras c ON c.id = a.camara_id
  LEFT JOIN vehiculos v ON v.id = a.vehiculo_id
  LEFT JOIN visitas vi ON vi.id = a.visita_id
  LEFT JOIN usuarios p ON p.id = COALESCE(v.propietario_id, vi.propietario_id)
  LEFT JOIN unidades un ON un.id = p.unidad_id
  LEFT JOIN usuarios g ON g.id = a.guardia_id
`;

// Admin y guardia ven su recinto; el propietario, solo sus vehículos y visitas
function filtrosDeAlcance(actor) {
  const f = new Filtros();
  f.agregar('a.recinto_id = ?', actor.recinto_id);
  if (actor.rol === ROLES.PROPIETARIO) f.agregar('p.id = ?', actor.id);
  return f;
}

async function listar(actor, filtros) {
  const paginacion = obtenerPaginacion(filtros);
  const f = filtrosDeAlcance(actor);

  // Las fechas (YYYY-MM-DD) se interpretan en hora de Chile; "hasta" incluye el día completo
  if (filtros.desde) {
    f.agregar(`a.fecha_hora >= (?::date)::timestamp AT TIME ZONE '${ZONA_HORARIA}'`, filtros.desde);
  }
  if (filtros.hasta) {
    f.agregar(`a.fecha_hora < (?::date + 1)::timestamp AT TIME ZONE '${ZONA_HORARIA}'`, filtros.hasta);
  }
  if (filtros.patente) f.agregar("a.patente_detectada ILIKE '%' || ? || '%'", normalizarPatente(filtros.patente));
  if (filtros.resultado) f.agregar('a.resultado = ?', filtros.resultado);
  if (filtros.sentido) f.agregar('a.sentido = ?', filtros.sentido);
  if (filtros.camara_id) f.agregar('a.camara_id = ?', filtros.camara_id);

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT x.*, COUNT(*) OVER() AS total_filas
     FROM (${SQL_ACCESOS} ${f.where}) x
     ORDER BY x.fecha_hora DESC
     LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  return respuestaPaginada(rows, paginacion);
}

async function obtener(actor, id) {
  const f = filtrosDeAlcance(actor);
  f.agregar('a.id = ?', id);
  const { rows } = await query(`${SQL_ACCESOS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Acceso no encontrado');
  return rows[0];
}

// Resumen para el panel del administrador del recinto
async function estadisticas(recintoId) {
  const inicioHoy = `(date_trunc('day', NOW() AT TIME ZONE '${ZONA_HORARIA}') AT TIME ZONE '${ZONA_HORARIA}')`;

  const [hoy, dias, resumen] = await Promise.all([
    // Accesos de hoy por resultado
    query(
      `SELECT resultado, COUNT(*)::int AS total
       FROM accesos WHERE recinto_id = $1 AND fecha_hora >= ${inicioHoy}
       GROUP BY resultado`,
      [recintoId]
    ),
    // Accesos por día de los últimos 7 días (incluye días sin accesos)
    query(
      `SELECT to_char(d.dia, 'YYYY-MM-DD') AS fecha, COUNT(a.id)::int AS total
       FROM generate_series(
              (NOW() AT TIME ZONE '${ZONA_HORARIA}')::date - 6,
              (NOW() AT TIME ZONE '${ZONA_HORARIA}')::date,
              '1 day') AS d(dia)
       LEFT JOIN accesos a
         ON a.recinto_id = $1 AND (a.fecha_hora AT TIME ZONE '${ZONA_HORARIA}')::date = d.dia
       GROUP BY d.dia ORDER BY d.dia`,
      [recintoId]
    ),
    // Totales del recinto
    query(
      `SELECT
         (SELECT COUNT(*) FROM usuarios u JOIN roles r ON r.id = u.rol_id
           WHERE u.recinto_id = $1 AND r.nombre = 'propietario' AND u.activo)::int AS propietarios,
         (SELECT COUNT(*) FROM usuarios u JOIN roles r ON r.id = u.rol_id
           WHERE u.recinto_id = $1 AND r.nombre = 'guardia' AND u.activo)::int AS guardias,
         (SELECT COUNT(*) FROM vehiculos WHERE recinto_id = $1 AND activo)::int AS vehiculos,
         (SELECT COUNT(*) FROM visitas WHERE recinto_id = $1 AND estado IN ('programada', 'activa')
           AND NOW() BETWEEN fecha_inicio AND fecha_fin)::int AS visitas_vigentes`,
      [recintoId]
    ),
  ]);

  const porResultado = { autorizado: 0, denegado: 0, autorizado_manual: 0, visita: 0 };
  for (const fila of hoy.rows) porResultado[fila.resultado] = fila.total;

  return {
    hoy: { total: Object.values(porResultado).reduce((a, b) => a + b, 0), ...porResultado },
    ultimos_dias: dias.rows,
    resumen: resumen.rows[0],
  };
}

module.exports = { listar, obtener, estadisticas };
