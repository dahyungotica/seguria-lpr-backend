// Normaliza una patente chilena: mayúsculas y sin guiones, puntos ni espacios.
// Ej: "ab-cd-12" -> "ABCD12"
function normalizarPatente(patente) {
  return String(patente || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Formatos chilenos válidos (ya normalizados):
//   BBBB10  -> autos nuevos (4 letras + 2 números)
//   AB1234  -> autos antiguos (2 letras + 4 números)
//   BBB10   -> motos nuevas (3 letras + 2 números)
//   AB123   -> motos antiguas (2 letras + 3 números)
const FORMATO_PATENTE = /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4}|[A-Z]{3}\d{2}|[A-Z]{2}\d{3})$/;

function validarPatente(patente) {
  return FORMATO_PATENTE.test(normalizarPatente(patente));
}

module.exports = { normalizarPatente, validarPatente };
