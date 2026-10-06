// Dispositivos (Raspberry Pi)
//  - Rutas /equipo/*: las llama la propia Raspberry Pi, autenticada con API key.
//  - Resto: gestión desde el panel del admin de recinto (JWT).
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const autenticarDispositivo = require('../middlewares/authDispositivo');
const permitirRoles = require('../middlewares/roles');
const ROLES = require('../utils/roles');
const controller = require('../controllers/dispositivos.controller');

const router = Router();

// --- Endpoints para la Raspberry Pi (van antes de /:id para no confundirse) ---
router.post('/equipo/heartbeat', autenticarDispositivo, controller.heartbeat);
router.get('/equipo/patentes', autenticarDispositivo, controller.obtenerPatentes);
router.post('/equipo/accesos', autenticarDispositivo, controller.registrarAcceso);

// --- Gestión desde el panel ---
router.get('/', autenticar, permitirRoles(ROLES.ADMIN_RECINTO), controller.listar);
router.get('/:id', autenticar, permitirRoles(ROLES.ADMIN_RECINTO), controller.obtener);
router.post('/', autenticar, permitirRoles(ROLES.ADMIN_RECINTO), controller.crear);
router.put('/:id', autenticar, permitirRoles(ROLES.ADMIN_RECINTO), controller.actualizar);
router.delete('/:id', autenticar, permitirRoles(ROLES.ADMIN_RECINTO), controller.eliminar);
router.post('/:id/api-key', autenticar, permitirRoles(ROLES.ADMIN_RECINTO), controller.regenerarApiKey);

module.exports = router;
