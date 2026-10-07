// Usuarios (personas): una cuenta por persona con uno o varios roles por recinto.
// El admin de plataforma gestiona administradores de recinto; el admin de recinto asigna
// administradores, guardias y propietarios en los recintos que administra; el guardia solo consulta propietarios.
// El alcance exacto se controla en services/usuarios.service.js
const { Router } = require('express');
const { query } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/usuarios.controller');

const router = Router();
const ADMINS = [ROLES.ADMIN_PLATAFORMA, ROLES.ADMIN_RECINTO];
const ROLES_RECINTO = [ROLES.ADMIN_RECINTO, ROLES.PROPIETARIO, ROLES.GUARDIA];

function reglasUsuario(edicion) {
  return [
    v.textoRequerido('nombre', 'El nombre', 80, { edicion }),
    v.textoRequerido('apellido', 'El apellido', 80, { edicion }),
    v.rut({ edicion }),
    v.email({ edicion }),
    // Opcional también al crear: si la persona ya tiene cuenta solo se le agregan los roles
    v.password({ edicion: true }),
    v.telefono(),
    // roles: [{ recinto_id, rol, unidad_id }] (al crear es obligatorio; al editar reemplaza los roles que el actor gestiona)
    ...v.rolesBody({ obligatorio: !edicion }),
  ];
}

const filtrosListado = [
  ...v.paginacionQuery,
  v.busquedaQuery,
  v.activoQuery,
  query('rol').optional().isIn(ROLES_RECINTO),
  query('recinto_id').optional().isInt({ min: 1 }).toInt(),
  query('unidad_id').optional().isInt({ min: 1 }).toInt(),
];

router.use(autenticar);

router.get('/', permitirRoles(...ADMINS, ROLES.GUARDIA), filtrosListado, validar, controller.listar);
// Recintos, roles y unidades que el actor puede asignar (para el formulario)
router.get('/opciones', permitirRoles(...ADMINS), controller.opciones);
router.get('/:id', permitirRoles(...ADMINS, ROLES.GUARDIA), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(...ADMINS), reglasUsuario(false), validar, controller.crear);
router.put('/:id', permitirRoles(...ADMINS), [v.idParam, ...reglasUsuario(true)], validar, controller.actualizar);
router.patch(
  '/:id/estado',
  permitirRoles(...ADMINS),
  [v.idParam, v.activoBody, v.idBody('recinto_id', 'Recinto', { opcional: true })],
  validar,
  controller.cambiarEstado
);

module.exports = router;
