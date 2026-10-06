// Manejo centralizado de errores y de rutas inexistentes
const { env } = require('../config/env');

// Mensajes amigables para restricciones UNIQUE de la BD
const MENSAJES_UNIQUE = {
  usuarios_email_key: 'Ya existe un usuario con ese email',
  usuarios_rut_key: 'Ya existe un usuario con ese RUT',
  uq_unidades_recinto_identificador: 'Ya existe una unidad con ese identificador en el recinto',
  dispositivos_identificador_key: 'Ya existe un dispositivo con ese identificador',
  uq_vehiculos_recinto_patente: 'Esa patente ya está registrada en el recinto',
  roles_nombre_key: 'Ese rol ya existe',
};

// Traduce errores de PostgreSQL a respuestas HTTP comprensibles
function traducirErrorPg(err) {
  switch (err.code) {
    case '23505': // unique_violation
      return { status: 409, mensaje: MENSAJES_UNIQUE[err.constraint] || 'El registro ya existe' };
    case '23503': // foreign_key_violation
    case '23001': // restrict_violation (ON DELETE RESTRICT)
      return {
        status: 409,
        mensaje: 'No se puede completar la operación porque el registro tiene datos asociados. Prueba desactivarlo en vez de eliminarlo.',
      };
    case '23514': // check_violation
      return { status: 400, mensaje: 'Algún dato no cumple las reglas permitidas' };
    case 'P0001': // RAISE EXCEPTION de nuestros triggers (mensaje ya está en español)
      return { status: 400, mensaje: err.message };
    case '22P02': // texto inválido para el tipo (ej. id no numérico)
      return { status: 400, mensaje: 'Formato de dato inválido' };
    default:
      return null;
  }
}

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

  const errorPg = traducirErrorPg(err);
  if (errorPg) {
    return res.status(errorPg.status).json({ error: errorPg.mensaje });
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
