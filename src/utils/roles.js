// Nombres de roles del sistema.
// admin_recinto, propietario y guardia están en la tabla roles y se asignan por recinto (usuario_recinto).
// admin_plataforma no es un rol de recinto: se marca en usuarios.es_admin_plataforma.
const ROLES = Object.freeze({
  ADMIN_PLATAFORMA: 'admin_plataforma',
  ADMIN_RECINTO: 'admin_recinto',
  PROPIETARIO: 'propietario',
  GUARDIA: 'guardia',
});

module.exports = ROLES;
