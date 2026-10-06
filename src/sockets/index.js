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

    socket.on('disconnect', () => {
      // Aquí se podría registrar la desconexión si fuera necesario
    });
  });

  return io;
}

function obtenerIO() {
  if (!io) throw new Error('Socket.io no está inicializado');
  return io;
}

// ----- Funciones de ejemplo para emitir eventos desde los servicios -----

// Nueva detección: la ven guardias y administradores del recinto
function emitirAccesoNuevo(recintoId, acceso) {
  obtenerIO()
    .to(`recinto:${recintoId}:${ROLES.GUARDIA}`)
    .to(`recinto:${recintoId}:${ROLES.ADMIN_RECINTO}`)
    .emit('acceso:nuevo', acceso);
}

// Cambio en un vehículo: lo ve el administrador del recinto
function emitirVehiculoCambio(recintoId, cambio) {
  obtenerIO().to(`recinto:${recintoId}:${ROLES.ADMIN_RECINTO}`).emit('vehiculo:cambio', cambio);
}

// Notificación dirigida a un usuario
function emitirNotificacion(usuarioId, notificacion) {
  obtenerIO().to(`usuario:${usuarioId}`).emit('notificacion:nueva', notificacion);
}

module.exports = {
  iniciarSockets,
  obtenerIO,
  emitirAccesoNuevo,
  emitirVehiculoCambio,
  emitirNotificacion,
};
