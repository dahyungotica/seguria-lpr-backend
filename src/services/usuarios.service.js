// Servicio de usuarios
//  - admin_plataforma: gestiona administradores de recinto (de cualquier recinto).
//  - admin_recinto:    gestiona propietarios y guardias de SU recinto.
//  - guardia:          solo consulta propietarios de su recinto.
//
// Un usuario puede estar vinculado a varios recintos (tabla usuario_recinto, HU-19/HU-20/HU-22).
// Cada fila del listado corresponde a un vínculo usuario-recinto.
const bcrypt = require('bcryptjs');
const { query, transaccion } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { Filtros } = require('../utils/sql');
const { formatearRut } = require('../utils/rut');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const auditoria = require('./auditoria.service');
const sincronizacion = require('./sincronizacion.service');

// Roles que cada actor puede VER
const ROLES_VISIBLES = {
  [ROLES.ADMIN_PLATAFORMA]: [ROLES.ADMIN_RECINTO],
  [ROLES.ADMIN_RECINTO]: [ROLES.PROPIETARIO, ROLES.GUARDIA],
  [ROLES.GUARDIA]: [ROLES.PROPIETARIO],
};

// Roles que cada actor puede CREAR / EDITAR / DESACTIVAR
const ROLES_GESTIONABLES = {
  [ROLES.ADMIN_PLATAFORMA]: [ROLES.ADMIN_RECINTO],
  [ROLES.ADMIN_RECINTO]: [ROLES.PROPIETARIO, ROLES.GUARDIA],
};

const CAMPOS_PERSONALES = ['rut', 'nombre', 'apellido', 'email', 'telefono', 'password_hash'];

// Nunca se devuelve password_hash. Los vehículos son los del propietario EN ESE recinto.
const SQL_VINCULOS = `
  SELECT u.id, u.rut, u.nombre, u.apellido, u.email, u.telefono, u.ultimo_login, u.created_at,
         r.nombre AS rol, ur.id AS vinculo_id, ur.recinto_id, ur.unidad_id,
         (u.activo AND ur.activo) AS activo,
         re.nombre AS recinto_nombre, un.identificador AS unidad,
         (SELECT COUNT(*) FROM usuario_recinto x WHERE x.usuario_id = u.id AND x.activo)::int AS total_recintos,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', v.id, 'patente', v.patente, 'marca', v.marca, 'modelo', v.modelo,
                    'color', v.color, 'tipo', v.tipo, 'activo', v.activo) ORDER BY v.patente)
           FROM vehiculos v WHERE v.propietario_id = u.id AND v.recinto_id = ur.recinto_id
         ), '[]') AS vehiculos
  FROM usuario_recinto ur
  JOIN usuarios u ON u.id = ur.usuario_id
  JOIN roles r ON r.id = u.rol_id
  JOIN recintos re ON re.id = ur.recinto_id
  LEFT JOIN unidades un ON un.id = ur.unidad_id
`;

// Filtra por los roles indicados y, salvo el admin de plataforma, por el recinto de la sesión
function filtrosDeAlcance(actor, roles) {
  const f = new Filtros();
  f.agregar('r.nombre = ANY(?)', roles);
  if (actor.rol !== ROLES.ADMIN_PLATAFORMA) {
    f.agregar('ur.recinto_id = ?', actor.recinto_id);
  }
  return f;
}

