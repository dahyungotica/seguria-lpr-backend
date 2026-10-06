// Controlador de dispositivos (Raspberry Pi)
const dispositivosService = require('../services/dispositivos.service');
const noImplementado = require('../utils/noImplementado');
const { datosBody, idDeRuta } = require('../utils/datosValidados');

// ----- Gestión desde el panel del admin de recinto -----

async function listar(req, res) {
  res.json(await dispositivosService.listar(req.usuario.recinto_id));
}

async function obtener(req, res) {
  res.json(await dispositivosService.obtener(req.usuario.recinto_id, idDeRuta(req)));
}

// Responde la API key en claro una sola vez
async function crear(req, res) {
  res.status(201).json(await dispositivosService.crear(req.usuario.recinto_id, datosBody(req)));
}

async function actualizar(req, res) {
  res.json(await dispositivosService.actualizar(req.usuario.recinto_id, idDeRuta(req), datosBody(req)));
}

async function eliminar(req, res) {
  await dispositivosService.eliminar(req.usuario.recinto_id, idDeRuta(req));
  res.status(204).end();
}

async function regenerarApiKey(req, res) {
  res.json(await dispositivosService.regenerarApiKey(req.usuario.recinto_id, idDeRuta(req)));
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  regenerarApiKey,
  // ----- Endpoints de la Raspberry Pi (pendientes) -----
  heartbeat: noImplementado('Heartbeat del dispositivo'),
  obtenerPatentes: noImplementado('Sincronizar patentes autorizadas'),
  registrarAcceso: noImplementado('Registrar acceso desde dispositivo'),
};
