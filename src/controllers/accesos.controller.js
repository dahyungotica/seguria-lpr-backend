// Controlador de accesos
const accesosService = require('../services/accesos.service');
const noImplementado = require('../utils/noImplementado');
const { datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await accesosService.listar(req.usuario, datosQuery(req)));
}

async function obtener(req, res) {
  res.json(await accesosService.obtener(req.usuario, idDeRuta(req)));
}

async function estadisticas(req, res) {
  res.json(await accesosService.estadisticas(req.usuario.recinto_id));
}

module.exports = {
  listar,
  obtener,
  estadisticas,
  // Pendiente: módulo del guardia
  autorizarManual: noImplementado('Autorizar ingreso manualmente'),
};
