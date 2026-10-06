// Controlador de unidades (siempre del recinto del usuario autenticado)
const unidadesService = require('../services/unidades.service');
const { datosBody, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await unidadesService.listar(req.usuario.recinto_id));
}

async function obtener(req, res) {
  res.json(await unidadesService.obtener(req.usuario.recinto_id, idDeRuta(req)));
}

async function crear(req, res) {
  res.status(201).json(await unidadesService.crear(req.usuario.recinto_id, datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await unidadesService.actualizar(req.usuario.recinto_id, idDeRuta(req), datosBody(req)));
}

async function eliminar(req, res) {
  await unidadesService.eliminar(req.usuario.recinto_id, idDeRuta(req));
  res.status(204).end();
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
