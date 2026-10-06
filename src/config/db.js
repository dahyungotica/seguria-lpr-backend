// Pool de conexiones a PostgreSQL
const { Pool, types } = require('pg');
const { env } = require('./env');

// Por defecto pg devuelve BIGINT (ids de accesos/notificaciones, COUNT) como texto.
// Nuestros valores caben de sobra en un número de JavaScript, así que se convierten.
types.setTypeParser(types.builtins.INT8, (valor) => parseInt(valor, 10));

let pool = null;

if (env.DATABASE_URL) {
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Render (conexión externa) exige SSL; en local normalmente no
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  // Evita que un error de una conexión inactiva tumbe el servidor
  pool.on('error', (err) => {
    console.error('Error inesperado en el pool de PostgreSQL:', err.message);
  });
}

// Ejecuta una consulta. Lanza un error claro si no hay BD configurada.
async function query(texto, parametros) {
  if (!pool) {
    const error = new Error('Base de datos no configurada (falta DATABASE_URL)');
    error.status = 503;
    throw error;
  }
  return pool.query(texto, parametros);
}

module.exports = { pool, query };
