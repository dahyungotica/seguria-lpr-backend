-- =====================================================================
-- SegurIA-LPR - Elimina todos los objetos del esquema
-- Lo usa: npm run db:reset  (¡BORRA TODOS LOS DATOS!)
-- =====================================================================
DROP VIEW IF EXISTS vw_patentes_autorizadas;
DROP TABLE IF EXISTS sincronizaciones, notificaciones, accesos, camaras, dispositivos,
  visitas, vehiculos, usuarios, unidades, recintos, roles CASCADE;
DROP FUNCTION IF EXISTS fn_actualizar_updated_at() CASCADE;
DROP FUNCTION IF EXISTS fn_validar_usuario() CASCADE;
DROP FUNCTION IF EXISTS fn_normalizar_patente_vehiculo_visita() CASCADE;
DROP FUNCTION IF EXISTS fn_normalizar_patente_acceso() CASCADE;
DROP FUNCTION IF EXISTS fn_normalizar_patente(TEXT) CASCADE;
