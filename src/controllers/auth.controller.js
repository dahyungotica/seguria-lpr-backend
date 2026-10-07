// Controlador de autenticación: recibe la petición, llama al servicio y responde
const authService = require('../services/auth.service');
const { datosBody } = require('../utils/datosValidados');

async function login(req, res) {
  const { email, password } = req.body;
  res.json(await authService.login(email, password));
}

// Elegir o cambiar el recinto de trabajo (usuarios con más de un recinto)
async function seleccionarRecinto(req, res) {
  res.json(await authService.seleccionarRecinto(req.usuario, datosBody(req).recinto_id));
}

async function me(req, res) {
  res.json(await authService.obtenerUsuarioActual(req.usuario));
}

module.exports = { login, seleccionarRecinto, me };
