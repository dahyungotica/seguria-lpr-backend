// Comunicación en tiempo real con Socket.io
//
// Rooms a las que se une cada socket autenticado:
//   "recinto:<id>"          -> todos los usuarios de un recinto
//   "rol:<nombre>"          -> todos los usuarios de un rol
//   "recinto:<id>:<rol>"    -> usuarios de un rol dentro de un recinto (ej. admins del recinto 1)
//   "usuario:<id>"          -> un usuario específico
//
// Eventos que emite el servidor:
//   "acceso:nuevo"          -> nueva detección de patente (monitor del guardia / panel admin)
//   "acceso:actualizado"    -> un guardia atendió la alerta de un acceso (autorizó o rechazó)
//   "vehiculo:cambio"       -> un propietario creó/editó/eliminó un vehículo (admin del recinto)
//   "notificacion:nueva"    -> notificación para un usuario
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const ROLES = require('../utils/roles');

let io = null;

function iniciarSockets(servidorHttp) {
  io = new Server(servidorHttp, {
    cors: {
      origin: env.FRONTEND_URL.length > 0 ? env.FRONTEND_URL : true,
    },
  });

  // Autenticación: el cliente envía el token en io(URL, { auth: { token } })
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Token no proporcionado'));
    }
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      socket.usuario = { id: payload.id, rol: payload.rol, recinto_id: payload.recinto_id };
      next();
    } catch (err) {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const { id, rol, recinto_id: recintoId } = socket.usuario;

    socket.join(`usuario:${id}`);
    socket.join(`rol:${rol}`);
    if (recintoId) {
      socket.join(`recinto:${recintoId}`);
      socket.join(`recinto:${recintoId}:${rol}`);
    }

    socket.emit('conectado', { mensaje: 'Conectado a SegurIA-LPR en tiempo real' });
  });

  iniciarEspacioDispositivos();
  return io;
}

// ----- Espacio "/dispositivos": conexión de las Raspberry Pi (HU-36) -----
// El equipo se conecta con io(URL + '/dispositivos', { auth: { identificador, api_key } })
// y recibe la lista de patentes autorizadas de su recinto y cada cambio posterior.
let espacioDispositivos = null;

function iniciarEspacioDispositivos() {
  // Se requieren aquí para evitar dependencias circulares al cargar los módulos
  const dispositivosService = require('../services/dispositivos.service');
  const sincronizacion = require('../services/sincronizacion.service');

  espacioDispositivos = io.of('/dispositivos');

  espacioDispositivos.use(async (socket, next) => {
    const { identificador, api_key: apiKey } = socket.handshake.auth || {};
    if (!identificador || !apiKey) return next(new Error('Credenciales de dispositivo no proporcionadas'));
    try {
      socket.dispositivo = await dispositivosService.autenticar(String(identificador), String(apiKey));
      next();
    } catch (error) {
      next(new Error(error.message || 'Credenciales de dispositivo inválidas'));
    }
  });

  espacioDispositivos.on('connection', async (socket) => {
    socket.join(`recinto:${socket.dispositivo.recinto_id}`);
    await dispositivosService.heartbeat(socket.dispositivo).catch(() => {});
    await sincronizacion.enviarCompleta(socket);
    // El equipo puede pedir la lista completa en cualquier momento (ej. tras reiniciarse)
    socket.on('patentes:solicitar', () => sincronizacion.enviarCompleta(socket));
  });

  sincronizacion.iniciarRevisionPeriodica();
}

function obtenerEspacioDispositivos() {
  return espacioDispositivos;
}

function obtenerIO() {
  if (!io) throw new Error('Socket.io no está inicializado');
  return io;
}

// Emite solo si Socket.io está activo (los scripts de BD no lo inician)
function emitir(rooms, evento, datos) {
  if (!io) return;
  let destino = io;
  for (const room of rooms) destino = destino.to(room);
  destino.emit(evento, datos);
}

// ----- Funciones para emitir eventos desde los servicios -----

// Nueva detección: la ven guardias y administradores del recinto
function emitirAccesoNuevo(recintoId, acceso) {
  emitir([`recinto:${recintoId}:${ROLES.GUARDIA}`, `recinto:${recintoId}:${ROLES.ADMIN_RECINTO}`], 'acceso:nuevo', acceso);
}

// Acceso modificado (ej. autorización manual del guardia)
function emitirAccesoActualizado(recintoId, acceso) {
  emitir([`recinto:${recintoId}:${ROLES.GUARDIA}`, `recinto:${recintoId}:${ROLES.ADMIN_RECINTO}`], 'acceso:actualizado', acceso);
}

// Cambio en un vehículo: lo ven el administrador y los guardias del recinto
function emitirVehiculoCambio(recintoId, cambio) {
  emitir([`recinto:${recintoId}:${ROLES.ADMIN_RECINTO}`, `recinto:${recintoId}:${ROLES.GUARDIA}`], 'vehiculo:cambio', cambio);
}

// Notificación dirigida a un usuario
function emitirNotificacion(usuarioId, notificacion) {
  emitir([`usuario:${usuarioId}`], 'notificacion:nueva', notificacion);
}

module.exports = {
  iniciarSockets,
  obtenerIO,
  obtenerEspacioDispositivos,
  emitirAccesoNuevo,
  emitirAccesoActualizado,
  emitirVehiculoCambio,
  emitirNotificacion,
};
