// Punto de entrada: crea el servidor HTTP con Express y Socket.io
const http = require('http');
const { env, validarEnv } = require('./config/env');

validarEnv();

const app = require('./app');
const { iniciarSockets } = require('./sockets');
const { pool } = require('./config/db');

const servidor = http.createServer(app);
iniciarSockets(servidor);

servidor.listen(env.PORT, () => {
  console.log(`🚗 SegurIA-LPR API escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// Cierre ordenado (Render envía SIGTERM al reiniciar)
function cerrar() {
  console.log('Cerrando servidor...');
  servidor.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
  // Si algo queda colgado, forzar salida
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);
