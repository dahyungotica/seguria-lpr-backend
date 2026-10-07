// Controlador de auditoría (solo lectura: la bitácora no se edita ni se elimina)
const auditoriaService = require('../services/auditoria.service');
const { datosQuery } = require('../utils/datosValidados');

async function listar(req, res) {
  res.json(await auditoriaService.listar(req.usuario, datosQuery(req)));
}

module.exports = { listar };
