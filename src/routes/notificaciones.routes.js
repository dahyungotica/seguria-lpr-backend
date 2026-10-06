// Notificaciones de cambios para el administrador del recinto
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/notificaciones.controller');

const router = Router();

router.use(autenticar, permitirRoles(ROLES.ADMIN_RECINTO));

router.get('/', controller.listar);
router.get('/no-leidas', controller.contarNoLeidas);
router.patch('/leer-todas', controller.marcarTodasLeidas);
router.patch('/:id/leida', controller.marcarLeida);

module.exports = router;
