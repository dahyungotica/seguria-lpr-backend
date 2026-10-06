// Utilidades para el RUT chileno

// Deja solo números y K. Ej: "12.345.678-k" -> "12345678K"
function limpiarRut(rut) {
  return String(rut || '').toUpperCase().replace(/[^0-9K]/g, '');
}

// Calcula el dígito verificador con el algoritmo módulo 11
function calcularDv(cuerpo) {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function validarRut(rut) {
  const limpio = limpiarRut(rut);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  return calcularDv(limpio.slice(0, -1)) === limpio.slice(-1);
}

// Formato con el que se guarda en la BD: "12345678-9"
function formatearRut(rut) {
  const limpio = limpiarRut(rut);
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

module.exports = { limpiarRut, validarRut, formatearRut };
