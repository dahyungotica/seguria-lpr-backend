// Paginación simple con ?pagina=1&limite=20

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 100;

function obtenerPaginacion(query) {
  const pagina = Math.max(1, parseInt(query.pagina, 10) || 1);
  const limite = Math.min(LIMITE_MAXIMO, Math.max(1, parseInt(query.limite, 10) || LIMITE_POR_DEFECTO));
  return { pagina, limite, offset: (pagina - 1) * limite };
}

// Las consultas paginadas incluyen "COUNT(*) OVER() AS total_filas" para saber el total
function respuestaPaginada(filas, { pagina, limite }) {
  const total = filas.length > 0 ? Number(filas[0].total_filas) : 0;
  const datos = filas.map(({ total_filas, ...resto }) => resto);
  return { datos, total, pagina, limite, paginas: Math.max(1, Math.ceil(total / limite)) };
}

module.exports = { obtenerPaginacion, respuestaPaginada };
