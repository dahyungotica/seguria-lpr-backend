// Estado de conexión de las Raspberry Pi: "activo" o "sin_conexion".
//  - Conectado por Socket.io o con un heartbeat reciente  -> activo
//  - Se cerró su conexión Socket.io (tras unos segundos de gracia, por si se reconecta)
//    o pasaron más de 3 minutos sin ninguna señal          -> sin_conexion
// Cada cambio se avisa en tiempo real al admin y a los guardias del recinto ("dispositivo:estado").
// Un equipo "inactivo" (desactivado a mano por el admin) solo vuelve a activo cuando da señales.
const { query } = require('../config/db');

const SIN_SENAL_MINUTOS = 3;
const REVISION_MS = 60 * 1000;
const GRACIA_DESCONEXION_MS = 15 * 1000;

const desconexionesPendientes = new Map(); // dispositivoId -> temporizador

// Envía el estado actual del equipo (con su cámara) al admin y a los guardias de su recinto
async function avisar(dispositivoId) {
  const { rows } = await query(
    `SELECT d.id, d.recinto_id, d.nombre, d.identificador, d.estado, d.ultimo_heartbeat,
            c.id AS camara_id, c.nombre AS camara_nombre
     FROM dispositivos d LEFT JOIN camaras c ON c.dispositivo_id = d.id
     WHERE d.id = $1`,
    [dispositivoId]
  );
  if (rows[0]) require('../sockets').emitirEstadoDispositivo(rows[0].recinto_id, rows[0]);
}

function avisarSinError(dispositivoId) {
  avisar(dispositivoId).catch((e) => console.error('Error al avisar el estado del equipo:', e.message));
}

// Señal de vida (heartbeat REST o conexión Socket.io). Avisa solo si el equipo estaba sin conexión o inactivo.
async function marcarActivo(dispositivo, ip) {
  clearTimeout(desconexionesPendientes.get(dispositivo.id));
  desconexionesPendientes.delete(dispositivo.id);

  const { rows } = await query(
    `UPDATE dispositivos d
     SET ultimo_heartbeat = NOW(), estado = 'activo', ip = COALESCE($2, d.ip)
     FROM (SELECT id, estado AS anterior FROM dispositivos WHERE id = $1) previo
     WHERE d.id = previo.id
     RETURNING previo.anterior`,
    [dispositivo.id, ip || null]
  );
  if (rows[0] && rows[0].anterior !== 'activo') avisarSinError(dispositivo.id);
}

// Pasa a "sin_conexion" los equipos indicados que estaban activos
async function marcarSinConexion(ids) {
  if (ids.length === 0) return;
  const { rows } = await query(
    "UPDATE dispositivos SET estado = 'sin_conexion' WHERE id = ANY($1::int[]) AND estado = 'activo' RETURNING id",
    [ids]
  );
  rows.forEach((r) => avisarSinError(r.id));
}

// Se cerró la última conexión Socket.io del equipo: si no vuelve dentro del tiempo de gracia, queda sin conexión
function programarDesconexion(dispositivoId, sigueConectado) {
  clearTimeout(desconexionesPendientes.get(dispositivoId));
  const temporizador = setTimeout(() => {
    desconexionesPendientes.delete(dispositivoId);
    if (sigueConectado()) return;
    marcarSinConexion([dispositivoId]).catch((e) => console.error('Error al marcar el equipo sin conexión:', e.message));
  }, GRACIA_DESCONEXION_MS);
  temporizador.unref();
  desconexionesPendientes.set(dispositivoId, temporizador);
}

// Cada minuto: los equipos conectados por Socket.io cuentan como señal de vida;
// los activos que no están conectados y llevan más de 3 minutos sin heartbeat quedan sin conexión.
async function revisar(idsConectados) {
  if (idsConectados.length > 0) {
    await query('UPDATE dispositivos SET ultimo_heartbeat = NOW() WHERE id = ANY($1::int[])', [idsConectados]);
  }
  const { rows } = await query(
    `SELECT id FROM dispositivos
     WHERE estado = 'activo' AND NOT (id = ANY($1::int[]))
       AND (ultimo_heartbeat IS NULL OR ultimo_heartbeat < NOW() - INTERVAL '${SIN_SENAL_MINUTOS} minutes')`,
    [idsConectados]
  );
  await marcarSinConexion(rows.map((r) => r.id));
}

function iniciarRevision(obtenerIdsConectados) {
  const intervalo = setInterval(() => {
    revisar(obtenerIdsConectados()).catch((e) => console.error('Error en la revisión de equipos:', e.message));
  }, REVISION_MS);
  intervalo.unref();
}

module.exports = { marcarActivo, marcarSinConexion, programarDesconexion, revisar, iniciarRevision, SIN_SENAL_MINUTOS };
