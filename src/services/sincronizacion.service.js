// Sincronización de la copia local de patentes de cada Raspberry Pi (HU-36, lado backend).
//
// Las Raspberry Pi se conectan al espacio de Socket.io "/dispositivos" con su API key y reciben:
//   "patentes:completa" -> la lista completa al conectarse (o cuando la piden con "patentes:solicitar")
//   "patentes:cambios"  -> solo lo que cambió: { altas: [...], bajas: [patente, ...] }
//
// Cada cambio (vehículo o visita creado, editado, desactivado o cancelado, propietario desactivado)
// llama a notificarCambio(recintoId). Además, cada minuto se revisan los recintos con equipos
// conectados para detectar visitas que empiezan o expiran con el paso del tiempo.
const { query } = require('../config/db');

const ESPERA_MS = 300;            // agrupa cambios seguidos en un solo envío
const REVISION_PERIODICA_MS = 60 * 1000;

const ultimoEnviado = new Map();  // recintoId -> Map(patente -> fila enviada)
const temporizadores = new Map(); // recintoId -> temporizador de espera

// El espacio "/dispositivos" lo crea sockets/index.js (se pide en cada uso para evitar dependencias circulares)
function espacio() {
  return require('../sockets').obtenerEspacioDispositivos();
}

const sala = (recintoId) => `recinto:${recintoId}`;

function equiposConectados(recintoId) {
  const ns = espacio();
  const room = ns && ns.adapter.rooms.get(sala(recintoId));
  return room ? [...room].map((id) => ns.sockets.get(id)).filter(Boolean) : [];
}

// Patentes autorizadas del recinto. Si una patente es vehículo y visita a la vez, gana el vehículo.
async function patentesDelRecinto(recintoId) {
  const { rows } = await query(
    `SELECT patente, origen, vigente_hasta FROM vw_patentes_autorizadas
     WHERE recinto_id = $1
     ORDER BY patente, CASE origen WHEN 'vehiculo' THEN 0 ELSE 1 END`,
    [recintoId]
  );
  const mapa = new Map();
  for (const fila of rows) if (!mapa.has(fila.patente)) mapa.set(fila.patente, fila);
  return mapa;
}

async function registrarSincronizacion(dispositivoId, registros) {
  await query('UPDATE dispositivos SET ultima_sincronizacion = NOW() WHERE id = $1', [dispositivoId]);
  await query(
    "INSERT INTO sincronizaciones (dispositivo_id, registros_enviados, estado) VALUES ($1, $2, 'ok')",
    [dispositivoId, registros]
  );
}

// Envía la lista completa a un equipo y la toma como punto de partida para los cambios
async function enviarCompleta(socket) {
  const recintoId = socket.dispositivo.recinto_id;
  try {
    const mapa = await patentesDelRecinto(recintoId);
    ultimoEnviado.set(recintoId, mapa);
    socket.emit('patentes:completa', { generado: new Date().toISOString(), total: mapa.size, patentes: [...mapa.values()] });
    await registrarSincronizacion(socket.dispositivo.id, mapa.size);
  } catch (error) {
    console.error('Error al enviar la lista completa de patentes:', error.message);
  }
}

// Compara la lista actual con la última enviada y emite solo las diferencias
async function sincronizarRecinto(recintoId) {
  const equipos = equiposConectados(recintoId);
  if (equipos.length === 0) {
    ultimoEnviado.delete(recintoId); // al reconectarse recibirán la lista completa
    return;
  }
  const actual = await patentesDelRecinto(recintoId);
  const anterior = ultimoEnviado.get(recintoId) || new Map();

  const altas = [...actual.values()].filter((fila) => {
    const previa = anterior.get(fila.patente);
    return !previa || JSON.stringify(previa) !== JSON.stringify(fila);
  });
  const bajas = [...anterior.keys()].filter((patente) => !actual.has(patente));
  if (altas.length === 0 && bajas.length === 0) return;

  ultimoEnviado.set(recintoId, actual);
  espacio().to(sala(recintoId)).emit('patentes:cambios', { generado: new Date().toISOString(), altas, bajas });
  for (const socket of equipos) await registrarSincronizacion(socket.dispositivo.id, altas.length + bajas.length);
}

// Llamar después de cualquier cambio que afecte las patentes autorizadas de un recinto
function notificarCambio(recintoId) {
  if (!recintoId || !espacio()) return;
  clearTimeout(temporizadores.get(recintoId));
  temporizadores.set(recintoId, setTimeout(() => {
    temporizadores.delete(recintoId);
    sincronizarRecinto(recintoId).catch((e) => console.error('Error al sincronizar patentes:', e.message));
  }, ESPERA_MS));
}

// Revisa periódicamente los recintos con equipos conectados (visitas que empiezan o expiran)
function iniciarRevisionPeriodica() {
  const intervalo = setInterval(() => {
    const ns = espacio();
    if (!ns) return;
    const recintos = new Set([...ns.sockets.values()].map((s) => s.dispositivo.recinto_id));
    for (const recintoId of recintos) {
      sincronizarRecinto(recintoId).catch((e) => console.error('Error en la revisión de patentes:', e.message));
    }
  }, REVISION_PERIODICA_MS);
  intervalo.unref();
}

module.exports = { notificarCambio, enviarCompleta, sincronizarRecinto, iniciarRevisionPeriodica };
