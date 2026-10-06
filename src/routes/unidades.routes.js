// Unidades (departamentos, casas, oficinas) del recinto del usuario
const { Router } = require('express');
const { body } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/unidades.controller');

const router = Router();
const TIPOS = ['departamento', 'casa', 'oficina', 'local', 'otro'];

function reglasUnidad(edicion) {
  return [
    v.textoRequerido('identificador', 'El identificador', 50, { edicion }),
    v.enumBody('tipo', 'El tipo', TIPOS, { opcional: edicion }),
    body('activo').optional().isBoolean({ strict: true }),
  ];
}

router.use(autenticar);

router.get('/', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.listar);
router.get('/:id', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(ROLES.ADMIN_RECINTO), reglasUnidad(false), validar, controller.crear);
router.put('/:id', permitirRoles(ROLES.ADMIN_RECINTO), [v.idParam, ...reglasUnidad(true)], validar, controller.actualizar);
router.delete('/:id', permitirRoles(ROLES.ADMIN_RECINTO), v.idParam, validar, controller.eliminar);

module.exports = router;
