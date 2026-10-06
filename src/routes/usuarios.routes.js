// Usuarios: el admin de plataforma gestiona administradores de recinto;
// el admin de recinto gestiona propietarios y guardias; el guardia solo consulta propietarios.
// El alcance exacto (qué roles y qué recinto) se controla en services/usuarios.service.js
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
const ROLES_CREABLES = [ROLES.ADMIN_RECINTO, ROLES.PROPIETARIO, ROLES.GUARDIA];

function reglasUsuario(edicion) {
  return [
    v.textoRequerido('nombre', 'El nombre', 80, { edicion }),
    v.textoRequerido('apellido', 'El apellido', 80, { edicion }),
    v.rut({ edicion }),
    v.email({ edicion }),
    v.password({ edicion }),
    v.telefono(),
    v.idBody('recinto_id', 'Recinto', { opcional: true }),
    v.idBody('unidad_id', 'Unidad', { opcional: true }),
    ...(edicion ? [] : [v.enumBody('rol', 'El rol', ROLES_CREABLES)]),
  ];
}

const filtrosListado = [
  ...v.paginacionQuery,
  v.busquedaQuery,
  v.activoQuery,
  query('rol').optional().isIn(ROLES_CREABLES),
  query('recinto_id').optional().isInt({ min: 1 }).toInt(),
  query('unidad_id').optional().isInt({ min: 1 }).toInt(),
];

router.use(autenticar);

router.get('/', permitirRoles(...ADMINS, ROLES.GUARDIA), filtrosListado, validar, controller.listar);
router.get('/:id', permitirRoles(...ADMINS, ROLES.GUARDIA), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(...ADMINS), reglasUsuario(false), validar, controller.crear);
router.put('/:id', permitirRoles(...ADMINS), [v.idParam, ...reglasUsuario(true)], validar, controller.actualizar);
router.patch('/:id/estado', permitirRoles(...ADMINS), [v.idParam, v.activoBody], validar, controller.cambiarEstado);

module.exports = router;
