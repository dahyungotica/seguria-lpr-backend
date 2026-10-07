// Servicio de vehículos
//  - propietario:   gestiona SUS vehículos sin aprobación; cada cambio se notifica al admin.
//  - admin_recinto: ve y gestiona los vehículos de su recinto.
//  - guardia:       solo consulta los vehículos de su recinto.
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { construirUpdate, Filtros } = require('../utils/sql');
const { normalizarPatente } = require('../utils/patente');
const { notificarAdmins } = require('./notificaciones.service');
const auditoria = require('./auditoria.service');
const sincronizacion = require('./sincronizacion.service');
const { emitirVehiculoCambio } = require('../sockets');

const CAMPOS_EDITABLES = ['patente', 'marca', 'modelo', 'color', 'tipo', 'activo'];
// Campos que se muestran en la notificación (antes / después)
const CAMPOS_NOTIFICACION = ['patente', 'marca', 'modelo', 'color', 'tipo', 'activo'];

const SQL_VEHICULOS = `
  SELECT v.*, p.nombre || ' ' || p.apellido AS propietario_nombre, un.identificador AS unidad
  FROM vehiculos v
  JOIN usuarios p ON p.id = v.propietario_id
  LEFT JOIN usuario_recinto pur ON pur.usuario_id = p.id AND pur.recinto_id = v.recinto_id
  LEFT JOIN unidades un ON un.id = pur.unidad_id
`;

function filtrosDeAlcance(actor) {
  const f = new Filtros();
  f.agregar('v.recinto_id = ?', actor.recinto_id);
  if (actor.rol === ROLES.PROPIETARIO) f.agregar('v.propietario_id = ?', actor.id);
  return f;
}

async function listar(actor, filtros = {}) {
  const f = filtrosDeAlcance(actor);
  if (filtros.propietario_id) f.agregar('v.propietario_id = ?', filtros.propietario_id);
  if (filtros.patente) f.agregar("v.patente ILIKE '%' || ? || '%'", normalizarPatente(filtros.patente));
  if (filtros.activo !== undefined) f.agregar('v.activo = ?', filtros.activo);

  const { rows } = await query(`${SQL_VEHICULOS} ${f.where} ORDER BY v.activo DESC, v.patente`, f.valores);
  return rows;
}

async function obtener(actor, id) {
  const f = filtrosDeAlcance(actor);
  f.agregar('v.id = ?', id);
  const { rows } = await query(`${SQL_VEHICULOS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Vehículo no encontrado');
  return rows[0];
}

// Solo los campos relevantes para mostrar qué cambió
function resumen(vehiculo) {
  return Object.fromEntries(CAMPOS_NOTIFICACION.map((c) => [c, vehiculo[c]]));
}

// Avisa al administrador (notificación + tiempo real) cuando el cambio lo hace el propietario
const ACCION_AUDITORIA = { vehiculo_creado: 'crear', vehiculo_editado: 'editar', vehiculo_eliminado: 'eliminar' };

async function avisarCambio(actor, tipo, verbo, anterior, nuevo) {
  const vehiculo = nuevo || anterior;
  // Toda alta, edición o eliminación queda en la auditoría, la haga el propietario o el admin (HU-5 / HU-27)
  await auditoria.registrar(actor, {
    accion: ACCION_AUDITORIA[tipo], entidad: 'vehiculos', entidadId: vehiculo.id, recintoId: vehiculo.recinto_id,
    antes: anterior ? resumen(anterior) : null, despues: nuevo ? resumen(nuevo) : null,
    detalle: `${verbo[0].toUpperCase() + verbo.slice(1)} el vehículo ${vehiculo.patente} de ${vehiculo.propietario_nombre}`,
  });
  // La copia local de las Raspberry Pi se actualiza (HU-36)
  sincronizacion.notificarCambio(vehiculo.recinto_id);
  emitirVehiculoCambio(vehiculo.recinto_id, { tipo, vehiculo });
  if (actor.rol !== ROLES.PROPIETARIO) return;

  await notificarAdmins(vehiculo.recinto_id, {
    tipo,
    usuario_origen_id: actor.id,
    entidad: 'vehiculos',
    entidad_id: vehiculo.id,
    datos_anteriores: anterior ? resumen(anterior) : null,
    datos_nuevos: nuevo ? resumen(nuevo) : null,
    mensaje: `${vehiculo.propietario_nombre} ${verbo} el vehículo ${vehiculo.patente}`,
  });
}

async function crear(actor, datos) {
  let propietarioId = actor.id;

  // El admin de recinto puede registrar un vehículo a nombre de un propietario de su recinto
  if (actor.rol === ROLES.ADMIN_RECINTO) {
    if (!datos.propietario_id) throw new HttpError(400, 'Debes indicar el propietario');
    const { rows } = await query(
      `SELECT ur.activo FROM usuario_recinto ur JOIN usuarios u ON u.id = ur.usuario_id JOIN roles r ON r.id = u.rol_id
       WHERE ur.usuario_id = $1 AND ur.recinto_id = $2 AND r.nombre = 'propietario'`,
      [datos.propietario_id, actor.recinto_id]
    );
    if (!rows[0]) throw new HttpError(400, 'El propietario no pertenece a este recinto');
    if (!rows[0].activo) throw new HttpError(400, 'El propietario está desactivado en este recinto');
    propietarioId = datos.propietario_id;
  }

  const { rows } = await query(
    `INSERT INTO vehiculos (propietario_id, recinto_id, patente, marca, modelo, color, tipo)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'auto')) RETURNING id`,
    [propietarioId, actor.recinto_id, normalizarPatente(datos.patente), datos.marca, datos.modelo, datos.color, datos.tipo]
  );
  const vehiculo = await obtener(actor, rows[0].id);
  await avisarCambio(actor, 'vehiculo_creado', 'registró', null, vehiculo);
  return vehiculo;
}

async function actualizar(actor, id, datos) {
  const anterior = await obtener(actor, id);
  const cambios = { ...datos };
  if (cambios.patente) cambios.patente = normalizarPatente(cambios.patente);

  const update = construirUpdate(cambios, CAMPOS_EDITABLES, 2);
  if (!update) throw new HttpError(400, 'No hay datos para actualizar');

  await query(`UPDATE vehiculos SET ${update.set} WHERE id = $1`, [id, ...update.valores]);
  const nuevo = await obtener(actor, id);
  await avisarCambio(actor, 'vehiculo_editado', 'editó', anterior, nuevo);
  return nuevo;
}

// El historial de accesos se conserva (vehiculo_id queda en NULL)
async function eliminar(actor, id) {
  const anterior = await obtener(actor, id);
  await query('DELETE FROM vehiculos WHERE id = $1', [id]);
  await avisarCambio(actor, 'vehiculo_eliminado', 'eliminó', anterior, null);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
