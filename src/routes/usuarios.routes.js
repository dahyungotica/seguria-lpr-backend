// Usuarios: el admin de plataforma gestiona administradores de recinto;
// el admin de recinto gestiona propietarios y guardias; el guardia solo consulta propietarios.
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/usuarios.controller');

const router = Router();
const ADMINS = [ROLES.ADMIN_PLATAFORMA, ROLES.ADMIN_RECINTO];

router.use(autenticar);

router.get('/', permitirRoles(...ADMINS, ROLES.GUARDIA), controller.listar);
router.get('/:id', permitirRoles(...ADMINS, ROLES.GUARDIA), controller.obtener);
router.post('/', permitirRoles(...ADMINS), controller.crear);
router.put('/:id', permitirRoles(...ADMINS), controller.actualizar);
router.patch('/:id/estado', permitirRoles(...ADMINS), controller.cambiarEstado);

module.exports = router;
