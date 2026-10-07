// Imágenes en Cloudinary usando su API REST (sin SDK).
// Credenciales en CLOUDINARY_URL = cloudinary://API_KEY:API_SECRET@CLOUD_NAME
//
// HU-32: las capturas se suben como privadas (tipo "authenticated"): su URL directa no se puede abrir.
// La BD guarda solo esa URL, y el backend entrega una URL firmada únicamente a quien tiene permiso
// de ver el acceso. Las capturas se eliminan automáticamente pasado el plazo de retención.
const crypto = require('crypto');
const { env } = require('../config/env');
const HttpError = require('./HttpError');

const CARPETA = 'seguria-lpr/capturas';
const TIPO_PRIVADO = 'authenticated';

function credenciales() {
  const coincidencia = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(env.CLOUDINARY_URL || '');
  if (!coincidencia) return null;
  return { apiKey: coincidencia[1], apiSecret: coincidencia[2], cloudName: coincidencia[3] };
}

// Parámetros que Cloudinary NO incluye en la firma
const NO_FIRMADOS = ['file', 'api_key', 'resource_type', 'cloud_name'];

// Firma de Cloudinary: SHA-1 de los parámetros ordenados (sin los excluidos) + el secreto
function firmar(parametros, apiSecret) {
  const texto = Object.keys(parametros)
    .filter((clave) => !NO_FIRMADOS.includes(clave))
    .sort()
    .map((clave) => `${clave}=${parametros[clave]}`)
    .join('&');
  return crypto.createHash('sha1').update(texto + apiSecret).digest('hex');
}

async function llamar(endpoint, parametros) {
  const c = credenciales();
  if (!c) throw new HttpError(503, 'Cloudinary no está configurado (falta CLOUDINARY_URL)');

  const datos = { ...parametros, timestamp: Math.floor(Date.now() / 1000) };
  const cuerpo = new URLSearchParams({ ...datos, api_key: c.apiKey, signature: firmar(datos, c.apiSecret) });

  const respuesta = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/image/${endpoint}`, {
    method: 'POST',
    body: cuerpo,
  });
  const json = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new HttpError(502, 'Error en Cloudinary: ' + ((json.error && json.error.message) || respuesta.status));
  }
  return json;
}

// imagen: data URI ("data:image/jpeg;base64,...") o URL pública. Se sube como privada.
async function subirImagen(imagen, carpeta = CARPETA) {
  const resultado = await llamar('upload', { file: imagen, folder: carpeta, format: 'jpg', type: TIPO_PRIVADO });
  // Cloudinary devuelve la URL ya firmada: se guarda SIN la firma, para que la URL de la BD
  // por sí sola no permita ver la imagen. La firma se agrega al entregarla (urlFirmada).
  return { url: resultado.secure_url.replace(/\/s--[\w-]{8}--\//, '/'), publicId: resultado.public_id };
}

// Separa una URL de Cloudinary de esta cuenta en sus partes: tipo (upload/authenticated), versión e id
function analizarUrl(url) {
  const c = credenciales();
  if (!c || !url) return null;
  const m = new RegExp(`^https://res\\.cloudinary\\.com/${c.cloudName}/image/(upload|authenticated)/(?:s--[\\w-]{8}--/)?(?:(v\\d+)/)?(.+)$`).exec(url);
  if (!m) return null;
  const archivo = m[3];
  return { tipo: m[1], version: m[2] || null, archivo, publicId: archivo.replace(/\.[a-z0-9]+$/i, '') };
}

// URL firmada para ver una captura privada (las públicas o externas se devuelven tal cual).
// La firma de entrega de Cloudinary es: base64url(sha1(archivo + secreto)) recortado a 8 caracteres.
function urlFirmada(url) {
  const partes = analizarUrl(url);
  if (!partes || partes.tipo !== TIPO_PRIVADO) return url;
  const { apiSecret, cloudName } = credenciales();
  const firma = crypto.createHash('sha1').update(partes.archivo + apiSecret).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
  const version = partes.version ? `${partes.version}/` : '';
  return `https://res.cloudinary.com/${cloudName}/image/${TIPO_PRIVADO}/s--${firma}--/${version}${partes.archivo}`;
}

// Elimina una imagen a partir de su URL guardada en la BD
async function eliminarPorUrl(url) {
  const partes = analizarUrl(url);
  if (!partes) return { result: 'externa' };
  // invalidate: borra también la copia en caché del CDN para que deje de verse de inmediato
  return llamar('destroy', { public_id: partes.publicId, type: partes.tipo, invalidate: true });
}

async function eliminarImagen(publicId, tipo = TIPO_PRIVADO) {
  return llamar('destroy', { public_id: publicId, type: tipo, invalidate: true });
}

module.exports = {
  subirImagen,
  urlFirmada,
  eliminarPorUrl,
  eliminarImagen,
  cloudinaryConfigurado: () => Boolean(credenciales()),
};
