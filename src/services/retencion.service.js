// Retención de capturas (HU-32): las imágenes de los accesos se eliminan de Cloudinary
// pasado el plazo de retención. El registro del acceso se conserva; solo se quita su imagen.
//
// La tarea corre al iniciar el servidor y luego cada 6 horas. En el plan gratuito de Render
// el servidor se suspende sin uso, pero al despertar vuelve a correr al iniciar.
const { query } = require('../config/db');
const { eliminarPorUrl, cloudinaryConfigurado } = require('../utils/cloudinary');
const auditoria = require('./auditoria.service');

const DIAS_RETENCION = 60;
const LOTE = 100;                         // imágenes por ejecución
const INTERVALO_MS = 6 * 60 * 60 * 1000;  // cada 6 horas
const ESPERA_INICIAL_MS = 60 * 1000;      // 1 minuto después de iniciar

async function eliminarCapturasVencidas(dias = DIAS_RETENCION) {
  if (!cloudinaryConfigurado()) return { eliminadas: 0 };

  const { rows } = await query(
    `SELECT id, recinto_id, imagen_url, fecha_hora FROM accesos
     WHERE imagen_url IS NOT NULL AND fecha_hora < NOW() - ($1 || ' days')::interval
     ORDER BY fecha_hora LIMIT ${LOTE}`,
    [String(dias)]
  );

  let eliminadas = 0;
  for (const acceso of rows) {
    try {
      await eliminarPorUrl(acceso.imagen_url);
      await query('UPDATE accesos SET imagen_url = NULL WHERE id = $1', [acceso.id]);
      await auditoria.registrar({ tipo: 'sistema' }, {
        accion: 'eliminar', entidad: 'capturas', entidadId: acceso.id, recintoId: acceso.recinto_id,
        antes: { imagen_url: acceso.imagen_url, fecha_hora: acceso.fecha_hora },
        detalle: `Captura eliminada por retención (${dias} días)`,
      });
      eliminadas++;
    } catch (error) {
      console.error(`No se pudo eliminar la captura del acceso ${acceso.id}:`, error.message);
    }
  }
  if (eliminadas > 0) console.log(`🧹 Retención: ${eliminadas} captura(s) de más de ${dias} días eliminadas`);
  return { eliminadas };
}

function iniciarTareaRetencion() {
  const ejecutar = () => eliminarCapturasVencidas().catch((e) => console.error('Error en la tarea de retención:', e.message));
  setTimeout(ejecutar, ESPERA_INICIAL_MS).unref();
  setInterval(ejecutar, INTERVALO_MS).unref();
}

module.exports = { eliminarCapturasVencidas, iniciarTareaRetencion, DIAS_RETENCION };
