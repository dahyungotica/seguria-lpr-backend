// Vehículos: el propietario los gestiona sin aprobación (cada cambio notifica al admin).
// El admin de recinto también puede gestionarlos y el guardia solo consultarlos.
const { Router } = require('express');
const { body, query } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const { validarPatente } = require('../utils/patente');
const controller = require('../controllers/vehiculos.controller');

const router = Router();
const TIPOS = ['auto', 'moto', 'camioneta', 'otro'];

function reglasVehiculo(edicion) {
  return [
    (edicion ? body('patente').optional() : body('patente'))
      .isString().withMessage('La patente es obligatoria')
      .custom(validarPatente).withMessage('Patente inválida. Formatos: BBBB10, AB1234 (autos) o BBB10, AB123 (motos)'),
    v.textoOpcional('marca', 'La marca', 50),
    v.textoOpcional('modelo', 'El modelo', 50),
    v.textoOpcional('color', 'El color', 30),
    v.enumBody('tipo', 'El tipo', TIPOS, { opcional: true }),
    body('activo').optional().isBoolean({ strict: true }).withMessage('activo debe ser true o false'),
    ...(edicion ? [] : [v.idBody('propietario_id', 'Propietario', { opcional: true })]),
  ];
}

const filtrosListado = [
  query('propietario_id').optional().isInt({ min: 1 }).toInt(),
  query('patente').optional().isString().trim().isLength({ max: 10 }),
  v.activoQuery,
];

const LECTORES = [ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO, ROLES.GUARDIA];
const EDITORES = [ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO];

router.use(autenticar);

router.get('/', permitirRoles(...LECTORES), filtrosListado, validar, controller.listar);
router.get('/:id', permitirRoles(...LECTORES), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(...EDITORES), reglasVehiculo(false), validar, controller.crear);
router.put('/:id', permitirRoles(...EDITORES), [v.idParam, ...reglasVehiculo(true)], validar, controller.actualizar);
router.delete('/:id', permitirRoles(...EDITORES), v.idParam, validar, controller.eliminar);

module.exports = router;
