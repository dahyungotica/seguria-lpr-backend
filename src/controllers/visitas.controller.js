// Controlador de visitas (el alcance por rol se resuelve en el servicio)
const visitasService = require('../services/visitas.service');
const { datosBody, datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await visitasService.listar(req.usuario, datosQuery(req)));
}

async function obtener(req, res) {
  res.json(await visitasService.obtener(req.usuario, idDeRuta(req)));
}

async function crear(req, res) {
  res.status(201).json(await visitasService.crear(req.usuario, datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await visitasService.actualizar(req.usuario, idDeRuta(req), datosBody(req)));
}

async function cancelar(req, res) {
  res.json(await visitasService.cancelar(req.usuario, idDeRuta(req)));
}

module.exports = { listar, obtener, crear, actualizar, cancelar };
