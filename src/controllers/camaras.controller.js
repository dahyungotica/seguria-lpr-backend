// Controlador de cámaras (siempre del recinto del usuario autenticado)
const camarasService = require('../services/camaras.service');
const { datosBody, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await camarasService.listar(req.usuario.recinto_id));
}

async function obtener(req, res) {
  res.json(await camarasService.obtener(req.usuario.recinto_id, idDeRuta(req)));
}

async function crear(req, res) {
  res.status(201).json(await camarasService.crear(req.usuario.recinto_id, datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await camarasService.actualizar(req.usuario.recinto_id, idDeRuta(req), datosBody(req)));
}

async function eliminar(req, res) {
  await camarasService.eliminar(req.usuario.recinto_id, idDeRuta(req));
  res.status(204).end();
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
