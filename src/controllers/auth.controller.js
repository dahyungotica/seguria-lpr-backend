// Controlador de autenticación: recibe la petición, llama al servicio y responde
const authService = require('../services/auth.service');

async function login(req, res) {
  const { email, password } = req.body;
  const resultado = await authService.login(email, password);
  res.json(resultado);
}

async function me(req, res) {
  const usuario = await authService.obtenerUsuarioActual(req.usuario.id);
  res.json({ usuario });
}

module.exports = { login, me };
