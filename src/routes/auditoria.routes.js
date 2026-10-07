// Auditoría (HU-5): el admin de recinto revisa la bitácora de su recinto (incluye los cambios
// de los propietarios, HU-26); el admin de plataforma, la de todos los recintos y la suya (HU-23).
// Solo existe GET: los registros no se pueden editar ni eliminar.
const { Router } = require('express');
const { query } = require('express-validator');
const autenticar = require('../middlewares/auth');
const permitirRoles = require('../middlewares/roles');
const validar = require('../middlewares/validar');
const ROLES = require('../utils/roles');
const v = require('../utils/validaciones');
const controller = require('../controllers/auditoria.controller');

const router = Router();

const filtros = [
  ...v.paginacionQuery,
  v.busquedaQuery,
  query('actor_rol').optional({ values: 'falsy' })
    .isIn(['admin_plataforma', 'admin_recinto', 'propietario', 'guardia', 'dispositivo', 'sistema']),
  query('entidad').optional({ values: 'falsy' }).isString().isLength({ max: 30 }),
  query('accion').optional({ values: 'falsy' }).isString().isLength({ max: 20 }),
  // Número de recinto o "plataforma" (acciones sin recinto); solo lo usa el admin de plataforma
  query('recinto_id').optional({ values: 'falsy' }).matches(/^(\d+|plataforma)$/),
  query('desde').optional({ values: 'falsy' }).isDate({ format: 'YYYY-MM-DD', strictMode: true }),
  query('hasta').optional({ values: 'falsy' }).isDate({ format: 'YYYY-MM-DD', strictMode: true }),
];

router.get('/', autenticar, permitirRoles(ROLES.ADMIN_PLATAFORMA, ROLES.ADMIN_RECINTO), filtros, validar, controller.listar);

module.exports = router;
