-- =====================================================================
-- SegurIA-LPR - Elimina todos los objetos del esquema
-- Lo usan: npm run db:reset y npm run db:limpiar  (¡BORRA TODOS LOS DATOS!)
-- =====================================================================
DROP VIEW IF EXISTS vw_patentes_autorizadas;
DROP TABLE IF EXISTS auditoria, sincronizaciones, notificaciones, alertas, accesos, camaras, dispositivos,
  visitas, vehiculos, usuario_recinto, usuarios, unidades, recintos, roles CASCADE;
DROP FUNCTION IF EXISTS fn_actualizar_updated_at() CASCADE;
DROP FUNCTION IF EXISTS fn_validar_usuario() CASCADE;
DROP FUNCTION IF EXISTS fn_validar_usuario_recinto() CASCADE;
DROP FUNCTION IF EXISTS fn_auditoria_inmutable() CASCADE;
DROP FUNCTION IF EXISTS fn_normalizar_patente_vehiculo_visita() CASCADE;
DROP FUNCTION IF EXISTS fn_normalizar_patente_acceso() CASCADE;
DROP FUNCTION IF EXISTS fn_normalizar_patente(TEXT) CASCADE;
