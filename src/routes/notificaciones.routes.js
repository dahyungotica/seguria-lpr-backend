// Notificaciones de cambios para el administrador del recinto
const { Router } = require('express');
const { query } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/notificaciones.controller');

const router = Router();

router.use(autenticar, permitirRoles(ROLES.ADMIN_RECINTO));

router.get(
  '/',
  [...v.paginacionQuery, query('leida').optional().isIn(['true', 'false']).toBoolean(true), query('tipo').optional().isString()],
  validar,
  controller.listar
);
router.get('/no-leidas', controller.contarNoLeidas);
router.patch('/leer-todas', controller.marcarTodasLeidas);
router.patch('/:id/leida', v.idParam, validar, controller.marcarLeida);

module.exports = router;
