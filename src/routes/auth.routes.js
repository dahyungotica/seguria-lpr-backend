const { Router } = require('express');
const { body } = require('express-validator');
const validar = require('../middlewares/validar');
const autenticar = require('../middlewares/auth');
const ROLES = require('../utils/roles');
const controller = require('../controllers/auth.controller');

const router = Router();

// POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isString().trim().toLowerCase().isEmail().withMessage('Email inválido'),
    body('password').isString().notEmpty().withMessage('La contraseña es obligatoria'),
  ],
  validar,
  controller.login
);

// POST /api/auth/recinto  { recinto_id, rol? }  -> token nuevo para trabajar en ese recinto con ese rol
router.post(
  '/recinto',
  autenticar.sinRecinto,
  [
    body('recinto_id').isInt({ min: 1 }).withMessage('Recinto inválido').toInt(),
    body('rol').optional().isIn(Object.values(ROLES).filter((r) => r !== ROLES.ADMIN_PLATAFORMA)).withMessage('Rol inválido'),
  ],
  validar,
  controller.seleccionarRecinto
);

// GET /api/auth/me (requiere token; funciona aunque aún no se haya elegido recinto)
router.get('/me', autenticar.sinRecinto, controller.me);

module.exports = router;
