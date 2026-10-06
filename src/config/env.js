// Carga las variables de entorno desde .env y las expone en un solo objeto
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const env = {
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  DB_SSL: process.env.DB_SSL === 'true',
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  // Lista de orígenes permitidos por CORS (separados por coma)
  FRONTEND_URL: (process.env.FRONTEND_URL || '')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean),
  CLOUDINARY_URL: process.env.CLOUDINARY_URL || '',
};

env.esProduccion = env.NODE_ENV === 'production';

// Revisa que existan las variables necesarias para levantar el servidor.
// Se llama desde src/index.js (los scripts de BD solo necesitan DATABASE_URL).
function validarEnv() {
  const errores = [];

  if (!env.JWT_SECRET) {
    errores.push('JWT_SECRET es obligatoria');
  } else if (env.esProduccion && env.JWT_SECRET.length < 32) {
    errores.push('JWT_SECRET debe tener al menos 32 caracteres en producción');
  }

  if (env.esProduccion && env.FRONTEND_URL.length === 0) {
    errores.push('FRONTEND_URL es obligatoria en producción');
  }

  if (errores.length > 0) {
    console.error('❌ Error en variables de entorno:\n  - ' + errores.join('\n  - '));
    process.exit(1);
  }

  if (!env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL no está configurada: la API arranca, pero sin base de datos.');
  }
}

module.exports = { env, validarEnv };
