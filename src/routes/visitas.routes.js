// Visitas programadas por los propietarios
const { Router } = require('express');
const { body, query } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const { validarRut } = require('../utils/rut');
const { validarPatente } = require('../utils/patente');
const controller = require('../controllers/visitas.controller');

const router = Router();

const vacioANull = (valor) => (typeof valor === 'string' && valor.trim() === '' ? null : valor);

function fecha(campo, nombre, edicion) {
  return (edicion ? body(campo).optional() : body(campo))
    .isISO8601({ strict: true }).withMessage(`${nombre} inválida`);
}

function reglasVisita(edicion) {
  return [
    v.textoRequerido('nombre_visitante', 'El nombre del visitante', 120, { edicion }),
    body('rut_visitante').customSanitizer(vacioANull).optional({ values: 'null' })
      .isString().custom(validarRut).withMessage('RUT del visitante inválido'),
    body('patente').customSanitizer(vacioANull).optional({ values: 'null' })
      .isString().custom(validarPatente).withMessage('Patente inválida. Formatos: BBBB10, AB1234, BBB10 o AB123'),
    v.textoOpcional('motivo', 'El motivo', 200),
    fecha('fecha_inicio', 'Fecha de inicio', edicion),
    fecha('fecha_fin', 'Fecha de término', edicion),
  ];
}

const filtrosListado = [
  ...v.paginacionQuery,
  query('vigencia').optional().isIn(['proximas', 'pasadas', 'hoy']),
  v.busquedaQuery,
];

const LECTORES = [ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO, ROLES.GUARDIA];

router.use(autenticar);

router.get('/', permitirRoles(...LECTORES), filtrosListado, validar, controller.listar);
router.get('/:id', permitirRoles(...LECTORES), v.idParam, validar, controller.obtener);
router.post('/', permitirRoles(ROLES.PROPIETARIO), reglasVisita(false), validar, controller.crear);
router.put('/:id', permitirRoles(ROLES.PROPIETARIO), [v.idParam, ...reglasVisita(true)], validar, controller.actualizar);
router.patch('/:id/cancelar', permitirRoles(ROLES.PROPIETARIO, ROLES.ADMIN_RECINTO), v.idParam, validar, controller.cancelar);

module.exports = router;
