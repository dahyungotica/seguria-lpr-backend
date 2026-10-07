// Servicio de usuarios (personas)
//
// Cada persona tiene UNA cuenta (un email, un RUT y una contraseña) y uno o varios roles por recinto
// en la tabla usuario_recinto. Ej.: administradora de 3 recintos, guardia en 2 y propietaria en 1.
//
// Qué puede hacer cada actor:
//  - admin_plataforma: ve y gestiona el rol "administrador de recinto" en cualquier recinto.
//  - admin_recinto:    ve las personas del recinto de su sesión y asigna los 3 roles
//                      (administrador, guardia, propietario) en TODOS los recintos que administra.
//  - guardia:          solo consulta los propietarios del recinto de su sesión.
const bcrypt = require('bcryptjs');
const { query, transaccion } = require('../config/db');
const HttpError = require('../utils/HttpError');
const ROLES = require('../utils/roles');
const { Filtros } = require('../utils/sql');
const { formatearRut } = require('../utils/rut');
const { obtenerPaginacion, respuestaPaginada } = require('../utils/paginacion');
const auditoria = require('./auditoria.service');
const sincronizacion = require('./sincronizacion.service');

const ROLES_RECINTO = [ROLES.ADMIN_RECINTO, ROLES.GUARDIA, ROLES.PROPIETARIO];
const NOMBRE_ROL = { admin_recinto: 'Administrador', guardia: 'Guardia', propietario: 'Propietario' };
const CAMPOS_PERSONALES = ['rut', 'nombre', 'apellido', 'email', 'telefono', 'password_hash'];

// ---------- Alcance de cada actor ----------

// Recintos activos donde la persona es administradora (con su rol activo)
async function recintosAdministrados(usuarioId) {
  const { rows } = await query(
    `SELECT ur.recinto_id FROM usuario_recinto ur
     JOIN roles r ON r.id = ur.rol_id JOIN recintos re ON re.id = ur.recinto_id
     WHERE ur.usuario_id = $1 AND r.nombre = $2 AND ur.activo AND re.activo
     ORDER BY re.nombre`,
    [usuarioId, ROLES.ADMIN_RECINTO]
  );
  return rows.map((r) => r.recinto_id);
}

// recintos: donde puede ver/gestionar (null = todos) · listado: recintos que muestra el listado
// visibles: roles que puede ver · gestiona: roles que puede asignar o quitar
async function alcance(actor) {
  if (actor.rol === ROLES.ADMIN_PLATAFORMA) {
    return { recintos: null, listado: null, visibles: [ROLES.ADMIN_RECINTO], gestiona: [ROLES.ADMIN_RECINTO] };
  }
  if (actor.rol === ROLES.ADMIN_RECINTO) {
    return { recintos: await recintosAdministrados(actor.id), listado: [actor.recinto_id], visibles: ROLES_RECINTO, gestiona: ROLES_RECINTO };
  }
  if (actor.rol === ROLES.GUARDIA) {
    return { recintos: [actor.recinto_id], listado: [actor.recinto_id], visibles: [ROLES.PROPIETARIO], gestiona: [] };
  }
  throw new HttpError(403, 'No tienes permiso para ver usuarios');
}

async function alcanceGestion(actor) {
  const a = await alcance(actor);
  if (a.gestiona.length === 0) throw new HttpError(403, 'No tienes permiso para gestionar usuarios');
  return a;
}

const enAlcance = (a, recintoId) => a.recintos === null || a.recintos.includes(recintoId);

// Condición "la persona tiene algún rol de la lista en esos recintos" (+ condición extra opcional)
function condicionVinculo(roles, recintos, extra = '', ...valoresExtra) {
  const valores = recintos ? [roles, recintos, ...valoresExtra] : [roles, ...valoresExtra];
  return {
    texto: `EXISTS (SELECT 1 FROM usuario_recinto x JOIN roles xr ON xr.id = x.rol_id
             WHERE x.usuario_id = u.id AND xr.nombre = ANY(?) ${recintos ? 'AND x.recinto_id = ANY(?)' : ''} ${extra})`,
    valores,
  };
}

// ---------- Lectura ----------

