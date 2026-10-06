// Revisa el resultado de las reglas de express-validator y responde 400 si hay errores
const { validationResult } = require('express-validator');

function validar(req, res, next) {
  const errores = validationResult(req);
  if (!errores.isEmpty()) {
    return res.status(400).json({
      error: 'Datos inválidos',
      // Solo el primer error de cada campo, para no repetir mensajes
      detalles: errores.array({ onlyFirstError: true }).map((e) => ({ campo: e.path, mensaje: e.msg })),
    });
  }
  next();
}

module.exports = validar;
