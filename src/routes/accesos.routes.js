// Historial de accesos y gestión de alertas por parte del guardia
const { Router } = require('express');
const { body, query } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/accesos.controller');

const router = Router();
// El admin de plataforma consulta los accesos de todos los recintos (HU-23)
const LECTORES = [ROLES.ADMIN_PLATAFORMA, ROLES.ADMIN_RECINTO, ROLES.GUARDIA, ROLES.PROPIETARIO];

const filtrosHistorial = [
  ...v.paginacionQuery,
  query('desde').optional({ values: 'falsy' }).isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('Fecha "desde" inválida'),
  query('hasta').optional({ values: 'falsy' }).isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('Fecha "hasta" inválida'),
  query('patente').optional({ values: 'falsy' }).isString().trim().isLength({ max: 10 }),
  query('resultado').optional({ values: 'falsy' }).isIn(['autorizado', 'denegado', 'autorizado_manual', 'visita']),
  query('sentido').optional({ values: 'falsy' }).isIn(['entrada', 'salida']),
  query('camara_id').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  query('recinto_id').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  query('alerta').optional({ values: 'falsy' }).isIn(['pendiente', 'atendida']),
];

router.use(autenticar);

router.get('/', permitirRoles(...LECTORES), filtrosHistorial, validar, controller.listar);
router.get('/estadisticas', permitirRoles(ROLES.ADMIN_RECINTO), controller.estadisticas);
router.get('/:id', permitirRoles(...LECTORES), v.idParam, validar, controller.obtener);

// HU-31: el guardia atiende la alerta de un ingreso no autorizado
// Autorizar: el detalle es obligatorio
router.post(
  '/:id/autorizar',
  permitirRoles(ROLES.GUARDIA),
  [
    v.idParam,
    body('detalle_autorizacion')
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Debes indicar el motivo de la autorización (5 a 500 caracteres)'),
  ],
  validar,
  controller.autorizarManual
);
// Rechazar: el detalle es opcional
router.post(
  '/:id/rechazar',
  permitirRoles(ROLES.GUARDIA),
  [v.idParam, v.textoOpcional('detalle', 'El detalle', 500)],
  validar,
  controller.rechazar
);

module.exports = router;