// Roles (vínculos) de las personas indicadas, solo los que el actor puede ver
async function cargarVinculos(ids, a) {
  const valores = [ids, a.visibles];
  if (a.recintos) valores.push(a.recintos);
  const { rows } = await query(
    `SELECT ur.id AS vinculo_id, ur.usuario_id, ur.recinto_id, re.nombre AS recinto_nombre, re.activo AS recinto_activo,
            r.nombre AS rol, ur.unidad_id, un.identificador AS unidad, ur.activo
     FROM usuario_recinto ur
     JOIN roles r ON r.id = ur.rol_id
     JOIN recintos re ON re.id = ur.recinto_id
     LEFT JOIN unidades un ON un.id = ur.unidad_id
     WHERE ur.usuario_id = ANY($1) AND r.nombre = ANY($2) ${a.recintos ? 'AND ur.recinto_id = ANY($3)' : ''}
     ORDER BY re.nombre, ur.recinto_id, r.id`,
    valores
  );
  return rows;
}

// Agrega a cada persona sus roles, su estado, su unidad y sus vehículos en el recinto de la sesión
async function completar(actor, a, personas) {
  if (personas.length === 0) return [];
  const ids = personas.map((p) => p.id);
  const vinculos = await cargarVinculos(ids, a);

  let vehiculos = [];
  let otros = [];
  if (actor.recinto_id) {
    ({ rows: vehiculos } = await query(
      `SELECT id, propietario_id, patente, marca, modelo, color, tipo, activo FROM vehiculos
       WHERE propietario_id = ANY($1) AND recinto_id = $2 ORDER BY patente`,
      [ids, actor.recinto_id]
    ));
    // En cuántos otros recintos participa (informativo)
    ({ rows: otros } = await query(
      `SELECT usuario_id, COUNT(DISTINCT recinto_id)::int AS total FROM usuario_recinto
       WHERE usuario_id = ANY($1) AND activo AND recinto_id <> $2 GROUP BY usuario_id`,
      [ids, actor.recinto_id]
    ));
  }

  return personas.map(({ total_filas: _, cuenta_activa: cuentaActiva, ...p }) => {
    const propios = vinculos.filter((v) => v.usuario_id === p.id).map(({ usuario_id: __, ...v }) => v);
    // Roles en el recinto del listado (o todos, para el admin de plataforma)
    const delListado = a.listado ? propios.filter((v) => a.listado.includes(v.recinto_id)) : propios;
    const base = delListado.length > 0 ? delListado : propios;
    const propietario = propios.find((v) => v.rol === ROLES.PROPIETARIO && v.recinto_id === actor.recinto_id);
    return {
      ...p,
      vinculos: propios,
      roles: delListado.map((v) => v.rol),
      activo: cuentaActiva && base.every((v) => v.activo),
      unidad_id: propietario ? propietario.unidad_id : null,
      unidad: propietario ? propietario.unidad : null,
      vehiculos: propietario ? vehiculos.filter((v) => v.propietario_id === p.id).map(({ propietario_id: __, ...v }) => v) : [],
      otros_recintos: (otros.find((o) => o.usuario_id === p.id) || { total: 0 }).total,
    };
  });
}

const SQL_PERSONAS = `
  SELECT u.id, u.rut, u.nombre, u.apellido, u.email, u.telefono, u.ultimo_login, u.created_at,
         u.activo AS cuenta_activa, COUNT(*) OVER() AS total_filas
  FROM usuarios u
`;

async function listar(actor, filtros) {
  const a = await alcance(actor);
  const roles = filtros.rol ? a.visibles.filter((r) => r === filtros.rol) : a.visibles;
  const recintos = a.listado || (filtros.recinto_id ? [filtros.recinto_id] : null);
  const paginacion = obtenerPaginacion(filtros);
  const f = new Filtros();

  const conRol = condicionVinculo(roles, recintos);
  f.agregar(conRol.texto, ...conRol.valores);

  if (filtros.busqueda) {
    // Nombre, email, RUT, unidad o patente de alguno de sus vehículos en el recinto
    const conUnidad = condicionVinculo(roles, recintos,
      `AND EXISTS (SELECT 1 FROM unidades un WHERE un.id = x.unidad_id AND un.identificador ILIKE '%' || ? || '%')`, filtros.busqueda);
    f.agregar(
      `(u.nombre || ' ' || u.apellido ILIKE '%' || ? || '%' OR u.email ILIKE '%' || ? || '%' OR u.rut ILIKE '%' || ? || '%'
        OR ${conUnidad.texto}
        OR EXISTS (SELECT 1 FROM vehiculos v WHERE v.propietario_id = u.id ${recintos ? 'AND v.recinto_id = ANY(?)' : ''}
                   AND v.patente ILIKE '%' || ? || '%'))`,
      filtros.busqueda, filtros.busqueda, filtros.busqueda, ...conUnidad.valores,
      ...(recintos ? [recintos] : []), filtros.busqueda
    );
  }
  if (filtros.activo !== undefined) {
    const inactivo = condicionVinculo(roles, recintos, 'AND NOT x.activo');
    f.agregar(filtros.activo ? `(u.activo AND NOT ${inactivo.texto})` : `(NOT u.activo OR ${inactivo.texto})`, ...inactivo.valores);
  }
  if (filtros.unidad_id) {
    const conUnidad = condicionVinculo(roles, recintos, 'AND x.unidad_id = ?', filtros.unidad_id);
    f.agregar(conUnidad.texto, ...conUnidad.valores);
  }

  const limite = f.parametro(paginacion.limite);
  const offset = f.parametro(paginacion.offset);
  const { rows } = await query(
    `${SQL_PERSONAS} ${f.where} ORDER BY u.apellido, u.nombre LIMIT ${limite} OFFSET ${offset}`,
    f.valores
  );
  const total = rows.length > 0 ? rows[0].total_filas : 0;
  return respuestaPaginada((await completar(actor, a, rows)).map((p) => ({ ...p, total_filas: total })), paginacion);
}

