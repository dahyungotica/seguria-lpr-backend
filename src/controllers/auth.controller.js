// Controlador de autenticación: recibe la petición, llama al servicio y responde
const authService = require('../services/auth.service');
const { datosBody } = require('../utils/datosValidados');

async function login(req, res) {
  const { email, password } = req.body;
  res.json(await authService.login(email, password));
}

// Elegir o cambiar el portal de trabajo (recinto + rol) de quien tiene más de uno
async function seleccionarRecinto(req, res) {
  const { recinto_id: recintoId, rol } = datosBody(req);
  res.json(await authService.seleccionarRecinto(req.usuario, recintoId, rol));
}

async function me(req, res) {
  res.json(await authService.obtenerUsuarioActual(req.usuario));
}

module.exports = { login, seleccionarRecinto, me };
