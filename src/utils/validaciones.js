// Reglas de validación reutilizables (express-validator)
const { body, param, query } = require('express-validator');
const { validarRut } = require('./rut');

// Convierte '' en null para que los campos opcionales se puedan vaciar
const vacioANull = (valor) => (typeof valor === 'string' && valor.trim() === '' ? null : valor);

// :id numérico en la URL
const idParam = param('id').isInt({ min: 1 }).withMessage('Id inválido').toInt();

// Texto obligatorio (en edición se vuelve opcional)
function textoRequerido(campo, nombre, max, { edicion = false } = {}) {
  const regla = body(campo);
  return (edicion ? regla.optional() : regla)
    .isString().withMessage(`${nombre} es obligatorio`)
    .trim()
    .notEmpty().withMessage(`${nombre} es obligatorio`)
    .isLength({ max }).withMessage(`${nombre} admite máximo ${max} caracteres`);
}

// Texto opcional: '' se guarda como null
function textoOpcional(campo, nombre, max) {
  return body(campo)
    .customSanitizer(vacioANull)
    .optional({ values: 'null' })
    .isString()
    .trim()
    .isLength({ max }).withMessage(`${nombre} admite máximo ${max} caracteres`);
}

// Valor dentro de una lista (enum)
function enumBody(campo, nombre, opciones, { opcional = false } = {}) {
  const regla = body(campo);
  return (opcional ? regla.customSanitizer(vacioANull).optional({ values: 'null' }) : regla)
    .isIn(opciones).withMessage(`${nombre} debe ser: ${opciones.join(', ')}`);
}

// Id de otra tabla en el body (opcional permite null)
function idBody(campo, nombre, { opcional = false } = {}) {
  const regla = body(campo);
  return (opcional ? regla.customSanitizer(vacioANull).optional({ values: 'null' }) : regla)
    .isInt({ min: 1 }).withMessage(`${nombre} inválido`)
    .toInt();
}

const rut = (opciones = {}) =>
  (opciones.edicion ? body('rut').optional() : body('rut'))
    .isString().withMessage('El RUT es obligatorio')
    .custom(validarRut).withMessage('RUT inválido');

const email = (opciones = {}) =>
  (opciones.edicion ? body('email').optional() : body('email'))
    .isString().trim().toLowerCase()
    .isEmail().withMessage('Email inválido')
    .isLength({ max: 150 });

// Contraseña: obligatoria al crear, opcional al editar (si viene, se cambia)
const password = (opciones = {}) =>
  (opciones.edicion ? body('password').customSanitizer(vacioANull).optional({ values: 'null' }) : body('password'))
    .isString()
    .isLength({ min: 8, max: 72 }).withMessage('La contraseña debe tener entre 8 y 72 caracteres')
    .matches(/[A-Za-z]/).withMessage('La contraseña debe incluir letras')
    .matches(/\d/).withMessage('La contraseña debe incluir números');

const telefono = () =>
  body('telefono')
    .customSanitizer(vacioANull)
    .optional({ values: 'null' })
    .isString().trim()
    .matches(/^\+?[\d\s-]{8,20}$/).withMessage('Teléfono inválido');

const ip = () =>
  body('ip')
    .customSanitizer(vacioANull)
    .optional({ values: 'null' })
    .isIP().withMessage('IP inválida');

// Roles por recinto: [{ recinto_id, rol, unidad_id }]
const ROLES_RECINTO = ['admin_recinto', 'propietario', 'guardia'];
function rolesBody({ obligatorio = false } = {}) {
  return [
    (obligatorio ? body('roles') : body('roles').optional())
      .isArray({ max: 200 }).withMessage('Los roles deben ser una lista'),
    body('roles.*.recinto_id').isInt({ min: 1 }).withMessage('Recinto inválido').toInt(),
    body('roles.*.rol').isIn(ROLES_RECINTO).withMessage('Rol inválido'),
    body('roles.*.unidad_id').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Unidad inválida').toInt(),
  ];
}

const activoBody = body('activo').isBoolean({ strict: true }).withMessage('activo debe ser true o false');

// ---------- Query string ----------
const paginacionQuery = [
  query('pagina').optional().isInt({ min: 1 }).toInt(),
  query('limite').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const activoQuery = query('activo').optional().isIn(['true', 'false']).toBoolean(true);
const busquedaQuery = query('busqueda').optional().isString().trim().isLength({ max: 100 });

module.exports = {
  idParam,
  textoRequerido,
  textoOpcional,
  enumBody,
  idBody,
  rut,
  email,
  password,
  telefono,
  ip,
  activoBody,
  rolesBody,
  paginacionQuery,
  activoQuery,
  busquedaQuery,
};