// Una persona con algún rol visible (o gestionable) dentro del alcance del actor; si no, 404
async function buscarPersona(actor, a, id, { gestionable = false } = {}) {
  const f = new Filtros();
  f.agregar('u.id = ?', id);
  const conRol = condicionVinculo(gestionable ? a.gestiona : a.visibles, a.recintos);
  f.agregar(conRol.texto, ...conRol.valores);
  const { rows } = await query(`${SQL_PERSONAS} ${f.where}`, f.valores);
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  return (await completar(actor, a, rows))[0];
}

async function obtener(actor, id) {
  return buscarPersona(actor, await alcance(actor), id);
}

// Recintos (y sus unidades) donde el actor puede asignar roles: alimenta el formulario de personas
async function opciones(actor) {
  const a = await alcanceGestion(actor);
  const { rows: recintos } = await query(
    `SELECT id, nombre, comuna, activo FROM recintos ${a.recintos ? 'WHERE id = ANY($1)' : ''} ORDER BY nombre`,
    a.recintos ? [a.recintos] : []
  );
  if (a.gestiona.includes(ROLES.PROPIETARIO) && recintos.length > 0) {
    const { rows: unidades } = await query(
      'SELECT id, recinto_id, identificador, activo FROM unidades WHERE recinto_id = ANY($1) ORDER BY identificador',
      [recintos.map((r) => r.id)]
    );
    for (const r of recintos) r.unidades = unidades.filter((u) => u.recinto_id === r.id).map(({ recinto_id: _, ...u }) => u);
  }
  // El recinto de la sesión va primero
  recintos.sort((x, y) => (y.id === actor.recinto_id) - (x.id === actor.recinto_id));
  return { roles: a.gestiona, recintos };
}

// ---------- Roles ----------

// Revisa y normaliza la lista de roles pedida: [{ recinto_id, rol, unidad_id }]
async function validarRoles(a, roles) {
  const lista = [];
  for (const r of roles || []) {
    if (!a.gestiona.includes(r.rol)) throw new HttpError(403, `No puedes asignar el rol ${NOMBRE_ROL[r.rol] || r.rol}`);
    if (!enAlcance(a, r.recinto_id)) throw new HttpError(403, 'Solo puedes asignar roles en los recintos que administras');
    if (lista.some((x) => x.recinto_id === r.recinto_id && x.rol === r.rol)) continue;
    const esPropietario = r.rol === ROLES.PROPIETARIO;
    if (esPropietario && !r.unidad_id) throw new HttpError(400, 'Indica la unidad del propietario en cada recinto');
    lista.push({ recinto_id: r.recinto_id, rol: r.rol, unidad_id: esPropietario ? r.unidad_id : null });
  }

  const recintos = [...new Set(lista.map((r) => r.recinto_id))];
  if (recintos.length > 0) {
    const { rows } = await query('SELECT id, nombre FROM recintos WHERE id = ANY($1)', [recintos]);
    if (rows.length !== recintos.length) throw new HttpError(400, 'Uno de los recintos no existe');
    for (const r of lista) r.recinto_nombre = rows.find((x) => x.id === r.recinto_id).nombre;
  }
  const conUnidad = lista.filter((r) => r.unidad_id);
  if (conUnidad.length > 0) {
    const { rows } = await query('SELECT id, recinto_id, identificador, activo FROM unidades WHERE id = ANY($1)', [conUnidad.map((r) => r.unidad_id)]);
    for (const r of conUnidad) {
      const unidad = rows.find((x) => x.id === r.unidad_id);
      if (!unidad || unidad.recinto_id !== r.recinto_id) throw new HttpError(400, `La unidad no pertenece a ${r.recinto_nombre}`);
      r.unidad = unidad.identificador;
      r.unidad_activa = unidad.activo;
    }
  }
  return lista;
}

