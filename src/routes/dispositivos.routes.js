// Dispositivos (Raspberry Pi)
//  - Rutas /equipo/*: las llama la propia Raspberry Pi, autenticada con API key.
//  - Resto: gestión desde el panel del admin de recinto (JWT).
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const autenticarDispositivo = require('../middlewares/authDispositivo');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/dispositivos.controller');

const router = Router();

function reglasDispositivo(edicion) {
  return [
    v.textoRequerido('nombre', 'El nombre', 80, { edicion }),
    v.textoRequerido('identificador', 'El identificador', 60, { edicion }),
    v.ip(),
    ...(edicion ? [v.enumBody('estado', 'El estado', ['activo', 'inactivo', 'sin_conexion'], { opcional: true })] : []),
  ];
}

// --- Endpoints para la Raspberry Pi (van antes de /:id para no confundirse) ---
router.post('/equipo/heartbeat', autenticarDispositivo, controller.heartbeat);
router.get('/equipo/patentes', autenticarDispositivo, controller.obtenerPatentes);
router.post('/equipo/accesos', autenticarDispositivo, controller.registrarAcceso);

// --- Gestión desde el panel ---
const soloAdmin = [autenticar, permitirRoles(ROLES.ADMIN_RECINTO)];

router.get('/', soloAdmin, controller.listar);
router.get('/:id', soloAdmin, v.idParam, validar, controller.obtener);
router.post('/', soloAdmin, reglasDispositivo(false), validar, controller.crear);
router.put('/:id', soloAdmin, [v.idParam, ...reglasDispositivo(true)], validar, controller.actualizar);
router.delete('/:id', soloAdmin, v.idParam, validar, controller.eliminar);
router.post('/:id/api-key', soloAdmin, v.idParam, validar, controller.regenerarApiKey);

module.exports = router;
