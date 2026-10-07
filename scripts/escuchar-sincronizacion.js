// Cliente de prueba de la sincronización de patentes (HU-36).
// Se conecta como lo haría una Raspberry Pi y muestra la lista completa y cada cambio que llega.
// Sirve para probar el backend y como referencia para integrar el equipo real.
//
// Uso:
//   npm run escuchar -- --id <IDENTIFICADOR> --key <API_KEY> [--api https://seguria-lpr-backend.onrender.com]
//
// Eventos:
//   "patentes:completa" -> { generado, total, patentes: [{ patente, origen, vigente_hasta }] }
//   "patentes:cambios"  -> { generado, altas: [{ patente, origen, vigente_hasta }], bajas: ["ABCD12", ...] }
//   "patentes:solicitar" (lo envía el equipo) -> pide de nuevo la lista completa
const { io } = require('socket.io-client');

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf('--' + nombre);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : porDefecto;
}

const SERVIDOR = argumento('api', process.env.SIM_SERVIDOR || 'http://localhost:3000').replace(/\/api\/?$/, '');
const ID = argumento('id', process.env.SIM_ID);
const KEY = argumento('key', process.env.SIM_KEY);

if (!ID || !KEY) {
  console.error('Uso: npm run escuchar -- --id <IDENTIFICADOR> --key <API_KEY> [--api <URL del backend>]');
  process.exit(1);
}

// Copia local en memoria (en la Raspberry Pi real debe guardarse en disco para sobrevivir a un reinicio)
const copiaLocal = new Map();
const hora = () => new Date().toLocaleTimeString('es-CL');

const socket = io(SERVIDOR + '/dispositivos', { auth: { identificador: ID, api_key: KEY } });

socket.on('connect', () => console.log(`[${hora()}] 🔌 Conectado como ${ID}`));
socket.on('connect_error', (e) => console.error(`[${hora()}] ❌ No se pudo conectar: ${e.message}`));
socket.on('disconnect', (motivo) => console.log(`[${hora()}] ⚠️  Desconectado (${motivo}); se reintentará automáticamente`));

socket.on('patentes:completa', (datos) => {
  copiaLocal.clear();
  for (const p of datos.patentes) copiaLocal.set(p.patente, p);
  console.log(`[${hora()}] 📋 Lista completa: ${datos.total} patente(s) -> ${[...copiaLocal.keys()].join(', ') || '(vacía)'}`);
});

socket.on('patentes:cambios', (datos) => {
  for (const p of datos.altas) copiaLocal.set(p.patente, p);
  for (const patente of datos.bajas) copiaLocal.delete(patente);
  if (datos.altas.length) console.log(`[${hora()}] ➕ Altas: ${datos.altas.map((p) => `${p.patente} (${p.origen})`).join(', ')}`);
  if (datos.bajas.length) console.log(`[${hora()}] ➖ Bajas: ${datos.bajas.join(', ')}`);
  console.log(`[${hora()}]    Copia local: ${copiaLocal.size} patente(s)`);
});
