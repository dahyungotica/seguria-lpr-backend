// Devuelve solo los campos que pasaron por express-validator (ya limpios y convertidos).
// Así los controladores nunca usan campos inesperados que vengan en la petición.
const { matchedData } = require('express-validator');

function datosBody(req) {
  return matchedData(req, { locations: ['body'], includeOptionals: true });
}

function datosQuery(req) {
  return matchedData(req, { locations: ['query'] });
}

function idDeRuta(req) {
  return matchedData(req, { locations: ['params'] }).id;
}

module.exports = { datosBody, datosQuery, idDeRuta };
