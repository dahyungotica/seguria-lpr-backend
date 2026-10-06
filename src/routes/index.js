// Agrupa todas las rutas de la API bajo /api
const { Router } = require('express');
const { pool } = require('../config/db');

const router = Router();

// GET /api/health -> estado de la API y de la base de datos (no falla si no hay BD)
router.get('/health', async (req, res) => {
  let db = null;
  if (pool) {
    try {
      const { rows } = await pool.query('SELECT NOW() AS hora');
      db = rows[0].hora;
    } catch (err) {
      console.error('Health check: no se pudo conectar a la BD:', err.message);
    }
  }
  res.json({ ok: true, db });
});

router.use('/auth', require('./auth.routes'));
router.use('/usuarios', require('./usuarios.routes'));
router.use('/recintos', require('./recintos.routes'));
router.use('/unidades', require('./unidades.routes'));
router.use('/vehiculos', require('./vehiculos.routes'));
router.use('/visitas', require('./visitas.routes'));
router.use('/camaras', require('./camaras.routes'));
router.use('/dispositivos', require('./dispositivos.routes'));
router.use('/accesos', require('./accesos.routes'));
router.use('/notificaciones', require('./notificaciones.routes'));

module.exports = router;
