// Borra TODO el esquema, lo vuelve a crear y carga los datos de prueba.
// Uso: npm run db:reset   (¡se pierden todos los datos!)
const { env } = require('../src/config/env');
const { conectar, ejecutarArchivoSql } = require('./conexion');
const { seed } = require('./seed');

async function main() {
  if (env.esProduccion && !process.argv.includes('--forzar')) {
    console.error('❌ NODE_ENV=production: db:reset está bloqueado. Usa "node scripts/db-reset.js --forzar" si realmente quieres borrar todo.');
    process.exit(1);
  }

  const cliente = await conectar();
  try {
    await ejecutarArchivoSql(cliente, 'drop.sql');
    console.log('🗑️  Esquema anterior eliminado');
    await ejecutarArchivoSql(cliente, 'schema.sql');
    console.log('✅ Esquema creado');
    await seed(cliente, { soloAdmin: process.argv.includes('--solo-admin') });
  } finally {
    await cliente.end();
  }
}

main().catch((err) => {
  console.error('❌ Error en db:reset:', err.message);
  process.exit(1);
});
