// Controlador de recintos
const recintosService = require('../services/recintos.service');
const { datosBody, datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await recintosService.listar(datosQuery(req)));
}

async function obtener(req, res) {
  res.json(await recintosService.obtener(req.usuario, idDeRuta(req)));
}

async function crear(req, res) {
  res.status(201).json(await recintosService.crear(datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await recintosService.actualizar(idDeRuta(req), datosBody(req)));
}

async function cambiarEstado(req, res) {
  res.json(await recintosService.cambiarEstado(idDeRuta(req), datosBody(req).activo));
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
