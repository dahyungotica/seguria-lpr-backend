// Visitas programadas por los propietarios
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/visitas.controller');

const router = Router();

router.use(autenticar);

router.get('/', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.listar);
router.get('/:id', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.obtener);
router.post('/', permitirRoles(ROLES.PROPIETARIO), controller.crear);
router.put('/:id', permitirRoles(ROLES.PROPIETARIO), controller.actualizar);
router.patch('/:id/cancelar', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO), controller.cancelar);

module.exports = router;
