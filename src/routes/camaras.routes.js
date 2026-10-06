// Cámaras IP del recinto
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/camaras.controller');

const router = Router();

function reglasCamara(edicion) {
  return [
    v.textoRequerido('nombre', 'El nombre', 80, { edicion }),
    v.enumBody('sentido', 'El sentido', ['entrada', 'salida'], { opcional: edicion }),
    v.enumBody('estado', 'El estado', ['activa', 'inactiva', 'falla'], { opcional: true }),
    v.textoOpcional('ubicacion', 'La ubicación', 120),
    v.ip(),
    v.textoOpcional('url_stream', 'La URL del stream', 300),
    v.idBody('dispositivo_id', 'Dispositivo', { opcional: true }),
  ];
}

router.use(autenticar);

router.get('/', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA), controller.listar);
router.get('/:id', permitirRoles(ROLES.ADMIN_RECINTO, ROLES.GUARDIA), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(ROLES.ADMIN_RECINTO), reglasCamara(false), validar, controller.crear);
router.put('/:id', permitirRoles(ROLES.ADMIN_RECINTO), [v.idParam, ...reglasCamara(true)], validar, controller.actualizar);
router.delete('/:id', permitirRoles(ROLES.ADMIN_RECINTO), v.idParam, validar, controller.eliminar);

module.exports = router;
