// Controlador de notificaciones del usuario autenticado
const notificacionesService = require('../services/notificaciones.service');
const { datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await notificacionesService.listar(req.usuario, datosQuery(req)));
}

async function contarNoLeidas(req, res) {
  res.json({ total: await notificacionesService.contarNoLeidas(req.usuario) });
}

async function marcarLeida(req, res) {
  await notificacionesService.marcarLeida(req.usuario, idDeRuta(req));
  res.status(204).end();
}

async function marcarTodasLeidas(req, res) {
  res.json({ actualizadas: await notificacionesService.marcarTodasLeidas(req.usuario) });
}

module.exports = { listar, contarNoLeidas, marcarLeida, marcarTodasLeidas };
