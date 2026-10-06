const { Router } = require('express');
const { body } = require('express-validator');
const validar = require('../middlewares/validar');
const autenticar = require('../middlewares/auth');
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

// GET /api/auth/me (requiere token)
router.get('/me', autenticar, controller.me);

module.exports = router;
