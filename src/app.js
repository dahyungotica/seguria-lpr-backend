// Configuración de Express: middlewares globales y rutas
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { env } = require('./config/env');
const rutas = require('./routes');
const { rutaNoEncontrada, errorHandler } = require('./middlewares/errorHandler');

const app = express();

// Render está detrás de un proxy: necesario para obtener la IP real del cliente
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    // Si FRONTEND_URL está vacía (solo en desarrollo) se permite cualquier origen
    origin: env.FRONTEND_URL.length > 0 ? env.FRONTEND_URL : true,
  })
);
// Las Raspberry Pi envían la captura en base64: se permite un body más grande solo en sus rutas
app.use('/api/dispositivos/equipo', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.esProduccion ? 'combined' : 'dev'));

app.get('/', (req, res) => {
  res.json({ nombre: 'SegurIA-LPR API', estado: 'ok', docs: '/api/health' });
});

app.use('/api', rutas);

app.use(rutaNoEncontrada);
app.use(errorHandler);

module.exports = app;
