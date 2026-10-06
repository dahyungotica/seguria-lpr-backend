// Historial de accesos y autorización manual por parte del guardia
const { Router } = require('express');
const { body } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const controller = require('../controllers/accesos.controller');

const router = Router();

router.use(autenticar);

router.get('/', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA, ROLES.PROPIETARIO), controller.listar);
router.get('/estadisticas', permitirRoles(ROLES.ADMIN_RECINTO), controller.estadisticas);
router.get('/:id', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA, ROLES.PROPIETARIO), controller.obtener);

// El guardia autoriza un ingreso no autorizado: el detalle es obligatorio
router.post(
  '/:id/autorizar',
  permitirRoles(ROLES.GUARDIA),
  [
    body('detalle_autorizacion')
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Debes indicar el motivo de la autorización (5 a 500 caracteres)'),
  ],
  validar,
  controller.autorizarManual
);

module.exports = router;
