// Servicio de auditoría (HU-5): bitácora de quién hizo qué, cuándo y con qué datos.
// La tabla es de solo inserción (un trigger impide editar o borrar registros).
//
// Actor: puede ser
//   - un usuario autenticado (req.usuario: { id, rol, recinto_id, ip })
//   - un dispositivo: { tipo: 'dispositivo', id, nombre, recinto_id }
//   - el sistema (tareas automáticas): { tipo: 'sistema' }
const { query } = require('../config/db');
const ROLES = require('../utils/roles');
const { Filtros, ZONA_HORARIA } = require('../utils/sql');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');

// Nunca se guardan secretos ni listas derivadas en la bitácora
const CAMPOS_EXCLUIDOS = ['password', 'password_hash', 'api_key', 'api_key_hash', 'vehiculos', 'total_filas'];

function limpiar(datos) {
  if (!datos) return null;
  const copia = { ...datos };
  for (const campo of CAMPOS_EXCLUIDOS) delete copia[campo];
  return copia;
}

// Registra una acción. No interrumpe la operación principal si la bitácora falla (se informa en consola).
//   accion:   crear | editar | eliminar | activar | desactivar | vincular | autorizar | rechazar | cancelar | regenerar_clave | consultar
//   entidad:  nombre de la tabla afectada (ej. 'vehiculos')
//   recintoId: si no se indica, se usa el recinto del actor (null para acciones de plataforma)
async function registrar(actor, { accion, entidad, entidadId = null, recintoId, antes = null, despues = null, detalle = null }) {
  const tipo = actor.tipo || 'usuario';
  const recinto = recintoId !== undefined ? recintoId : actor.recinto_id || null;
  try {
    await query(
      `INSERT INTO auditoria (recinto_id, actor_tipo, usuario_id, actor_nombre, actor_rol, accion, entidad,
                              entidad_id, datos_anteriores, datos_nuevos, detalle, ip)
       VALUES ($1, $2, $3,
               COALESCE($4, (SELECT nombre || ' ' || apellido FROM usuarios WHERE id = $3)),
               $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        recinto,
        tipo,
        tipo === 'usuario' ? actor.id : null,
        tipo === 'dispositivo' ? actor.nombre : tipo === 'sistema' ? 'Sistema' : null,
        tipo === 'usuario' ? actor.rol : tipo,
        accion,
        entidad,
        entidadId,
        antes ? JSON.stringify(limpiar(antes)) : null,
        despues ? JSON.stringify(limpiar(despues)) : null,
        detalle,
        actor.ip || null,
      ]
    );
  } catch (error) {
    console.error('No se pudo registrar la auditoría:', error.message);
  }
}

// Listado con filtros. El admin de recinto ve solo su recinto; el admin de plataforma, todo
// (puede filtrar por recinto o por "plataforma" para ver sus propias acciones).
async function listar(actor, filtros = {}) {
  const paginacion = obtenerPaginacion(filtros);
  const f = new Filtros();

  if (actor.rol === ROLES.ADMIN_PLATAFORMA) {
    if (filtros.recinto_id === 'plataforma') f.agregar('a.recinto_id IS NULL');
    else if (filtros.recinto_id) f.agregar('a.recinto_id = ?', Number(filtros.recinto_id));
  } else {
    f.agregar('a.recinto_id = ?', actor.recinto_id);
  }
  if (filtros.actor_rol) f.agregar('a.actor_rol = ?', filtros.actor_rol);
  if (filtros.entidad) f.agregar('a.entidad = ?', filtros.entidad);
  if (filtros.accion) f.agregar('a.accion = ?', filtros.accion);
  if (filtros.desde) f.agregar(`a.fecha >= (?::date)::timestamp AT TIME ZONE '${ZONA_HORARIA}'`, filtros.desde);
  if (filtros.hasta) f.agregar(`a.fecha < (?::date + 1)::timestamp AT TIME ZONE '${ZONA_HORARIA}'`, filtros.hasta);
  if (filtros.busqueda) {
    f.agregar("(a.actor_nombre ILIKE '%' || ? || '%' OR a.detalle ILIKE '%' || ? || '%')", filtros.busqueda, filtros.busqueda);
  }

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT a.*, re.nombre AS recinto_nombre, COUNT(*) OVER() AS total_filas
     FROM auditoria a LEFT JOIN recintos re ON re.id = a.recinto_id
     ${f.where}
     ORDER BY a.fecha DESC, a.id DESC
     LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  return respuestaPaginada(rows, paginacion);
}

module.exports = { registrar, listar };
