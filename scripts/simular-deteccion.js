// Simula una Raspberry Pi enviando una detección de patente (para probar el monitor del guardia).
//
// Uso:
//   node scripts/simular-deteccion.js --id RPI-01 --key <API_KEY> --camara 1 --patente ABCD12
//
// Opciones:
//   --api <url>        URL de la API (por defecto http://localhost:3000/api)
//   --id <texto>       Identificador del dispositivo (el que registraste en "Cámaras y equipos")
//   --key <texto>      API key que se mostró al crear el dispositivo
//   --camara <id>      Id de la cámara (debe estar en el mismo recinto del dispositivo)
//   --patente <texto>  Patente detectada (por defecto una al azar)
//   --confianza <n>    Confianza del OCR, 0 a 100 (por defecto 95)
//   --sin-imagen       No envía captura (no usa Cloudinary)
//
// También se pueden usar las variables de entorno SIM_API, SIM_ID, SIM_KEY y SIM_CAMARA.

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf('--' + nombre);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : porDefecto;
}

const API = argumento('api', process.env.SIM_API || 'http://localhost:3000/api');
const ID = argumento('id', process.env.SIM_ID);
const KEY = argumento('key', process.env.SIM_KEY);
const CAMARA = Number(argumento('camara', process.env.SIM_CAMARA));
const CONFIANZA = Number(argumento('confianza', 95));
const SIN_IMAGEN = process.argv.includes('--sin-imagen');

function patenteAlAzar() {
  const letras = 'BCDFGHJKLPRSTVWXYZ';
  let p = '';
  for (let i = 0; i < 4; i++) p += letras[Math.floor(Math.random() * letras.length)];
  return p + String(Math.floor(Math.random() * 90) + 10);
}

const PATENTE = argumento('patente', patenteAlAzar()).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Imagen de prueba: una "foto" simple de una patente chilena dibujada en SVG
function imagenDePrueba(patente) {
  const texto = patente.length === 6 ? `${patente.slice(0, 2)}·${patente.slice(2, 4)}·${patente.slice(4)}` : patente;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">
    <rect width="960" height="540" fill="#1f2937"/>
    <rect x="0" y="380" width="960" height="160" fill="#111827"/>
    <rect x="230" y="150" width="500" height="240" rx="40" fill="#374151"/>
    <rect x="250" y="245" width="460" height="120" rx="10" fill="#f8fafc" stroke="#0f172a" stroke-width="6"/>
    <text x="480" y="335" font-family="Arial, sans-serif" font-size="72" font-weight="bold" text-anchor="middle" fill="#0f172a">${texto}</text>
    <text x="480" y="275" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" fill="#334155">CHILE</text>
    <text x="20" y="35" font-family="monospace" font-size="22" fill="#e5e7eb">CAM ${CAMARA} · ${new Date().toLocaleString('es-CL')}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function llamar(metodo, ruta, body) {
  const respuesta = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Dispositivo-Id': ID, 'X-API-Key': KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(`${respuesta.status} ${(datos && datos.error) || ''} ${datos && datos.detalles ? JSON.stringify(datos.detalles) : ''}`);
  }
  return datos;
}

async function main() {
  if (!ID || !KEY || !CAMARA) {
    console.error('Faltan datos. Uso: node scripts/simular-deteccion.js --id <IDENTIFICADOR> --key <API_KEY> --camara <ID> [--patente ABCD12]');
    process.exit(1);
  }

  await llamar('POST', '/dispositivos/equipo/heartbeat');
  console.log('💓 Heartbeat enviado');

  const acceso = await llamar('POST', '/dispositivos/equipo/accesos', {
    camara_id: CAMARA,
    patente: PATENTE,
    confianza_ocr: CONFIANZA,
    imagen_base64: SIN_IMAGEN ? undefined : imagenDePrueba(PATENTE),
  });

  console.log(`🚗 Detección registrada: ${acceso.patente_detectada} -> ${acceso.resultado.toUpperCase()}`);
  if (acceso.propietario_nombre) console.log(`   Propietario: ${acceso.propietario_nombre} (${acceso.unidad || 'sin unidad'})`);
  if (acceso.nombre_visitante) console.log(`   Visita: ${acceso.nombre_visitante}`);
  if (acceso.imagen_url) console.log(`   Captura: ${acceso.imagen_url}`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
