// Controlador de accesos
const accesosService = require('../services/accesos.service');
const { datosBody, datosQuery, idDeRuta } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await accesosService.listar(req.usuario, datosQuery(req)));
}

async function obtener(req, res) {
  res.json(await accesosService.obtener(req.usuario, idDeRuta(req)));
}

async function estadisticas(req, res) {
  res.json(await accesosService.estadisticas(req.usuario.recinto_id));
}

// El guardia autoriza un ingreso denegado dejando el motivo
async function autorizarManual(req, res) {
  const { detalle_autorizacion: detalle } = datosBody(req);
  res.json(await accesosService.autorizarManual(req.usuario, idDeRuta(req), detalle));
}

module.exports = { listar, obtener, estadisticas, autorizarManual };
