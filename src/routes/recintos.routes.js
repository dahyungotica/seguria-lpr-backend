// Recintos: los crea y administra el admin de plataforma
const { Router } = require('express');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/recintos.controller');

const router = Router();
const TIPOS = ['condominio', 'empresa', 'estacionamiento', 'otro'];

function reglasRecinto(edicion) {
  return [
    v.textoRequerido('nombre', 'El nombre', 120, { edicion }),
    v.enumBody('tipo', 'El tipo', TIPOS, { opcional: edicion }),
    v.textoOpcional('direccion', 'La dirección', 200),
    v.textoOpcional('comuna', 'La comuna', 80),
    v.textoOpcional('region', 'La región', 80),
    v.telefono(),
  ];
}

router.use(autenticar);

router.get('/', permitirRoles(ROLES.ADMIN_PLATAFORMA), [v.busquedaQuery, v.activoQuery], validar, controller.listar);
// El admin de recinto puede ver los datos de su propio recinto
router.get('/:id', permitirRoles(ROLES.ADMIN_PLATAFORMA, ROLES.ADMIN_RECINTO), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(ROLES.ADMIN_PLATAFORMA), reglasRecinto(false), validar, controller.crear);
router.put('/:id', permitirRoles(ROLES.ADMIN_PLATAFORMA), [v.idParam, ...reglasRecinto(true)], validar, controller.actualizar);
router.patch('/:id/estado', permitirRoles(ROLES.ADMIN_PLATAFORMA), [v.idParam, v.activoBody], validar, controller.cambiarEstado);

module.exports = router;
