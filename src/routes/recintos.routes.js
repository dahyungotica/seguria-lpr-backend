// Recintos: los crea y administra el admin de plataforma
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/recintos.controller');

const router = Router();

router.use(autenticar);

router.get('/', permitirRoles(ROLES.ADMIN_PLATAFORMA), controller.listar);
// El admin de recinto puede ver los datos de su propio recinto
router.get('/:id', permitirRoles(ROLES.ADMIN_PLATAFORMA, ROLES.ADMIN_RECINTO), controller.obtener);
router.post('/', permitirRoles(ROLES.ADMIN_PLATAFORMA), controller.crear);
router.put('/:id', permitirRoles(ROLES.ADMIN_PLATAFORMA), controller.actualizar);
router.patch('/:id/estado', permitirRoles(ROLES.ADMIN_PLATAFORMA), controller.cambiarEstado);

module.exports = router;
