// Servicio de visitas
//  - propietario:   programa, edita y cancela SUS visitas.
//  - admin_recinto: consulta y puede cancelar visitas de su recinto.
//  - guardia:       consulta las visitas de su recinto (ej. las vigentes hoy).
// Si la visita trae patente, queda autorizada mientras esté vigente (vw_patentes_autorizadas).
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { construirUpdate, Filtros, ZONA_HORARIA } = require('../utils/sql');
const { normalizarPatente } = require('../utils/patente');
const { formatearRut } = require('../utils/rut');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const { notificarAdmins } = require('./notificaciones.service');

const CAMPOS_EDITABLES = ['nombre_visitante', 'rut_visitante', 'patente', 'motivo', 'fecha_inicio', 'fecha_fin'];
const DURACION_MAXIMA_DIAS = 30;

// El estado guardado puede quedar desactualizado con el paso del tiempo,
// por eso se calcula el estado real según la hora actual.
const SQL_ESTADO_ACTUAL = `
  CASE
    WHEN vi.estado = 'cancelada' THEN 'cancelada'
    WHEN vi.estado = 'finalizada' OR NOW() > vi.fecha_fin THEN 'finalizada'
    WHEN NOW() >= vi.fecha_inicio THEN 'activa'
    ELSE 'programada'
  END`;

const SQL_VISITAS = `
  SELECT vi.*, ${SQL_ESTADO_ACTUAL} AS estado_actual,
         p.nombre || ' ' || p.apellido AS propietario_nombre, p.telefono AS propietario_telefono,
         un.identificador AS unidad
  FROM visitas vi
  JOIN usuarios p ON p.id = vi.propietario_id
  LEFT JOIN unidades un ON un.id = p.unidad_id
`;

function filtrosDeAlcance(actor) {
  const f = new Filtros();
  f.agregar('vi.recinto_id = ?', actor.recinto_id);
  if (actor.rol === ROLES.PROPIETARIO) f.agregar('vi.propietario_id = ?', actor.id);
  return f;
}

// vigencia: "proximas" (programadas o en curso), "pasadas" (finalizadas o canceladas),
//           "hoy" (en curso o que empiezan hoy; útil para el guardia)
async function listar(actor, filtros = {}) {
  const paginacion = obtenerPaginacion(filtros);
  const f = filtrosDeAlcance(actor);

  if (filtros.vigencia === 'proximas') {
    f.agregar(`(${SQL_ESTADO_ACTUAL}) IN ('programada', 'activa')`);
  } else if (filtros.vigencia === 'pasadas') {
    f.agregar(`(${SQL_ESTADO_ACTUAL}) IN ('finalizada', 'cancelada')`);
  } else if (filtros.vigencia === 'hoy') {
    f.agregar(`vi.estado <> 'cancelada' AND vi.fecha_fin >= NOW()
      AND (vi.fecha_inicio AT TIME ZONE '${ZONA_HORARIA}')::date <= (NOW() AT TIME ZONE '${ZONA_HORARIA}')::date`);
  }
  if (filtros.busqueda) {
    f.agregar(
      `(vi.nombre_visitante ILIKE '%' || ? || '%' OR vi.patente ILIKE '%' || ? || '%' OR un.identificador ILIKE '%' || ? || '%')`,
      filtros.busqueda, normalizarPatente(filtros.busqueda) || filtros.busqueda, filtros.busqueda
    );
  }

  // Próximas: la más cercana primero. Pasadas: la más reciente primero.
  const orden = filtros.vigencia === 'pasadas' ? 'x.fecha_inicio DESC' : 'x.fecha_inicio ASC';
  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT x.*, COUNT(*) OVER() AS total_filas FROM (${SQL_VISITAS} ${f.where}) x
     ORDER BY ${orden} LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  return respuestaPaginada(rows, paginacion);
}

async function obtener(actor, id) {
  const f = filtrosDeAlcance(actor);
  f.agregar('vi.id = ?', id);
  const { rows } = await query(`${SQL_VISITAS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Visita no encontrada');
  return rows[0];
}

// Reglas de fechas: fin posterior al inicio, fin en el futuro y duración máxima
function validarFechas(inicio, fin) {
  const desde = new Date(inicio);
  const hasta = new Date(fin);
  if (hasta <= desde) throw new HttpError(400, 'La fecha de término debe ser posterior a la de inicio');
  if (hasta <= new Date()) throw new HttpError(400, 'La visita debe terminar en el futuro');
  if (hasta - desde > DURACION_MAXIMA_DIAS * 86400000) {
    throw new HttpError(400, `Una visita puede durar como máximo ${DURACION_MAXIMA_DIAS} días`);
  }
}

function limpiar(datos) {
  const d = { ...datos };
  if (d.patente !== undefined) d.patente = d.patente ? normalizarPatente(d.patente) : null;
  if (d.rut_visitante) d.rut_visitante = formatearRut(d.rut_visitante);
  return d;
}

async function crear(actor, datos) {
  validarFechas(datos.fecha_inicio, datos.fecha_fin);
  const d = limpiar(datos);

  const { rows } = await query(
    `INSERT INTO visitas (propietario_id, recinto_id, nombre_visitante, rut_visitante, patente, motivo, fecha_inicio, fecha_fin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [actor.id, actor.recinto_id, d.nombre_visitante, d.rut_visitante || null, d.patente || null,
      d.motivo || null, d.fecha_inicio, d.fecha_fin]
  );
  const visita = await obtener(actor, rows[0].id);

  await notificarAdmins(actor.recinto_id, {
    tipo: 'visita_creada',
    usuario_origen_id: actor.id,
    entidad: 'visitas',
    entidad_id: visita.id,
    datos_nuevos: {
      visitante: visita.nombre_visitante,
      patente: visita.patente,
      desde: visita.fecha_inicio,
      hasta: visita.fecha_fin,
    },
    mensaje: `${visita.propietario_nombre} programó una visita de ${visita.nombre_visitante}`,
  });
  return visita;
}

async function actualizar(actor, id, datos) {
  const actual = await obtener(actor, id);
  if (!['programada', 'activa'].includes(actual.estado_actual)) {
    throw new HttpError(400, 'Solo se pueden editar visitas programadas o en curso');
  }
  validarFechas(datos.fecha_inicio || actual.fecha_inicio, datos.fecha_fin || actual.fecha_fin);

  const update = construirUpdate(limpiar(datos), CAMPOS_EDITABLES, 2);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');
  await query(`UPDATE visitas SET ${update.set} WHERE id = $1`, [id, ...update.valores]);
  return obtener(actor, id);
}

// Al cancelarla, su patente deja de estar autorizada de inmediato
async function cancelar(actor, id) {
  const actual = await obtener(actor, id);
  if (['finalizada', 'cancelada'].includes(actual.estado_actual)) {
    throw new HttpError(400, 'La visita ya terminó o fue cancelada');
  }
  await query("UPDATE visitas SET estado = 'cancelada' WHERE id = $1", [id]);
  return obtener(actor, id);
}

module.exports = { listar, obtener, crear, actualizar, cancelar };
