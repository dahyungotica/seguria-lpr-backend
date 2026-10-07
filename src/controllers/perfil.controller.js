// Controlador de "Mi perfil" (siempre sobre la cuenta de la sesión)
const perfilService = require('../services/perfil.service');
const { datosBody } = require('../utils/datosValidados');

async function obtener(req, res) {
  res.json(await perfilService.obtener(req.usuario));
}

async function actualizar(req, res) {
  res.json(await perfilService.actualizar(req.usuario, datosBody(req)));
}

async function cambiarPassword(req, res) {
  const { password_actual: actual, password } = datosBody(req);
  await perfilService.cambiarPassword(req.usuario, actual, password);
  res.json({ ok: true });
}

async function actualizarRoles(req, res) {
  res.json(await perfilService.actualizarRoles(req.usuario, datosBody(req).roles));
}

module.exports = { obtener, actualizar, cambiarPassword, actualizarRoles };
