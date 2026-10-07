// Mi perfil: disponible para todos los roles, siempre sobre la cuenta de la sesión
const { Router } = require('express');
const { body } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/perfil.controller');

const router = Router();
router.use(autenticar);

router.get('/', controller.obtener);
router.put(
  '/',
  [
    v.textoRequerido('nombre', 'El nombre', 80, { edicion: true }),
    v.textoRequerido('apellido', 'El apellido', 80, { edicion: true }),
    v.email({ edicion: true }),
    v.telefono(),
  ],
  validar,
  controller.actualizar
);
router.put(
  '/password',
  [body('password_actual').isString().notEmpty().withMessage('Ingresa tu contraseña actual'), v.password()],
  validar,
  controller.cambiarPassword
);
// El admin de recinto se agrega o quita roles en los recintos que administra
router.put('/roles', permitirRoles(ROLES.ADMIN_RECINTO), v.rolesBody({ obligatorio: true }), validar, controller.actualizarRoles);

module.exports = router;
