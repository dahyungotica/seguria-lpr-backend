// Crea las tablas, funciones, triggers y vistas ejecutando sql/schema.sql
// Uso: npm run db:init
const { conectar, ejecutarArchivoSql } = require('./conexion');

async function main() {
  const cliente = await conectar();
  try {
    const { rows } = await cliente.query("SELECT to_regclass('public.usuarios') AS existe");
    if (rows[0].existe) {
      console.log('ℹ️  El esquema ya existe. Para recrearlo desde cero usa: npm run db:reset');
      return;
    }

    await ejecutarArchivoSql(cliente, 'schema.sql');
    console.log('✅ Esquema creado correctamente (sql/schema.sql)');
  } finally {
    await cliente.end();
  }
}

// Si se ejecuta directamente (no al importarlo desde db-reset)
if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Error al crear el esquema:', err.message);
    process.exit(1);
  });
}
