// Controlador de usuarios (el alcance por rol se resuelve en el servicio)
const usuariosService = require('../services/usuarios.service');
const { datosBody, datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await usuariosService.listar(req.usuario, datosQuery(req)));
}

async function obtener(req, res) {
  res.json(await usuariosService.obtener(req.usuario, idDeRuta(req)));
}

async function crear(req, res) {
  res.status(201).json(await usuariosService.crear(req.usuario, datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await usuariosService.actualizar(req.usuario, idDeRuta(req), datosBody(req)));
}

async function cambiarEstado(req, res) {
  const { activo, vinculo_id: vinculoId } = datosBody(req);
  res.json(await usuariosService.cambiarEstado(req.usuario, idDeRuta(req), activo, vinculoId));
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
