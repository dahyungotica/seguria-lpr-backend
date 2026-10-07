// Servicio de accesos: historial, estadísticas, alertas y registro de detecciones
//  - admin_plataforma: consulta los accesos de cualquier recinto (HU-23), y la consulta queda auditada.
//  - admin_recinto y guardia: los de su recinto.
//  - propietario: solo los de sus vehículos y visitas.
// Cada acceso denegado genera una alerta pendiente que el guardia atiende autorizando o rechazando (HU-31).
const { query, transaccion } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { Filtros, ZONA_HORARIA } = require('../utils/sql');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const { normalizarPatente } = require('../utils/patente');
const { subirImagen, urlFirmada } = require('../utils/cloudinary');
const { notificarAdmins } = require('./notificaciones.service');
const auditoria = require('./auditoria.service');
const { emitirAccesoNuevo, emitirAccesoActualizado } = require('../sockets');

// El propietario se obtiene del vehículo o, si fue una visita, de quien la programó.
// Su unidad es la que tiene EN ESE recinto (usuario_recinto).
const SQL_ACCESOS = `
  SELECT a.id, a.recinto_id, re.nombre AS recinto_nombre,
         a.patente_detectada, a.confianza_ocr, a.imagen_url, a.sentido,
         a.fecha_hora, a.resultado, a.detalle_autorizacion,
         a.camara_id, c.nombre AS camara_nombre,
         a.vehiculo_id, v.marca AS vehiculo_marca, v.modelo AS vehiculo_modelo, v.color AS vehiculo_color,
         a.visita_id, vi.nombre_visitante,
         p.id AS propietario_id, p.nombre || ' ' || p.apellido AS propietario_nombre,
         un.identificador AS unidad,
         a.guardia_id, g.nombre || ' ' || g.apellido AS guardia_nombre,
         al.id AS alerta_id, al.estado AS alerta_estado, al.decision AS alerta_decision,
         al.detalle AS alerta_detalle, al.atendida_at AS alerta_atendida_at,
         ga.nombre || ' ' || ga.apellido AS alerta_guardia_nombre
  FROM accesos a
  JOIN recintos re ON re.id = a.recinto_id
  JOIN camaras c ON c.id = a.camara_id
  LEFT JOIN vehiculos v ON v.id = a.vehiculo_id
  LEFT JOIN visitas vi ON vi.id = a.visita_id
  LEFT JOIN usuarios p ON p.id = COALESCE(v.propietario_id, vi.propietario_id)
  LEFT JOIN usuario_recinto pur ON pur.usuario_id = p.id AND pur.recinto_id = a.recinto_id AND pur.unidad_id IS NOT NULL
  LEFT JOIN unidades un ON un.id = pur.unidad_id
  LEFT JOIN usuarios g ON g.id = a.guardia_id
  LEFT JOIN alertas al ON al.acceso_id = a.id
  LEFT JOIN usuarios ga ON ga.id = al.guardia_id
`;

// Las capturas son privadas en Cloudinary: se entrega una URL firmada solo a quien puede ver el acceso
function conImagenFirmada(acceso) {
  return acceso && acceso.imagen_url ? { ...acceso, imagen_url: urlFirmada(acceso.imagen_url) } : acceso;
}

function filtrosDeAlcance(actor) {
  const f = new Filtros();
  if (actor.rol !== ROLES.ADMIN_PLATAFORMA) f.agregar('a.recinto_id = ?', actor.recinto_id);
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
  if (filtros.alerta) f.agregar('al.estado = ?', filtros.alerta);
  if (filtros.recinto_id && actor.rol === ROLES.ADMIN_PLATAFORMA) f.agregar('a.recinto_id = ?', filtros.recinto_id);

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT x.*, COUNT(*) OVER() AS total_filas
     FROM (${SQL_ACCESOS} ${f.where}) x
     ORDER BY x.fecha_hora DESC
     LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  const respuesta = respuestaPaginada(rows.map(conImagenFirmada), paginacion);

  // HU-23: las consultas del administrador de plataforma a los accesos quedan auditadas
  if (actor.rol === ROLES.ADMIN_PLATAFORMA) {
    const usados = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== undefined && valor !== ''));
    await auditoria.registrar(actor, {
      accion: 'consultar', entidad: 'accesos', recintoId: filtros.recinto_id || null,
      detalle: `Consultó el historial de accesos (${respuesta.total} resultado(s))`, despues: { filtros: usados },
    });
  }
  return respuesta;
}