const mismoRol = (x, y) => x.recinto_id === y.recinto_id && x.rol === y.rol;
const textoRol = (r) => NOMBRE_ROL[r.rol] + (r.unidad ? ` (${r.unidad})` : '');

// Inserta un rol. Si la persona está desactivada en ese recinto, el nuevo rol también queda desactivado.
async function insertarRol(cliente, usuarioId, r) {
  await cliente.query(
    `INSERT INTO usuario_recinto (usuario_id, recinto_id, rol_id, unidad_id, activo)
     VALUES ($1, $2, (SELECT id FROM roles WHERE nombre = $3), $4,
             NOT EXISTS (SELECT 1 FROM usuario_recinto WHERE usuario_id = $1 AND recinto_id = $2 AND NOT activo))`,
    [usuarioId, r.recinto_id, r.rol, r.unidad_id]
  );
}

// Calcula y aplica los cambios entre los roles actuales (dentro del alcance) y los pedidos
async function aplicarRoles(cliente, actor, a, persona, deseados) {
  const actuales = persona.vinculos.filter((v) => a.gestiona.includes(v.rol) && enAlcance(a, v.recinto_id));
  const quitar = actuales.filter((v) => !deseados.some((d) => mismoRol(d, v)));
  const agregar = deseados.filter((d) => !actuales.some((v) => mismoRol(d, v)));
  const cambiarUnidad = deseados.filter((d) => d.unidad_id && actuales.some((v) => mismoRol(d, v) && v.unidad_id !== d.unidad_id));

  if (persona.id === actor.id && quitar.some((v) => v.rol === ROLES.ADMIN_RECINTO)) {
    throw new HttpError(400, 'No puedes quitarte tu propio rol de administrador. Pídeselo a otro administrador del recinto.');
  }
  for (const r of [...agregar, ...cambiarUnidad]) {
    if (r.unidad_id && r.unidad_activa === false) throw new HttpError(400, `La unidad ${r.unidad} está desactivada`);
  }

  for (const v of quitar) await cliente.query('DELETE FROM usuario_recinto WHERE id = $1', [v.vinculo_id]);
  for (const r of cambiarUnidad) {
    const v = actuales.find((x) => mismoRol(r, x));
    await cliente.query('UPDATE usuario_recinto SET unidad_id = $2 WHERE id = $1', [v.vinculo_id, r.unidad_id]);
  }
  for (const r of agregar) await insertarRol(cliente, persona.id, r);
  return { actuales, quitar, agregar, cambiarUnidad };
}

// Una entrada de auditoría por cada recinto afectado (así cada recinto ve sus propios cambios)
async function auditarRoles(actor, persona, cambios, deseados, accion) {
  const { actuales, quitar, agregar, cambiarUnidad } = cambios;
  const recintos = new Set([...quitar, ...agregar, ...cambiarUnidad].map((r) => r.recinto_id));
  for (const recintoId of recintos) {
    const nombreRecinto = ([...deseados, ...actuales].find((r) => r.recinto_id === recintoId) || {}).recinto_nombre;
    const partes = [];
    const agregados = agregar.filter((r) => r.recinto_id === recintoId);
    const quitados = quitar.filter((r) => r.recinto_id === recintoId);
    const unidades = cambiarUnidad.filter((r) => r.recinto_id === recintoId);
    if (agregados.length) partes.push('se agregó ' + agregados.map(textoRol).join(', '));
    if (quitados.length) partes.push('se quitó ' + quitados.map(textoRol).join(', '));
    if (unidades.length) partes.push('cambió la unidad a ' + unidades.map((r) => r.unidad).join(', '));
    await auditoria.registrar(actor, {
      accion, entidad: 'usuarios', entidadId: persona.id, recintoId,
      antes: { roles: actuales.filter((r) => r.recinto_id === recintoId).map(textoRol) },
      despues: { roles: deseados.filter((r) => r.recinto_id === recintoId).map(textoRol) },
      detalle: `Roles de ${persona.nombre} ${persona.apellido} en ${nombreRecinto}: ${partes.join('; ')}`,
    });
  }
  // Si cambió un rol de propietario, la lista de patentes de ese recinto puede cambiar (HU-36)
  for (const r of [...quitar, ...agregar, ...cambiarUnidad]) {
    if (r.rol === ROLES.PROPIETARIO) sincronizacion.notificarCambio(r.recinto_id);
  }
}

