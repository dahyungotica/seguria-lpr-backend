// Autenticación de las Raspberry Pi mediante headers X-Dispositivo-Id y X-API-Key.
// TODO: buscar el dispositivo por su identificador y comparar la key con api_key_hash (bcrypt).
function autenticarDispositivo(req, res) {
  const apiKey = req.headers['x-api-key'];
  const identificador = req.headers['x-dispositivo-id'];

  if (!apiKey || !identificador) {
    return res.status(401).json({ error: 'Credenciales de dispositivo no proporcionadas' });
  }

  // Pendiente: validar contra la tabla dispositivos y llamar a next()
  return res.status(501).json({ error: 'No implementado', accion: 'Autenticación de dispositivos' });
}

module.exports = autenticarDispositivo;
