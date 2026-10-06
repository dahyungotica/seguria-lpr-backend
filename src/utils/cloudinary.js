// Subida de imágenes a Cloudinary usando su API REST (sin SDK).
// Credenciales en CLOUDINARY_URL = cloudinary://API_KEY:API_SECRET@CLOUD_NAME
// La BD guarda solo la URL que devuelve Cloudinary.
const crypto = require('crypto');
const { env } = require('../config/env');
const HttpError = require('./HttpError');

const CARPETA = 'seguria-lpr/capturas';

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
    throw new HttpError(502, 'Error al subir la imagen: ' + ((json.error && json.error.message) || respuesta.status));
  }
  return json;
}

// imagen: data URI ("data:image/jpeg;base64,...") o URL pública
async function subirImagen(imagen, carpeta = CARPETA) {
  const resultado = await llamar('upload', { file: imagen, folder: carpeta, format: 'jpg' });
  return { url: resultado.secure_url, publicId: resultado.public_id };
}

async function eliminarImagen(publicId) {
  return llamar('destroy', { public_id: publicId });
}

module.exports = { subirImagen, eliminarImagen, cloudinaryConfigurado: () => Boolean(credenciales()) };