// ---------- Creación y edición ----------

// Normaliza los datos que vienen del formulario
async function prepararDatos(datos) {
  const limpio = { ...datos };
  if (limpio.rut) limpio.rut = formatearRut(limpio.rut);
  if (limpio.email) limpio.email = limpio.email.toLowerCase();
  if (limpio.password) limpio.password_hash = await bcrypt.hash(limpio.password, 10);
  delete limpio.password;
  return limpio;
}

// Crea a la persona con sus roles. Si ya tiene cuenta (mismo email y RUT), solo se le agregan los roles:
// así nadie necesita una segunda cuenta para ser, por ejemplo, guardia y propietario.
async function crear(actor, datos) {
  const a = await alcanceGestion(actor);
  const deseados = await validarRoles(a, datos.roles);
  if (deseados.length === 0) throw new HttpError(400, 'Asigna al menos un rol en algún recinto');
  const d = await prepararDatos(datos);

  const { rows: existentes } = await query(
    'SELECT id, rut, email, es_admin_plataforma FROM usuarios WHERE email = $1 OR rut = $2',
    [d.email, d.rut]
  );
  const existente = existentes.find((u) => u.email === d.email);
  if (!existente && existentes.length > 0) {
    throw new HttpError(409, 'Ese RUT ya tiene una cuenta con otro email. Usa el email de esa cuenta para agregarle roles.');
  }
  if (existente && existente.es_admin_plataforma) throw new HttpError(409, 'Ese email pertenece al administrador de plataforma');
  if (existente && existente.rut !== d.rut) throw new HttpError(409, 'Ese email ya está registrado con otro RUT');
  if (!existente && !d.password_hash) throw new HttpError(400, 'Debes indicar una contraseña inicial');

  let persona;
  let cambios;
  await transaccion(async (cliente) => {
    let id;
    if (existente) {
      id = existente.id;
    } else {
      const { rows } = await cliente.query(
        `INSERT INTO usuarios (rut, nombre, apellido, email, password_hash, telefono)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [d.rut, d.nombre, d.apellido, d.email, d.password_hash, d.telefono || null]
      );
      id = rows[0].id;
    }
    // Roles que ya tenía (en el alcance del actor) se conservan; solo se agregan los nuevos
    const vinculos = existente ? await cargarVinculos([id], a) : [];
    const yaTenia = vinculos.filter((v) => deseados.some((x) => mismoRol(x, v)));
    const nuevos = deseados.filter((x) => !vinculos.some((v) => mismoRol(x, v)));
    if (existente && nuevos.length === 0) {
      throw new HttpError(409, yaTenia.some((v) => !v.activo)
        ? 'Esta persona ya tiene esos roles pero está desactivada: actívala desde el listado'
        : 'Esta persona ya tiene esos roles');
    }
    for (const r of nuevos) {
      if (r.unidad_id && r.unidad_activa === false) throw new HttpError(400, `La unidad ${r.unidad} está desactivada`);
      await insertarRol(cliente, id, r);
    }
    persona = { id, nombre: d.nombre, apellido: d.apellido };
    cambios = { actuales: vinculos, quitar: [], agregar: nuevos, cambiarUnidad: [] };
  });

  const creado = await buscarPersona(actor, a, persona.id);
  await auditarRoles(actor, creado, cambios, [...cambios.actuales, ...cambios.agregar], existente ? 'vincular' : 'crear');
  return { ...creado, vinculado: Boolean(existente) };
}

// Edita los datos personales y, si vienen, reemplaza sus roles dentro del alcance del actor.
// Los roles en recintos que el actor no administra no se tocan.
async function actualizar(actor, id, datos) {
  const a = await alcanceGestion(actor);
  const actual = await buscarPersona(actor, a, id, { gestionable: true });
  const d = await prepararDatos(datos);
  const personales = CAMPOS_PERSONALES.filter((c) => d[c] !== undefined);
  const deseados = d.roles !== undefined ? await validarRoles(a, d.roles) : null;
  if (personales.length === 0 && !deseados) throw new HttpError(400, 'No hay datos para actualizar');

  let cambios = null;
  await transaccion(async (cliente) => {
    if (personales.length > 0) {
      await cliente.query(
        `UPDATE usuarios SET ${personales.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...personales.map((c) => d[c])]
      );
    }
    if (deseados) cambios = await aplicarRoles(cliente, actor, a, actual, deseados);
  });

  if (personales.length > 0) {
    const resumen = (p) => Object.fromEntries(['rut', 'nombre', 'apellido', 'email', 'telefono'].map((c) => [c, p[c]]));
    const nuevo = await query('SELECT rut, nombre, apellido, email, telefono FROM usuarios WHERE id = $1', [id]);
    await auditoria.registrar(actor, {
      accion: 'editar', entidad: 'usuarios', entidadId: id, antes: resumen(actual), despues: resumen(nuevo.rows[0]),
      detalle: `Datos de ${actual.nombre} ${actual.apellido}` + (d.password_hash ? ' (se cambió la contraseña)' : ''),
    });
  }
  if (cambios) await auditarRoles(actor, actual, cambios, deseados, 'editar');

  // Si ya no tiene roles visibles para el actor (ej. se le quitaron todos), se informa con quitado: true
  try {
    return await buscarPersona(actor, a, id);
  } catch (error) {
    if (error.status === 404) return { id, quitado: true };
    throw error;
  }
}

