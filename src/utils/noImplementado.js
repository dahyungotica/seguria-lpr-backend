// Genera un controlador que responde 501 para los endpoints aún no desarrollados
function noImplementado(accion) {
  return (req, res) => {
    res.status(501).json({ error: 'No implementado', accion });
  };
}

module.exports = noImplementado;
