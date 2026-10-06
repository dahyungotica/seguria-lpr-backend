// Normaliza una patente chilena: mayúsculas y sin guiones, puntos ni espacios.
// Ej: "ab-cd-12" -> "ABCD12"
function normalizarPatente(patente) {
  return String(patente || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = { normalizarPatente };