// Activa o desactiva a la persona en un recinto (todos sus roles de ese recinto).
// El admin de plataforma, sin recinto, activa o desactiva todos sus roles de administrador.
async function cambiarEstado(actor, id, activo, recintoId) {
  if (id === actor.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta');
  const a = await alcanceGestion(actor);
  const persona = await buscarPersona(actor, a, id, { gestionable: true });
  const recinto = actor.rol === ROLES.ADMIN_PLATAFORMA ? recintoId || null : recintoId || actor.recinto_id;
  if (recinto && !enAlcance(a, recinto)) throw new HttpError(403, 'Solo puedes gestionar los recintos que administras');

  const afectados = persona.vinculos.filter((v) => a.gestiona.includes(v.rol) && (recinto ? v.recinto_id === recinto : enAlcance(a, v.recinto_id)));
  if (afectados.length === 0) throw new HttpError(404, 'La persona no tiene roles en ese recinto');
  await query('UPDATE usuario_recinto SET activo = $2 WHERE id = ANY($1)', [afectados.map((v) => v.vinculo_id), activo]);

  for (const recintoAfectado of new Set(afectados.map((v) => v.recinto_id))) {
    const delRecinto = afectados.filter((v) => v.recinto_id === recintoAfectado);
    await auditoria.registrar(actor, {
      accion: activo ? 'activar' : 'desactivar', entidad: 'usuarios', entidadId: id, recintoId: recintoAfectado,
      antes: { activo: delRecinto.every((v) => v.activo) }, despues: { activo },
      detalle: `${persona.nombre} ${persona.apellido} en ${delRecinto[0].recinto_nombre} (${delRecinto.map(textoRol).join(', ')})`,
    });
    // Los vehículos y visitas de un propietario desactivado dejan de estar autorizados
    if (delRecinto.some((v) => v.rol === ROLES.PROPIETARIO)) sincronizacion.notificarCambio(recintoAfectado);
  }
  return buscarPersona(actor, a, id);
}

// ---------- Mi perfil ----------

// Roles propios que el admin de recinto puede editar (en los recintos que administra)
async function misRoles(actor) {
  if (actor.rol !== ROLES.ADMIN_RECINTO) return null;
  const a = await alcanceGestion(actor);
  return (await cargarVinculos([actor.id], a)).map(({ usuario_id: _, ...v }) => v);
}

// El admin de recinto se agrega o quita roles a sí mismo (ej. también es guardia o propietario)
async function actualizarMisRoles(actor, roles) {
  if (actor.rol !== ROLES.ADMIN_RECINTO) throw new HttpError(403, 'Solo un administrador de recinto puede editar sus roles');
  const a = await alcanceGestion(actor);
  const yo = await buscarPersona(actor, a, actor.id, { gestionable: true });
  const deseados = await validarRoles(a, roles);
  const cambios = await transaccion((cliente) => aplicarRoles(cliente, actor, a, yo, deseados));
  await auditarRoles(actor, yo, cambios, deseados, 'editar');
  return misRoles(actor);
}

module.exports = { listar, obtener, opciones, crear, actualizar, cambiarEstado, misRoles, actualizarMisRoles };
