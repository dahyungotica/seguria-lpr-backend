// Permite el acceso solo a los roles indicados. Usar después de autenticar.
// Ejemplo: router.get('/', permitirRoles('admin_recinto', 'guardia'), controlador)
function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = permitirRoles;
