// Error con código HTTP, para lanzarlo desde servicios/controladores
class HttpError extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

module.exports = HttpError;
