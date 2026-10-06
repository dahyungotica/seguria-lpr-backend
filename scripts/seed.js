// Carga datos de prueba (SOLO para desarrollo)
// Uso: npm run db:seed
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { conectar } = require('./conexion');

// Contraseña común de los usuarios de prueba. NO usar en producción.
const PASSWORD_PRUEBA = 'Seguria2026!';

// Inserta una fila y devuelve su id
async function insertar(cliente, tabla, datos) {
  const columnas = Object.keys(datos);
  const valores = Object.values(datos);
  const marcadores = columnas.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await cliente.query(
    `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcadores}) RETURNING id`,
    valores
  );
  return rows[0].id;
}

// Fecha relativa a ahora (en horas). Ej: haceHoras(2) = hace 2 horas
function haceHoras(horas) {
  return new Date(Date.now() - horas * 60 * 60 * 1000);
}

// Cambios de vehículos hechos por el propietario (como los generará el módulo del propietario)
async function insertarNotificacionesDemo(cliente, { recintoId, adminRecintoId, propietarioId, vehiculo1, vehiculo2 }) {
  const base = { recinto_id: recintoId, usuario_destino_id: adminRecintoId, usuario_origen_id: propietarioId, entidad: 'vehiculos' };
  const notificaciones = [
    {
      ...base, tipo: 'vehiculo_creado', entidad_id: vehiculo2, leida: true,
      mensaje: 'Patricia Propietaria registró el vehículo LTPR45',
      datos_nuevos: JSON.stringify({ patente: 'LTPR45', marca: 'Nissan', modelo: 'Navara', color: 'Blanco', tipo: 'camioneta' }),
      created_at: haceHoras(30),
    },
    {
      ...base, tipo: 'vehiculo_editado', entidad_id: vehiculo1,
      mensaje: 'Patricia Propietaria editó el vehículo GHJK12',
      datos_anteriores: JSON.stringify({ patente: 'GHJK12', color: 'Negro', modelo: 'Yaris' }),
      datos_nuevos: JSON.stringify({ patente: 'GHJK12', color: 'Gris', modelo: 'Yaris' }),
      created_at: haceHoras(4),
    },
    {
      ...base, usuario_origen_id: null, tipo: 'acceso_no_autorizado', entidad: 'accesos',
      mensaje: 'Intento de ingreso de la patente BBCC34, que no está autorizada',
      datos_nuevos: JSON.stringify({ patente: 'BBCC34', camara: 'Cámara Portón Principal' }),
      created_at: haceHoras(3),
    },
  ];
  for (const n of notificaciones) {
    const columnas = Object.keys(n);
    await cliente.query(
      `INSERT INTO notificaciones (${columnas.join(', ')}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(n)
    );
  }
}

async function seed(cliente) {
  // Si ya existen los usuarios de prueba, no se duplica nada
  const { rows: existentes } = await cliente.query(
    "SELECT 1 FROM usuarios WHERE email = 'admin@seguria.cl'"
  );
  if (existentes.length > 0) {
    console.log('ℹ️  Los datos de prueba ya existen. Para recargarlos usa: npm run db:reset');
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD_PRUEBA, 10);
  // API key del dispositivo de prueba: se guarda solo el hash
  const apiKeyDispositivo = crypto.randomBytes(24).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKeyDispositivo, 10);

  await cliente.query('BEGIN');
  try {
    // 1. Roles
    const roles = {};
    const listaRoles = [
      ['admin_plataforma', 'Administra la plataforma: crea recintos y sus administradores'],
      ['admin_recinto', 'Administra un recinto: propietarios, cámaras, equipos e historial'],
      ['propietario', 'Residente o usuario autorizado: gestiona sus vehículos y visitas'],
      ['guardia', 'Monitorea accesos en vivo y puede autorizar ingresos manualmente'],
    ];
    for (const [nombre, descripcion] of listaRoles) {
      const { rows } = await cliente.query(
        `INSERT INTO roles (nombre, descripcion) VALUES ($1, $2)
         ON CONFLICT (nombre) DO UPDATE SET descripcion = EXCLUDED.descripcion
         RETURNING id`,
        [nombre, descripcion]
      );
      roles[nombre] = rows[0].id;
    }

    // 2. Recinto y unidades
    const recintoId = await insertar(cliente, 'recintos', {
      nombre: 'Condominio Los Aromos',
      direccion: 'Av. Los Aromos 1234',
      comuna: 'Puente Alto',
      region: 'Metropolitana',
      tipo: 'condominio',
      telefono: '+56 2 2345 6789',
    });
    const depto304 = await insertar(cliente, 'unidades', {
      recinto_id: recintoId, identificador: 'Depto 304', tipo: 'departamento',
    });
    await insertar(cliente, 'unidades', {
      recinto_id: recintoId, identificador: 'Casa 12', tipo: 'casa',
    });

    // 3. Dispositivo (Raspberry Pi) y cámara
    const dispositivoId = await insertar(cliente, 'dispositivos', {
      recinto_id: recintoId,
      nombre: 'Raspberry Pi Acceso Principal',
      identificador: 'RPI-AROMOS-01',
      api_key_hash: apiKeyHash,
      ip: '192.168.1.50',
      estado: 'activo',
    });
    const camaraId = await insertar(cliente, 'camaras', {
      recinto_id: recintoId,
      dispositivo_id: dispositivoId,
      nombre: 'Cámara Portón Principal',
      ubicacion: 'Acceso vehicular principal',
      sentido: 'entrada',
      ip: '192.168.1.60',
      url_stream: 'rtsp://192.168.1.60:554/stream1',
      estado: 'activa',
    });

    // 4. Un usuario por rol
    const usuarioBase = { password_hash: passwordHash };
    await insertar(cliente, 'usuarios', {
      ...usuarioBase, rut: '11111111-1', nombre: 'Ana', apellido: 'Plataforma',
      email: 'admin@seguria.cl', rol_id: roles.admin_plataforma, recinto_id: null,
    });
    const adminRecintoId = await insertar(cliente, 'usuarios', {
      ...usuarioBase, rut: '22222222-2', nombre: 'Rodrigo', apellido: 'Recinto',
      email: 'recinto@seguria.cl', rol_id: roles.admin_recinto, recinto_id: recintoId,
    });
    const propietarioId = await insertar(cliente, 'usuarios', {
      ...usuarioBase, rut: '33333333-3', nombre: 'Patricia', apellido: 'Propietaria',
      email: 'propietario@seguria.cl', telefono: '+56 9 1234 5678',
      rol_id: roles.propietario, recinto_id: recintoId, unidad_id: depto304,
    });
    const guardiaId = await insertar(cliente, 'usuarios', {
      ...usuarioBase, rut: '44444444-4', nombre: 'Gonzalo', apellido: 'Guardia',
      email: 'guardia@seguria.cl', rol_id: roles.guardia, recinto_id: recintoId,
    });

    // 5. Vehículos del propietario (la BD normaliza la patente: "GH-JK-12" -> "GHJK12")
    const vehiculo1 = await insertar(cliente, 'vehiculos', {
      propietario_id: propietarioId, recinto_id: recintoId, patente: 'GH-JK-12',
      marca: 'Toyota', modelo: 'Yaris', color: 'Gris', tipo: 'auto',
    });
    const vehiculo2 = await insertar(cliente, 'vehiculos', {
      propietario_id: propietarioId, recinto_id: recintoId, patente: 'LT-PR-45',
      marca: 'Nissan', modelo: 'Navara', color: 'Blanco', tipo: 'camioneta',
    });

    // 6. Visita vigente (hoy, por 4 horas)
    const visitaId = await insertar(cliente, 'visitas', {
      propietario_id: propietarioId, recinto_id: recintoId,
      nombre_visitante: 'Carlos Muñoz', rut_visitante: '15555555-5', patente: 'KZ-WX-88',
      motivo: 'Visita familiar', fecha_inicio: haceHoras(1), fecha_fin: haceHoras(-3),
      estado: 'activa',
    });

    // 7. Accesos de ejemplo
    const accesoBase = { recinto_id: recintoId, camara_id: camaraId, dispositivo_id: dispositivoId, sentido: 'entrada' };
    await insertar(cliente, 'accesos', {
      ...accesoBase, patente_detectada: 'GHJK12', confianza_ocr: 97.5,
      fecha_hora: haceHoras(5), resultado: 'autorizado', vehiculo_id: vehiculo1,
    });
    await insertar(cliente, 'accesos', {
      ...accesoBase, patente_detectada: 'BBCC34', confianza_ocr: 91.2,
      fecha_hora: haceHoras(3), resultado: 'denegado',
    });
    await insertar(cliente, 'accesos', {
      ...accesoBase, patente_detectada: 'PRST56', confianza_ocr: 88.0,
      fecha_hora: haceHoras(2), resultado: 'autorizado_manual', guardia_id: guardiaId,
      detalle_autorizacion: 'Camión de mudanza para Depto 304, confirmado por teléfono con la propietaria',
    });
    await insertar(cliente, 'accesos', {
      ...accesoBase, patente_detectada: 'KZWX88', confianza_ocr: 95.3,
      fecha_hora: haceHoras(0.5), resultado: 'visita', visita_id: visitaId,
    });

    // 8. Notificaciones de ejemplo para el administrador del recinto
    await insertarNotificacionesDemo(cliente, {
      recintoId, adminRecintoId, propietarioId, vehiculo1, vehiculo2,
    });

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  }

  console.log('✅ Datos de prueba cargados.');
  console.log(`   Usuarios: admin@, recinto@, propietario@, guardia@seguria.cl  (contraseña: ${PASSWORD_PRUEBA})`);
  console.log(`   API key del dispositivo RPI-AROMOS-01 (solo se muestra ahora): ${apiKeyDispositivo}`);
}

async function main() {
  const cliente = await conectar();
  try {
    await seed(cliente);
  } finally {
    await cliente.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Error al cargar los datos de prueba:', err.message);
    process.exit(1);
  });
}

module.exports = { seed, insertarNotificacionesDemo };
