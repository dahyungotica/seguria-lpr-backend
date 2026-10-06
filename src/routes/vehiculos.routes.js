// Vehículos: el propietario los gestiona sin aprobación (cada cambio notifica al admin).
// El admin de recinto y el guardia pueden consultarlos.
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/vehiculos.controller');

const router = Router();

router.use(autenticar);

router.get('/', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.listar);
router.get('/:id', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.obtener);
router.post('/', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO), controller.crear);
router.put('/:id', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO), controller.actualizar);
router.delete('/:id', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO), controller.eliminar);

module.exports = router;
