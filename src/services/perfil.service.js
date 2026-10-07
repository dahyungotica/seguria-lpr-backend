// Mi perfil: cada persona ve y edita sus propios datos, cambia su contraseña y revisa sus roles.
// El administrador de recinto además puede agregarse roles (ej. también es guardia o propietario)
// en los recintos que administra.
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const HttpError = require('../utils/HttpError');
const auditoria = require('./auditoria.service');
const { recintosDelUsuario } = require('./auth.service');
const usuariosService = require('./usuarios.service');

const CAMPOS_EDITABLES = ['nombre', 'apellido', 'email', 'telefono'];

async function obtener(actor) {
  const { rows } = await query(
    `SELECT id, rut, nombre, apellido, email, telefono, ultimo_login, created_at, es_admin_plataforma
     FROM usuarios WHERE id = $1`,
    [actor.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  return {
    ...rows[0],
    // Todos sus recintos y roles (para entrar con otro rol desde el perfil)
    recintos: rows[0].es_admin_plataforma ? [] : await recintosDelUsuario(actor.id),
    // Solo para el admin de recinto: sus roles en los recintos que administra (editables)
    roles_editables: await usuariosService.misRoles(actor),
  };
}

async function actualizar(actor, datos) {
  const campos = CAMPOS_EDITABLES.filter((c) => datos[c] !== undefined);
  if (campos.length === 0) throw new HttpError(400, 'No hay datos para actualizar');
  const { rows: antes } = await query('SELECT nombre, apellido, email, telefono FROM usuarios WHERE id = $1', [actor.id]);
  const valores = campos.map((c) => (c === 'email' ? datos[c].toLowerCase() : datos[c]));
  await query(`UPDATE usuarios SET ${campos.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [actor.id, ...valores]);
  const { rows: despues } = await query('SELECT nombre, apellido, email, telefono FROM usuarios WHERE id = $1', [actor.id]);
  await auditoria.registrar(actor, {
    accion: 'editar', entidad: 'usuarios', entidadId: actor.id, antes: antes[0], despues: despues[0], detalle: 'Editó sus datos personales',
  });
  return obtener(actor);
}

async function cambiarPassword(actor, actual, nueva) {
  const { rows } = await query('SELECT password_hash FROM usuarios WHERE id = $1', [actor.id]);
  if (!(await bcrypt.compare(actual, rows[0].password_hash))) {
    throw new HttpError(400, 'La contraseña actual no es correcta');
  }
  if (actual === nueva) throw new HttpError(400, 'La nueva contraseña debe ser distinta de la actual');
  await query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [actor.id, await bcrypt.hash(nueva, 10)]);
  await auditoria.registrar(actor, { accion: 'editar', entidad: 'usuarios', entidadId: actor.id, detalle: 'Cambió su contraseña' });
}

async function actualizarRoles(actor, roles) {
  await usuariosService.actualizarMisRoles(actor, roles);
  return obtener(actor);
}

module.exports = { obtener, actualizar, cambiarPassword, actualizarRoles };