async function obtener(actor, id) {
  const f = filtrosDeAlcance(actor);
  f.agregar('a.id = ?', id);
  const { rows } = await query(`${SQL_ACCESOS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Acceso no encontrado');
  return conImagenFirmada(rows[0]);
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
    // Totales del recinto (personas con vínculo activo en este recinto)
    query(
      `SELECT
         (SELECT COUNT(*) FROM usuario_recinto ur JOIN usuarios u ON u.id = ur.usuario_id JOIN roles r ON r.id = ur.rol_id
           WHERE ur.recinto_id = $1 AND r.nombre = 'propietario' AND ur.activo AND u.activo)::int AS propietarios,
         (SELECT COUNT(*) FROM usuario_recinto ur JOIN usuarios u ON u.id = ur.usuario_id JOIN roles r ON r.id = ur.rol_id
           WHERE ur.recinto_id = $1 AND r.nombre = 'guardia' AND ur.activo AND u.activo)::int AS guardias,
         (SELECT COUNT(*) FROM vehiculos WHERE recinto_id = $1 AND activo)::int AS vehiculos,
         (SELECT COUNT(*) FROM visitas WHERE recinto_id = $1 AND estado IN ('programada', 'activa')
           AND NOW() BETWEEN fecha_inicio AND fecha_fin)::int AS visitas_vigentes,
         (SELECT COUNT(*) FROM alertas WHERE recinto_id = $1 AND estado = 'pendiente')::int AS alertas_pendientes`,
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
  return conImagenFirmada(rows[0]);
}

// La alerta debe estar pendiente para poder atenderla
async function alertaPendiente(guardia, accesoId) {
  const acceso = await obtener(guardia, accesoId);
  if (!acceso.alerta_id) throw new HttpError(400, 'Este acceso no tiene una alerta que atender');
  if (acceso.alerta_estado !== 'pendiente') {
    throw new HttpError(400, `La alerta ya fue atendida (${acceso.alerta_decision} por ${acceso.alerta_guardia_nombre})`);
  }
  return acceso;
}

// HU-31: el guardia autoriza un ingreso denegado. El detalle es obligatorio (también lo exige la BD).
async function autorizarManual(guardia, id, detalle) {
  const acceso = await alertaPendiente(guardia, id);
  await transaccion(async (cliente) => {
    await cliente.query(
      `UPDATE accesos SET resultado = 'autorizado_manual', guardia_id = $2, detalle_autorizacion = $3
       WHERE id = $1 AND resultado = 'denegado'`,
      [id, guardia.id, detalle]
    );
    await cliente.query(
      `UPDATE alertas SET estado = 'atendida', decision = 'autorizado', guardia_id = $2, detalle = $3, atendida_at = NOW()
       WHERE acceso_id = $1 AND estado = 'pendiente'`,
      [id, guardia.id, detalle]
    );
  });
  return cerrarGestion(guardia, acceso, 'autorizar', detalle);
}

// HU-31: el guardia rechaza el ingreso. El acceso sigue denegado y la alerta queda atendida.
async function rechazar(guardia, id, detalle) {
  const acceso = await alertaPendiente(guardia, id);
  await query(
    `UPDATE alertas SET estado = 'atendida', decision = 'rechazado', guardia_id = $2, detalle = $3, atendida_at = NOW()
     WHERE acceso_id = $1 AND estado = 'pendiente'`,
    [id, guardia.id, detalle || null]
  );
  return cerrarGestion(guardia, acceso, 'rechazar', detalle);
}

async function cerrarGestion(guardia, anterior, accion, detalle) {
  const actualizado = await obtenerPorId(anterior.id);
  await auditoria.registrar(guardia, {
    accion, entidad: 'alertas', entidadId: anterior.alerta_id, recintoId: anterior.recinto_id,
    antes: { patente: anterior.patente_detectada, resultado: anterior.resultado, alerta: anterior.alerta_estado },
    despues: { patente: actualizado.patente_detectada, resultado: actualizado.resultado, alerta: actualizado.alerta_estado, decision: actualizado.alerta_decision },
    detalle: detalle || null,
  });
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

  // La imagen se sube a Cloudinary como privada; en la BD queda solo la URL (sin firma)
  let imagenUrl = datos.imagen_url || null;
  if (datos.imagen_base64) {
    imagenUrl = (await subirImagen(datos.imagen_base64)).url;
  }

  const accesoId = await transaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO accesos (recinto_id, camara_id, dispositivo_id, patente_detectada, confianza_ocr, imagen_url,
                            sentido, fecha_hora, resultado, vehiculo_id, visita_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9, $10, $11) RETURNING id`,
      [
        dispositivo.recinto_id, datos.camara_id, dispositivo.id, patente, datos.confianza_ocr ?? null, imagenUrl,
        camaras[0].sentido, datos.fecha_hora || null, resultado,
        autorizacion ? autorizacion.vehiculo_id : null, autorizacion ? autorizacion.visita_id : null,
      ]
    );
    // Cada ingreso no autorizado queda como alerta pendiente para el guardia (HU-31)
    if (resultado === 'denegado') {
      await cliente.query('INSERT INTO alertas (recinto_id, acceso_id) VALUES ($1, $2)', [dispositivo.recinto_id, rows[0].id]);
    }
    return rows[0].id;
  });

  // La visita pasa a "activa" con su primer ingreso
  if (resultado === 'visita' && camaras[0].sentido === 'entrada') {
    await query("UPDATE visitas SET estado = 'activa' WHERE id = $1 AND estado = 'programada'", [autorizacion.visita_id]);
  }

  const acceso = await obtenerPorId(accesoId);
  await auditoria.registrar({ tipo: 'dispositivo', ...dispositivo }, {
    accion: 'crear', entidad: 'accesos', entidadId: accesoId, recintoId: dispositivo.recinto_id,
    despues: { patente, resultado, camara: acceso.camara_nombre, confianza_ocr: acceso.confianza_ocr },
  });
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

module.exports = { listar, obtener, estadisticas, autorizarManual, rechazar, registrarDesdeDispositivo };
