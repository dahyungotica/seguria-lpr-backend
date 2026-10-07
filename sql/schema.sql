-- =====================================================================
-- SegurIA-LPR - Modelo Entidad-Relación (PostgreSQL)
-- Sistema de control de acceso vehicular por reconocimiento de patentes
-- Ejecutar con: npm run db:init
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------

-- Actualiza la columna updated_at en cada UPDATE
CREATE OR REPLACE FUNCTION fn_actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Normaliza una patente: mayúsculas y solo letras/números (sin guiones ni espacios)
CREATE OR REPLACE FUNCTION fn_normalizar_patente(p TEXT)
RETURNS TEXT AS $$
  SELECT NULLIF(REGEXP_REPLACE(UPPER(COALESCE(p, '')), '[^A-Z0-9]', '', 'g'), '');
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- 1. roles
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      VARCHAR(30) NOT NULL UNIQUE
              CHECK (nombre IN ('admin_plataforma', 'admin_recinto', 'propietario', 'guardia')),
  descripcion VARCHAR(200)
);

COMMENT ON TABLE roles IS 'Roles del sistema. Determinan los permisos de cada usuario.';
COMMENT ON COLUMN roles.nombre IS 'Nombre interno del rol: admin_plataforma, admin_recinto, propietario o guardia.';

