// Servicio de accesos: historial con filtros y estadísticas del recinto
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { Filtros, ZONA_HORARIA } = require('../utils/sql');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const { normalizarPatente } = require('../utils/patente');
const { subirImagen } = require('../utils/cloudinary');
const { notificarAdmins } = require('./notificaciones.service');
const { emitirAccesoNuevo, emitirAccesoActualizado } = require('../sockets');

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

// Acceso completo por id (uso interno, para emitirlo en tiempo real)
async function obtenerPorId(id) {
  const { rows } = await query(`${SQL_ACCESOS} WHERE a.id = $1`, [id]);
  return rows[0];
}

// El guardia autoriza un ingreso que fue denegado. El detalle es obligatorio (también lo exige un CHECK de la BD).
async function autorizarManual(guardia, id, detalle) {
  const acceso = await obtener(guardia, id);
  if (acceso.resultado !== 'denegado') {
    throw new HttpError(400, 'Solo se pueden autorizar manualmente accesos denegados');
  }

  await query(
    `UPDATE accesos SET resultado = 'autorizado_manual', guardia_id = $2, detalle_autorizacion = $3
     WHERE id = $1 AND resultado = 'denegado'`,
    [id, guardia.id, detalle]
  );
  const actualizado = await obtenerPorId(id);
  emitirAccesoActualizado(actualizado.recinto_id, actualizado);
  return actualizado;
}

// Registra una detección enviada por una Raspberry Pi.
// El resultado lo decide el servidor con vw_patentes_autorizadas (fuente oficial).
async function registrarDesdeDispositivo(dispositivo, datos) {
  const patente = normalizarPatente(datos.patente);

  const { rows: camaras } = await query(
    'SELECT id, sentido FROM camaras WHERE id = $1 AND recinto_id = $2',
    [datos.camara_id, dispositivo.recinto_id]
  );
  if (!camaras[0]) throw new HttpError(400, 'La cámara no pertenece al recinto del dispositivo');

  // ¿Está autorizada? Prioridad: vehículo registrado y luego visita vigente
  const { rows: autorizaciones } = await query(
    `SELECT origen, vehiculo_id, visita_id FROM vw_patentes_autorizadas
     WHERE recinto_id = $1 AND patente = $2
     ORDER BY CASE origen WHEN 'vehiculo' THEN 0 ELSE 1 END LIMIT 1`,
    [dispositivo.recinto_id, patente]
  );
  const autorizacion = autorizaciones[0];
  const resultado = !autorizacion ? 'denegado' : autorizacion.origen === 'vehiculo' ? 'autorizado' : 'visita';

  // La imagen se sube a Cloudinary; en la BD queda solo la URL
  let imagenUrl = datos.imagen_url || null;
  if (datos.imagen_base64) {
    imagenUrl = (await subirImagen(datos.imagen_base64)).url;
  }

  const { rows } = await query(
    `INSERT INTO accesos (recinto_id, camara_id, dispositivo_id, patente_detectada, confianza_ocr, imagen_url,
                          sentido, fecha_hora, resultado, vehiculo_id, visita_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9, $10, $11) RETURNING id`,
    [
      dispositivo.recinto_id, datos.camara_id, dispositivo.id, patente, datos.confianza_ocr ?? null, imagenUrl,
      camaras[0].sentido, datos.fecha_hora || null, resultado,
      autorizacion ? autorizacion.vehiculo_id : null, autorizacion ? autorizacion.visita_id : null,
    ]
  );

  // La visita pasa a "activa" con su primer ingreso
  if (resultado === 'visita' && camaras[0].sentido === 'entrada') {
    await query("UPDATE visitas SET estado = 'activa' WHERE id = $1 AND estado = 'programada'", [autorizacion.visita_id]);
  }

  const acceso = await obtenerPorId(rows[0].id);
  emitirAccesoNuevo(dispositivo.recinto_id, acceso);

  if (resultado === 'denegado') {
    await notificarAdmins(dispositivo.recinto_id, {
      tipo: 'acceso_no_autorizado',
      entidad: 'accesos',
      entidad_id: acceso.id,
      datos_nuevos: { patente, camara: acceso.camara_nombre },
      mensaje: `Intento de ingreso de la patente ${patente}, que no está autorizada`,
    });
  }
  return acceso;
}

module.exports = { listar, obtener, estadisticas, autorizarManual, registrarDesdeDispositivo };
