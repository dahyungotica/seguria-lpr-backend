// Unidades (departamentos, casas, oficinas) de un recinto
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/unidades.controller');

const router = Router();

router.use(autenticar);

router.get('/', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.listar);
router.get('/:id', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.obtener);
router.post('/', permitirRoles(ROLES.ADMIN_RECINTO), controller.crear);
router.put('/:id', permitirRoles(ROLES.ADMIN_RECINTO), controller.actualizar);
router.delete('/:id', permitirRoles(ROLES.ADMIN_RECINTO), controller.eliminar);

module.exports = router;
