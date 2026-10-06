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
//   "acceso:actualizado"    -> un guardia autorizó manualmente un acceso
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

  return io;
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
  emitirAccesoNuevo,
  emitirAccesoActualizado,
  emitirVehiculoCambio,
  emitirNotificacion,
};