-- ---------------------------------------------------------------------
-- 2. recintos
-- ---------------------------------------------------------------------
CREATE TABLE recintos (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre     VARCHAR(120) NOT NULL,
  direccion  VARCHAR(200),
  comuna     VARCHAR(80),
  region     VARCHAR(80),
  tipo       VARCHAR(20) NOT NULL DEFAULT 'condominio'
             CHECK (tipo IN ('condominio', 'empresa', 'estacionamiento', 'otro')),
  telefono   VARCHAR(20),
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recintos_nombre ON recintos (nombre);

COMMENT ON TABLE recintos IS 'Lugares físicos controlados por el sistema (condominios, empresas, estacionamientos).';
COMMENT ON COLUMN recintos.activo IS 'Un recinto inactivo no opera; se prefiere desactivar antes que borrar para conservar el historial.';

-- ---------------------------------------------------------------------
-- 3. unidades
-- ---------------------------------------------------------------------
CREATE TABLE unidades (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recinto_id    INTEGER NOT NULL REFERENCES recintos (id) ON DELETE CASCADE,
  identificador VARCHAR(50) NOT NULL,
  tipo          VARCHAR(20) NOT NULL DEFAULT 'departamento'
                CHECK (tipo IN ('departamento', 'casa', 'oficina', 'local', 'otro')),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_unidades_recinto_identificador UNIQUE (recinto_id, identificador)
);

CREATE INDEX idx_unidades_recinto ON unidades (recinto_id);

COMMENT ON TABLE unidades IS 'Subdivisiones de un recinto (departamentos, casas, oficinas) a las que pertenecen los propietarios.';
COMMENT ON COLUMN unidades.identificador IS 'Nombre visible de la unidad, ej. "Depto 304" o "Casa 12". Único dentro del recinto.';

-- ---------------------------------------------------------------------
-- 4. usuarios
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rut           VARCHAR(12) NOT NULL UNIQUE,
  nombre        VARCHAR(80) NOT NULL,
  apellido      VARCHAR(80) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE CHECK (email = LOWER(email)),
  password_hash VARCHAR(100) NOT NULL,
  telefono      VARCHAR(20),
  rol_id        INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_login  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usuarios_rol ON usuarios (rol_id);
CREATE INDEX idx_usuarios_apellido_nombre ON usuarios (apellido, nombre);

COMMENT ON TABLE usuarios IS 'Cuentas de las personas que usan la plataforma web. El vínculo con los recintos está en usuario_recinto.';
COMMENT ON COLUMN usuarios.email IS 'Correo de inicio de sesión, siempre en minúsculas.';
COMMENT ON COLUMN usuarios.password_hash IS 'Hash bcrypt de la contraseña. Nunca se guarda la contraseña en texto plano.';
COMMENT ON COLUMN usuarios.activo IS 'Bloqueo global de la cuenta. El estado en cada recinto está en usuario_recinto.activo.';

-- ---------------------------------------------------------------------
-- 5. usuario_recinto (vínculo de un usuario con uno o más recintos)
-- ---------------------------------------------------------------------
CREATE TABLE usuario_recinto (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  recinto_id INTEGER NOT NULL REFERENCES recintos (id) ON DELETE RESTRICT,
  unidad_id  INTEGER REFERENCES unidades (id) ON DELETE RESTRICT,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_usuario_recinto UNIQUE (usuario_id, recinto_id)
);

CREATE INDEX idx_usuario_recinto_recinto ON usuario_recinto (recinto_id);
CREATE INDEX idx_usuario_recinto_unidad ON usuario_recinto (unidad_id);

COMMENT ON TABLE usuario_recinto IS 'Vincula a un usuario con cada recinto donde participa. Un propietario o un guardia puede estar en más de un recinto; el administrador de plataforma no se vincula a ninguno.';
COMMENT ON COLUMN usuario_recinto.unidad_id IS 'Unidad del propietario en ese recinto. Obligatoria para propietarios y vacía para los demás roles.';
COMMENT ON COLUMN usuario_recinto.activo IS 'Desactivar el vínculo quita el acceso a ese recinto sin afectar los demás recintos del usuario.';

-- Reglas entre rol, recinto y unidad (no se pueden expresar con un CHECK simple)
CREATE OR REPLACE FUNCTION fn_validar_usuario_recinto()
RETURNS TRIGGER AS $$
DECLARE
  v_rol TEXT;
  v_recinto_unidad INTEGER;
BEGIN
  SELECT r.nombre INTO v_rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = NEW.usuario_id;

  IF v_rol = 'admin_plataforma' THEN
    RAISE EXCEPTION 'El administrador de plataforma no se vincula a recintos';
  END IF;

  IF v_rol = 'propietario' AND NEW.unidad_id IS NULL THEN
    RAISE EXCEPTION 'El propietario debe tener una unidad en el recinto';
  END IF;

  IF NEW.unidad_id IS NOT NULL THEN
    IF v_rol <> 'propietario' THEN
      RAISE EXCEPTION 'Solo los propietarios pueden tener unidad asignada';
    END IF;
    SELECT recinto_id INTO v_recinto_unidad FROM unidades WHERE id = NEW.unidad_id;
    IF v_recinto_unidad <> NEW.recinto_id THEN
      RAISE EXCEPTION 'La unidad no pertenece al recinto';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuario_recinto_validar
  BEFORE INSERT OR UPDATE ON usuario_recinto
  FOR EACH ROW EXECUTE FUNCTION fn_validar_usuario_recinto();

-- ---------------------------------------------------------------------
-- 6. vehiculos
-- ---------------------------------------------------------------------
CREATE TABLE vehiculos (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  propietario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  recinto_id     INTEGER NOT NULL REFERENCES recintos (id) ON DELETE CASCADE,
  patente        VARCHAR(10) NOT NULL CHECK (patente ~ '^[A-Z0-9]{4,10}$'),
  marca          VARCHAR(50),
  modelo         VARCHAR(50),
  color          VARCHAR(30),
  tipo           VARCHAR(20) NOT NULL DEFAULT 'auto'
                 CHECK (tipo IN ('auto', 'moto', 'camioneta', 'otro')),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_vehiculos_recinto_patente UNIQUE (recinto_id, patente)
);

CREATE INDEX idx_vehiculos_propietario ON vehiculos (propietario_id);
CREATE INDEX idx_vehiculos_patente ON vehiculos (patente);

COMMENT ON TABLE vehiculos IS 'Vehículos autorizados de cada propietario. El propietario los edita sin aprobación y cada cambio se notifica al administrador.';
COMMENT ON COLUMN vehiculos.patente IS 'Patente normalizada: mayúsculas, sin guiones ni espacios (ej. ABCD12).';

-- ---------------------------------------------------------------------
-- 7. visitas
-- ---------------------------------------------------------------------
CREATE TABLE visitas (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  propietario_id   INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  recinto_id       INTEGER NOT NULL REFERENCES recintos (id) ON DELETE CASCADE,
  nombre_visitante VARCHAR(120) NOT NULL,
  rut_visitante    VARCHAR(12),
  patente          VARCHAR(10) CHECK (patente ~ '^[A-Z0-9]{4,10}$'),
  motivo           VARCHAR(200),
  fecha_inicio     TIMESTAMPTZ NOT NULL,
  fecha_fin        TIMESTAMPTZ NOT NULL,
  estado           VARCHAR(20) NOT NULL DEFAULT 'programada'
                   CHECK (estado IN ('programada', 'activa', 'finalizada', 'cancelada')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_visitas_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_visitas_propietario ON visitas (propietario_id);
CREATE INDEX idx_visitas_recinto_fechas ON visitas (recinto_id, fecha_inicio, fecha_fin);
CREATE INDEX idx_visitas_patente ON visitas (patente);
CREATE INDEX idx_visitas_estado ON visitas (estado);

COMMENT ON TABLE visitas IS 'Visitas programadas por los propietarios. Si traen vehículo, su patente queda autorizada durante la vigencia.';
COMMENT ON COLUMN visitas.patente IS 'Patente del vehículo de la visita (opcional, normalizada).';

-- ---------------------------------------------------------------------
-- 8. dispositivos (Raspberry Pi)
-- ---------------------------------------------------------------------
CREATE TABLE dispositivos (
  id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recinto_id            INTEGER NOT NULL REFERENCES recintos (id) ON DELETE CASCADE,
  nombre                VARCHAR(80) NOT NULL,
  identificador         VARCHAR(60) NOT NULL UNIQUE,
  api_key_hash          VARCHAR(100) NOT NULL,
  ip                    VARCHAR(45),
  estado                VARCHAR(20) NOT NULL DEFAULT 'inactivo'
                        CHECK (estado IN ('activo', 'inactivo', 'sin_conexion')),
  ultima_sincronizacion TIMESTAMPTZ,
  ultimo_heartbeat      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispositivos_recinto ON dispositivos (recinto_id);

COMMENT ON TABLE dispositivos IS 'Equipos Raspberry Pi instalados en cada recinto. Procesan las imágenes y validan contra una copia local de patentes.';
COMMENT ON COLUMN dispositivos.identificador IS 'Código único del equipo (ej. número de serie) que usa para autenticarse.';
COMMENT ON COLUMN dispositivos.api_key_hash IS 'Hash bcrypt de la API key del dispositivo.';
COMMENT ON COLUMN dispositivos.ultimo_heartbeat IS 'Última señal de vida recibida; sirve para detectar equipos sin conexión.';

-- ---------------------------------------------------------------------
-- 9. camaras
-- ---------------------------------------------------------------------
CREATE TABLE camaras (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recinto_id     INTEGER NOT NULL REFERENCES recintos (id) ON DELETE CASCADE,
  dispositivo_id INTEGER REFERENCES dispositivos (id) ON DELETE SET NULL,
  nombre         VARCHAR(80) NOT NULL,
  ubicacion      VARCHAR(120),
  sentido        VARCHAR(10) NOT NULL CHECK (sentido IN ('entrada', 'salida')),
  ip             VARCHAR(45),
  url_stream     VARCHAR(300),
  estado         VARCHAR(20) NOT NULL DEFAULT 'activa'
                 CHECK (estado IN ('activa', 'inactiva', 'falla')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_camaras_recinto ON camaras (recinto_id);
CREATE INDEX idx_camaras_dispositivo ON camaras (dispositivo_id);

COMMENT ON TABLE camaras IS 'Cámaras IP que capturan los vehículos. Cada una se conecta a un dispositivo y controla un sentido (entrada o salida).';
COMMENT ON COLUMN camaras.url_stream IS 'URL RTSP/HTTP del video de la cámara.';

-- ---------------------------------------------------------------------
-- 10. accesos
-- ---------------------------------------------------------------------
CREATE TABLE accesos (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recinto_id           INTEGER NOT NULL REFERENCES recintos (id) ON DELETE RESTRICT,
  camara_id            INTEGER NOT NULL REFERENCES camaras (id) ON DELETE RESTRICT,
  dispositivo_id       INTEGER REFERENCES dispositivos (id) ON DELETE SET NULL,
  patente_detectada    VARCHAR(10) NOT NULL,
  confianza_ocr        NUMERIC(5, 2) CHECK (confianza_ocr BETWEEN 0 AND 100),
  imagen_url           VARCHAR(500),
  sentido              VARCHAR(10) NOT NULL CHECK (sentido IN ('entrada', 'salida')),
  fecha_hora           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resultado            VARCHAR(20) NOT NULL
                       CHECK (resultado IN ('autorizado', 'denegado', 'autorizado_manual', 'visita')),
  vehiculo_id          INTEGER REFERENCES vehiculos (id) ON DELETE SET NULL,
  visita_id            INTEGER REFERENCES visitas (id) ON DELETE SET NULL,
  guardia_id           INTEGER REFERENCES usuarios (id) ON DELETE RESTRICT,
  detalle_autorizacion TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Si el guardia autoriza manualmente, debe quedar registrado quién y por qué
  CONSTRAINT ck_accesos_autorizacion_manual CHECK (
    resultado <> 'autorizado_manual'
    OR (guardia_id IS NOT NULL AND detalle_autorizacion IS NOT NULL AND LENGTH(TRIM(detalle_autorizacion)) > 0)
  )
);

CREATE INDEX idx_accesos_recinto_fecha ON accesos (recinto_id, fecha_hora DESC);
CREATE INDEX idx_accesos_patente ON accesos (patente_detectada);
CREATE INDEX idx_accesos_camara ON accesos (camara_id);
CREATE INDEX idx_accesos_dispositivo ON accesos (dispositivo_id);
CREATE INDEX idx_accesos_vehiculo ON accesos (vehiculo_id);
CREATE INDEX idx_accesos_visita ON accesos (visita_id);
CREATE INDEX idx_accesos_guardia ON accesos (guardia_id);

COMMENT ON TABLE accesos IS 'Registro (historial) de cada detección de patente y su resultado.';
COMMENT ON COLUMN accesos.confianza_ocr IS 'Porcentaje de confianza del OCR (0 a 100).';
COMMENT ON COLUMN accesos.imagen_url IS 'URL de la captura en Cloudinary. La imagen no se guarda en la BD.';
COMMENT ON COLUMN accesos.resultado IS 'autorizado (vehículo registrado), visita (visita vigente), denegado, o autorizado_manual (por un guardia).';
COMMENT ON COLUMN accesos.detalle_autorizacion IS 'Justificación obligatoria cuando un guardia autoriza manualmente.';

-- ---------------------------------------------------------------------
-- 11. alertas (gestión de los ingresos no autorizados)
-- ---------------------------------------------------------------------
CREATE TABLE alertas (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recinto_id  INTEGER NOT NULL REFERENCES recintos (id) ON DELETE RESTRICT,
  acceso_id   BIGINT NOT NULL UNIQUE REFERENCES accesos (id) ON DELETE CASCADE,
  estado      VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'atendida')),
  decision    VARCHAR(12) CHECK (decision IN ('autorizado', 'rechazado')),
  guardia_id  INTEGER REFERENCES usuarios (id) ON DELETE RESTRICT,
  detalle     TEXT,
  atendida_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una alerta atendida registra quién decidió y qué; autorizar exige un detalle
  CONSTRAINT ck_alertas_gestion CHECK (
    (estado = 'pendiente' AND decision IS NULL AND guardia_id IS NULL AND atendida_at IS NULL)
    OR (estado = 'atendida' AND decision IS NOT NULL AND guardia_id IS NOT NULL AND atendida_at IS NOT NULL
        AND (decision <> 'autorizado' OR LENGTH(TRIM(COALESCE(detalle, ''))) > 0))
  )
);

CREATE INDEX idx_alertas_recinto_estado ON alertas (recinto_id, estado);
CREATE INDEX idx_alertas_guardia ON alertas (guardia_id);

COMMENT ON TABLE alertas IS 'Una alerta por cada acceso denegado. El guardia la atiende autorizando (con detalle obligatorio) o rechazando el ingreso.';
COMMENT ON COLUMN alertas.estado IS 'pendiente: nadie la ha gestionado; atendida: el guardia tomó una decisión.';
COMMENT ON COLUMN alertas.decision IS 'autorizado (ingreso permitido manualmente) o rechazado (ingreso denegado por el guardia).';

-- ---------------------------------------------------------------------
-- 12. notificaciones
-- ---------------------------------------------------------------------
CREATE TABLE notificaciones (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recinto_id         INTEGER NOT NULL REFERENCES recintos (id) ON DELETE CASCADE,
  usuario_destino_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  usuario_origen_id  INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
  tipo               VARCHAR(30) NOT NULL CHECK (tipo IN (
                       'vehiculo_creado', 'vehiculo_editado', 'vehiculo_eliminado',
                       'visita_creada', 'acceso_no_autorizado', 'dispositivo_desconectado')),
  entidad            VARCHAR(30),
  entidad_id         BIGINT,
  datos_anteriores   JSONB,
  datos_nuevos       JSONB,
  mensaje            VARCHAR(300) NOT NULL,
  leida              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notificaciones_destino_leida ON notificaciones (usuario_destino_id, leida, created_at DESC);
CREATE INDEX idx_notificaciones_recinto ON notificaciones (recinto_id);
CREATE INDEX idx_notificaciones_origen ON notificaciones (usuario_origen_id);

COMMENT ON TABLE notificaciones IS 'Avisos para los usuarios (ej. cambios de vehículos para el administrador). Se emiten también en tiempo real por Socket.io.';
COMMENT ON COLUMN notificaciones.entidad IS 'Tabla afectada (ej. "vehiculos").';
COMMENT ON COLUMN notificaciones.datos_anteriores IS 'Estado previo del registro (para mostrar qué cambió).';
COMMENT ON COLUMN notificaciones.datos_nuevos IS 'Estado nuevo del registro.';

-- ---------------------------------------------------------------------
-- 13. sincronizaciones
-- ---------------------------------------------------------------------
CREATE TABLE sincronizaciones (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id     INTEGER NOT NULL REFERENCES dispositivos (id) ON DELETE CASCADE,
  fecha_hora         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registros_enviados INTEGER NOT NULL DEFAULT 0 CHECK (registros_enviados >= 0),
  estado             VARCHAR(10) NOT NULL CHECK (estado IN ('ok', 'error')),
  detalle_error      TEXT
);

CREATE INDEX idx_sincronizaciones_dispositivo_fecha ON sincronizaciones (dispositivo_id, fecha_hora DESC);

COMMENT ON TABLE sincronizaciones IS 'Bitácora de cada sincronización de patentes autorizadas hacia una Raspberry Pi.';

-- ---------------------------------------------------------------------
-- 14. auditoria (bitácora inmutable)
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recinto_id       INTEGER REFERENCES recintos (id) ON DELETE RESTRICT,
  actor_tipo       VARCHAR(12) NOT NULL CHECK (actor_tipo IN ('usuario', 'dispositivo', 'sistema')),
  usuario_id       INTEGER REFERENCES usuarios (id) ON DELETE RESTRICT,
  actor_nombre     VARCHAR(170),
  actor_rol        VARCHAR(30),
  accion           VARCHAR(20) NOT NULL CHECK (accion IN (
                     'crear', 'editar', 'eliminar', 'activar', 'desactivar', 'vincular',
                     'autorizar', 'rechazar', 'cancelar', 'regenerar_clave', 'consultar')),
  entidad          VARCHAR(30) NOT NULL,
  entidad_id       BIGINT,
  datos_anteriores JSONB,
  datos_nuevos     JSONB,
  detalle          TEXT,
  ip               VARCHAR(45)
);

CREATE INDEX idx_auditoria_recinto_fecha ON auditoria (recinto_id, fecha DESC);
CREATE INDEX idx_auditoria_usuario ON auditoria (usuario_id);
CREATE INDEX idx_auditoria_entidad ON auditoria (entidad, entidad_id);

COMMENT ON TABLE auditoria IS 'Bitácora de cada creación, edición o eliminación en el sistema: quién, qué, cuándo y el detalle. No se puede editar ni eliminar.';
COMMENT ON COLUMN auditoria.recinto_id IS 'Recinto donde ocurrió la acción. NULL para acciones de plataforma (recintos y administradores).';
COMMENT ON COLUMN auditoria.actor_tipo IS 'usuario (persona en la web), dispositivo (Raspberry Pi) o sistema (tareas automáticas).';
COMMENT ON COLUMN auditoria.actor_nombre IS 'Nombre del autor al momento de la acción (se conserva aunque luego cambie).';

-- La bitácora es de solo inserción: cualquier intento de modificarla o borrarla falla
CREATE OR REPLACE FUNCTION fn_auditoria_inmutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no se puede modificar ni eliminar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();

CREATE TRIGGER trg_auditoria_sin_truncate
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION fn_auditoria_inmutable();

-- ---------------------------------------------------------------------
-- Triggers: updated_at y normalización de patentes
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_recintos_updated_at BEFORE UPDATE ON recintos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_unidades_updated_at BEFORE UPDATE ON unidades
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_usuario_recinto_updated_at BEFORE UPDATE ON usuario_recinto
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_vehiculos_updated_at BEFORE UPDATE ON vehiculos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_visitas_updated_at BEFORE UPDATE ON visitas
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_dispositivos_updated_at BEFORE UPDATE ON dispositivos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER trg_camaras_updated_at BEFORE UPDATE ON camaras
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- Normaliza la patente antes de guardar (por si llega con guiones o minúsculas)
CREATE OR REPLACE FUNCTION fn_normalizar_patente_vehiculo_visita()
RETURNS TRIGGER AS $$
BEGIN
  NEW.patente = fn_normalizar_patente(NEW.patente);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_normalizar_patente_acceso()
RETURNS TRIGGER AS $$
BEGIN
  NEW.patente_detectada = COALESCE(fn_normalizar_patente(NEW.patente_detectada), NEW.patente_detectada);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vehiculos_patente BEFORE INSERT OR UPDATE OF patente ON vehiculos
  FOR EACH ROW EXECUTE FUNCTION fn_normalizar_patente_vehiculo_visita();
CREATE TRIGGER trg_visitas_patente BEFORE INSERT OR UPDATE OF patente ON visitas
  FOR EACH ROW EXECUTE FUNCTION fn_normalizar_patente_vehiculo_visita();
CREATE TRIGGER trg_accesos_patente BEFORE INSERT OR UPDATE OF patente_detectada ON accesos
  FOR EACH ROW EXECUTE FUNCTION fn_normalizar_patente_acceso();

-- ---------------------------------------------------------------------
-- Vista para la sincronización con la Raspberry Pi
-- Patentes autorizadas por recinto: vehículos activos (de propietarios
-- activos) + visitas programadas/activas que estén vigentes ahora.
-- ---------------------------------------------------------------------
CREATE VIEW vw_patentes_autorizadas AS
SELECT
  v.recinto_id,
  v.patente,
  'vehiculo'::VARCHAR(10) AS origen,
  v.id                    AS vehiculo_id,
  NULL::INTEGER           AS visita_id,
  NULL::TIMESTAMPTZ       AS vigente_hasta
FROM vehiculos v
JOIN usuarios u ON u.id = v.propietario_id
JOIN usuario_recinto ur ON ur.usuario_id = v.propietario_id AND ur.recinto_id = v.recinto_id
WHERE v.activo AND u.activo AND ur.activo
UNION ALL
SELECT
  vi.recinto_id,
  vi.patente,
  'visita'::VARCHAR(10),
  NULL::INTEGER,
  vi.id,
  vi.fecha_fin
FROM visitas vi
JOIN usuarios u ON u.id = vi.propietario_id
JOIN usuario_recinto ur ON ur.usuario_id = vi.propietario_id AND ur.recinto_id = vi.recinto_id
WHERE vi.patente IS NOT NULL
  AND u.activo AND ur.activo
  AND vi.estado IN ('programada', 'activa')
  AND NOW() BETWEEN vi.fecha_inicio AND vi.fecha_fin;

COMMENT ON VIEW vw_patentes_autorizadas IS 'Patentes autorizadas por recinto (vehículos activos de propietarios activos en ese recinto y visitas vigentes). Es lo que se sincroniza con cada Raspberry Pi.';

COMMIT;
