// Controlador de vehículos (el alcance por rol se resuelve en el servicio)
const vehiculosService = require('../services/vehiculos.service');
const { datosBody, datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await vehiculosService.listar(req.usuario, datosQuery(req)));
}

async function obtener(req, res) {
  res.json(await vehiculosService.obtener(req.usuario, idDeRuta(req)));
}

async function crear(req, res) {
  res.status(201).json(await vehiculosService.crear(req.usuario, datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await vehiculosService.actualizar(req.usuario, idDeRuta(req), datosBody(req)));
}

async function eliminar(req, res) {
  await vehiculosService.eliminar(req.usuario, idDeRuta(req));
  res.status(204).end();
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
