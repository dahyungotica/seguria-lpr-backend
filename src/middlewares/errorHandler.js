// Manejo centralizado de errores y de rutas inexistentes
const { env } = require('../config/env');

function rutaNoEncontrada(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

// Express reconoce un manejador de errores porque recibe 4 parámetros
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // JSON mal formado en el body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    // En producción no se exponen detalles internos de los errores 500
    error: status >= 500 && env.esProduccion ? 'Error interno del servidor' : err.message,
    ...(err.detalles ? { detalles: err.detalles } : {}),
  });
}

module.exports = { rutaNoEncontrada, errorHandler };
