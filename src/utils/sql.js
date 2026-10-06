// Ayudas para armar consultas SQL de forma segura (siempre con parámetros $1, $2...)

// Arma el "SET col = $n, ..." de un UPDATE solo con los campos permitidos que vienen en datos.
// Devuelve { set, valores } o null si no hay nada que actualizar.
function construirUpdate(datos, camposPermitidos, inicio = 1) {
  const columnas = camposPermitidos.filter((campo) => datos[campo] !== undefined);
  if (columnas.length === 0) return null;

  return {
    set: columnas.map((col, i) => `${col} = $${inicio + i}`).join(', '),
    valores: columnas.map((col) => datos[col]),
  };
}

// Acumula condiciones WHERE con sus parámetros.
// Uso: const f = new Filtros(); f.agregar('recinto_id = ?', 3); f.where -> "WHERE recinto_id = $1"
class Filtros {
  constructor() {
    this.condiciones = [];
    this.valores = [];
  }

  // Cada "?" del texto se reemplaza por el siguiente $n
  agregar(condicion, ...valores) {
    let texto = condicion;
    for (const valor of valores) {
      this.valores.push(valor);
      texto = texto.replace('?', `$${this.valores.length}`);
    }
    this.condiciones.push(texto);
    return this;
  }

  // Siguiente marcador libre, para LIMIT/OFFSET u otros parámetros
  parametro(valor) {
    this.valores.push(valor);
    return `$${this.valores.length}`;
  }

  get where() {
    return this.condiciones.length > 0 ? `WHERE ${this.condiciones.join(' AND ')}` : '';
  }
}

// Zona horaria del negocio, usada para "hoy" y filtros por fecha
const ZONA_HORARIA = 'America/Santiago';

module.exports = { construirUpdate, Filtros, ZONA_HORARIA };
