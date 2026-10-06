// Autenticación de las Raspberry Pi mediante los headers X-Dispositivo-Id y X-API-Key.
// Si es válida, deja el equipo en req.dispositivo = { id, recinto_id, nombre }.
const dispositivosService = require('../services/dispositivos.service');

async function autenticarDispositivo(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const identificador = req.headers['x-dispositivo-id'];

  if (!apiKey || !identificador) {
    return res.status(401).json({ error: 'Credenciales de dispositivo no proporcionadas' });
  }

  req.dispositivo = await dispositivosService.autenticar(String(identificador), String(apiKey));
  next();
}

module.exports = autenticarDispositivo;
