// Utilidades compartidas por los scripts de base de datos
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { env } = require('../src/config/env');

// Crea y conecta un cliente de PostgreSQL. Termina el proceso si falta DATABASE_URL.
async function conectar() {
  if (!env.DATABASE_URL) {
    console.error('❌ Falta DATABASE_URL en el archivo .env. Configúrala antes de ejecutar este script.');
    process.exit(1);
  }

  const cliente = new Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  });
  await cliente.connect();
  return cliente;
}

// Ejecuta un archivo .sql de la carpeta sql/
async function ejecutarArchivoSql(cliente, nombreArchivo) {
  const ruta = path.join(__dirname, '..', 'sql', nombreArchivo);
  const sql = fs.readFileSync(ruta, 'utf8');
  await cliente.query(sql);
}

module.exports = { conectar, ejecutarArchivoSql };