async function listar(actor, filtros) {
  const visibles = ROLES_VISIBLES[actor.rol] || [];
  const roles = filtros.rol ? visibles.filter((r) => r === filtros.rol) : visibles;
  const paginacion = obtenerPaginacion(filtros);
  const f = filtrosDeAlcance(actor, roles);

  if (filtros.busqueda) {
    // Busca por nombre, email, RUT, unidad o patente de alguno de sus vehículos del recinto
    f.agregar(
      `(u.nombre || ' ' || u.apellido ILIKE '%' || ? || '%'
        OR u.email ILIKE '%' || ? || '%'
        OR u.rut ILIKE '%' || ? || '%'
        OR un.identificador ILIKE '%' || ? || '%'
        OR EXISTS (SELECT 1 FROM vehiculos v WHERE v.propietario_id = u.id AND v.recinto_id = ur.recinto_id
                   AND v.patente ILIKE '%' || ? || '%'))`,
      ...Array(5).fill(filtros.busqueda)
    );
  }
  if (filtros.activo !== undefined) f.agregar('(u.activo AND ur.activo) = ?', filtros.activo);
  if (filtros.unidad_id) f.agregar('ur.unidad_id = ?', filtros.unidad_id);
  if (filtros.recinto_id && actor.rol === ROLES.ADMIN_PLATAFORMA) {
    f.agregar('ur.recinto_id = ?', filtros.recinto_id);
  }

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `SELECT x.*, COUNT(*) OVER() AS total_filas
     FROM (${SQL_VINCULOS} ${f.where}) x
     ORDER BY x.apellido, x.nombre, x.recinto_nombre
     LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  return respuestaPaginada(rows, paginacion);
}

// Busca el vínculo de un usuario visible para el actor.
// El admin de plataforma puede indicar el vínculo exacto (un admin puede estar en varios recintos).
async function buscarVinculo(actor, id, roles, vinculoId) {
  const f = filtrosDeAlcance(actor, roles);
  f.agregar('u.id = ?', id);
  if (vinculoId && actor.rol === ROLES.ADMIN_PLATAFORMA) f.agregar('ur.id = ?', vinculoId);
  const { rows } = await query(`${SQL_VINCULOS} ${f.where} ORDER BY ur.id LIMIT 1`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  return rows[0];
}

function obtener(actor, id, vinculoId) {
  return buscarVinculo(actor, id, ROLES_VISIBLES[actor.rol] || [], vinculoId);
}

// Solo los usuarios que el actor puede modificar (si no, 404 para no revelar que existen)
function obtenerGestionable(actor, id, vinculoId) {
  return buscarVinculo(actor, id, ROLES_GESTIONABLES[actor.rol] || [], vinculoId);
}

// Revisa que la unidad exista, esté activa y pertenezca al recinto
async function validarUnidad(unidadId, recintoId) {
  const { rows } = await query('SELECT activo FROM unidades WHERE id = $1 AND recinto_id = $2', [unidadId, recintoId]);
  if (!rows[0]) throw new HttpError(400, 'La unidad no pertenece a este recinto');
  if (!rows[0].activo) throw new HttpError(400, 'La unidad está desactivada');
}

async function validarRecinto(recintoId) {
  const { rows } = await query('SELECT 1 FROM recintos WHERE id = $1', [recintoId]);
  if (!rows[0]) throw new HttpError(400, 'El recinto no existe');
}

// Normaliza los datos que vienen del formulario
async function prepararDatos(datos) {
  const limpio = { ...datos };
  if (limpio.rut) limpio.rut = formatearRut(limpio.rut);
  if (limpio.email) limpio.email = limpio.email.toLowerCase();
  if (limpio.password) limpio.password_hash = await bcrypt.hash(limpio.password, 10);
  delete limpio.password;
  return limpio;
}

// Crea la cuenta y su vínculo con el recinto. Si la persona ya tiene cuenta (mismo email, rol y RUT),
// solo se agrega el vínculo con el nuevo recinto: así un propietario o guardia usa una sola cuenta.
async function crear(actor, datos) {
  const permitidos = ROLES_GESTIONABLES[actor.rol] || [];
  if (!permitidos.includes(datos.rol)) {
    throw new HttpError(403, 'No puedes crear usuarios con ese rol');
  }

  // El admin de plataforma elige el recinto; el admin de recinto usa el de su sesión
  const recintoId = actor.rol === ROLES.ADMIN_PLATAFORMA ? datos.recinto_id : actor.recinto_id;
  if (!recintoId) throw new HttpError(400, 'Debes indicar el recinto');
  if (actor.rol === ROLES.ADMIN_PLATAFORMA) await validarRecinto(recintoId);

  const unidadId = datos.rol === ROLES.PROPIETARIO ? datos.unidad_id || null : null;
  if (datos.rol === ROLES.PROPIETARIO && !unidadId) {
    throw new HttpError(400, 'Debes asignar una unidad al propietario');
  }
  if (unidadId) await validarUnidad(unidadId, recintoId);

  const d = await prepararDatos(datos);
  const { rows: existentes } = await query(
    'SELECT u.id, u.rut, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1',
    [d.email]
  );
  const existente = existentes[0];

  let usuarioId;
  let vinculoId;
  if (existente) {
    // Persona que ya tiene cuenta en otro recinto: se vincula
    if (existente.rol !== datos.rol) throw new HttpError(409, 'Ese email ya pertenece a una cuenta con otro rol');
    if (existente.rut !== d.rut) throw new HttpError(409, 'Ese email ya está registrado con otro RUT');
    const { rows: vinculos } = await query(
      'SELECT activo FROM usuario_recinto WHERE usuario_id = $1 AND recinto_id = $2',
      [existente.id, recintoId]
    );
    if (vinculos[0]) {
      throw new HttpError(409, vinculos[0].activo
        ? 'Esta persona ya está registrada en este recinto'
        : 'Esta persona ya está en este recinto pero desactivada: actívala desde el listado');
    }
    usuarioId = existente.id;
    const { rows } = await query(
      'INSERT INTO usuario_recinto (usuario_id, recinto_id, unidad_id) VALUES ($1, $2, $3) RETURNING id',
      [usuarioId, recintoId, unidadId]
    );
    vinculoId = rows[0].id;
  } else {
    if (!d.password_hash) throw new HttpError(400, 'Debes indicar una contraseña inicial');
    ({ usuarioId, vinculoId } = await transaccion(async (cliente) => {
      const { rows: u } = await cliente.query(
        `INSERT INTO usuarios (rut, nombre, apellido, email, password_hash, telefono, rol_id)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM roles WHERE nombre = $7)) RETURNING id`,
        [d.rut, d.nombre, d.apellido, d.email, d.password_hash, d.telefono || null, d.rol]
      );
      const { rows: v } = await cliente.query(
        'INSERT INTO usuario_recinto (usuario_id, recinto_id, unidad_id) VALUES ($1, $2, $3) RETURNING id',
        [u[0].id, recintoId, unidadId]
      );
      return { usuarioId: u[0].id, vinculoId: v[0].id };
    }));
  }

  const creado = await obtener(actor, usuarioId, vinculoId);
  await auditoria.registrar(actor, {
    accion: existente ? 'vincular' : 'crear',
    entidad: 'usuarios',
    entidadId: usuarioId,
    recintoId,
    despues: creado,
    detalle: existente ? `${creado.nombre} ${creado.apellido} (cuenta existente) vinculado al recinto ${creado.recinto_nombre}` : null,
  });
  return { ...creado, vinculado: Boolean(existente) };
}

async function actualizar(actor, id, datos) {
  const actual = await obtenerGestionable(actor, id, datos.vinculo_id);
  const d = await prepararDatos(datos);

  // Datos de la persona (aplican en todos sus recintos)
  const personales = CAMPOS_PERSONALES.filter((c) => d[c] !== undefined);
  // Datos del vínculo con el recinto
  const vinculo = {};
  if (actor.rol === ROLES.ADMIN_PLATAFORMA && d.recinto_id && d.recinto_id !== actual.recinto_id) {
    await validarRecinto(d.recinto_id);
    vinculo.recinto_id = d.recinto_id;
  }
  if (actual.rol === ROLES.PROPIETARIO && d.unidad_id !== undefined) {
    if (!d.unidad_id) throw new HttpError(400, 'El propietario debe tener una unidad');
    await validarUnidad(d.unidad_id, actual.recinto_id);
    vinculo.unidad_id = d.unidad_id;
  }
  if (personales.length === 0 && Object.keys(vinculo).length === 0) {
    throw new HttpError(400, 'No hay datos para actualizar');
  }

  await transaccion(async (cliente) => {
    if (personales.length > 0) {
      await cliente.query(
        `UPDATE usuarios SET ${personales.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...personales.map((c) => d[c])]
      );
    }
    const columnas = Object.keys(vinculo);
    if (columnas.length > 0) {
      await cliente.query(
        `UPDATE usuario_recinto SET ${columnas.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [actual.vinculo_id, ...columnas.map((c) => vinculo[c])]
      );
    }
  });

  const nuevo = await obtener(actor, id, actual.vinculo_id);
  await auditoria.registrar(actor, {
    accion: 'editar', entidad: 'usuarios', entidadId: id, recintoId: nuevo.recinto_id, antes: actual, despues: nuevo,
    detalle: d.password_hash ? 'Se cambió la contraseña' : null,
  });
  return nuevo;
}

// Activa o desactiva el acceso del usuario A ESE recinto (sus otros recintos no cambian)
async function cambiarEstado(actor, id, activo, vinculoId) {
  if (id === actor.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta');
  const actual = await obtenerGestionable(actor, id, vinculoId);
  await query('UPDATE usuario_recinto SET activo = $2 WHERE id = $1', [actual.vinculo_id, activo]);

  const nuevo = await obtener(actor, id, actual.vinculo_id);
  await auditoria.registrar(actor, {
    accion: activo ? 'activar' : 'desactivar', entidad: 'usuarios', entidadId: id, recintoId: nuevo.recinto_id,
    antes: { activo: actual.activo }, despues: { activo: nuevo.activo },
    detalle: `${nuevo.nombre} ${nuevo.apellido} en ${nuevo.recinto_nombre}`,
  });
  // Los vehículos y visitas de un propietario desactivado dejan de estar autorizados
  if (actual.rol === ROLES.PROPIETARIO) sincronizacion.notificarCambio(actual.recinto_id);
  return nuevo;
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
