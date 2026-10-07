# Modelo Entidad-Relación – SegurIA-LPR

El script completo está en [`sql/schema.sql`](../sql/schema.sql). Imagen del MER final con los cambios respecto al MER
original de la HU-6: [`documentation/SegurIA-LPR_MER_final.png`](../documentation/SegurIA-LPR_MER_final.png).

```mermaid
erDiagram
    usuarios ||--o{ usuario_recinto : "tiene roles en"
    roles ||--o{ usuario_recinto : "rol en el recinto"
    recintos ||--o{ usuario_recinto : "vincula"
    unidades |o--o{ usuario_recinto : "unidad del propietario"
    recintos ||--o{ unidades : "contiene"
    usuarios ||--o{ vehiculos : "es dueño"
    recintos ||--o{ vehiculos : "autoriza"
    usuarios ||--o{ visitas : "programa"
    recintos ||--o{ visitas : "recibe"
    recintos ||--o{ dispositivos : "tiene"
    recintos ||--o{ camaras : "tiene"
    dispositivos |o--o| camaras : "procesa (1 a 1)"
    camaras ||--o{ accesos : "captura"
    recintos ||--o{ accesos : "registra"
    dispositivos |o--o{ accesos : "detecta"
    vehiculos |o--o{ accesos : "identificado"
    visitas |o--o{ accesos : "identificada"
    usuarios |o--o{ accesos : "autoriza manual"
    accesos ||--o| alertas : "genera"
    recintos ||--o{ alertas : "pertenece"
    usuarios |o--o{ alertas : "atiende (guardia)"
    recintos ||--o{ notificaciones : "genera"
    usuarios ||--o{ notificaciones : "recibe"
    dispositivos ||--o{ sincronizaciones : "registra"
    usuarios |o--o{ auditoria : "autor"
    recintos |o--o{ auditoria : "ocurre en"
    roles {
        int id PK
        varchar nombre UK
        varchar descripcion
    }
    recintos {
        int id PK
        varchar nombre
        varchar direccion
        varchar comuna
        varchar region
        varchar tipo
        varchar telefono
        bool activo
        timestamptz created_at
        timestamptz updated_at
    }
    unidades {
        int id PK
        int recinto_id FK
        varchar identificador UK
        varchar tipo
        bool activo
        timestamptz created_at
        timestamptz updated_at
    }
    usuarios {
        int id PK
        varchar rut UK
        varchar nombre
        varchar apellido
        varchar email UK
        varchar password_hash
        varchar telefono
        bool es_admin_plataforma
        bool activo
        timestamptz ultimo_login
        timestamptz created_at
        timestamptz updated_at
    }
    usuario_recinto {
        int id PK
        int usuario_id FK,UK
        int recinto_id FK,UK
        int rol_id FK,UK
        int unidad_id FK
        bool activo
        timestamptz created_at
        timestamptz updated_at
    }
    vehiculos {
        int id PK
        int propietario_id FK
        int recinto_id FK
        varchar patente UK
        varchar marca
        varchar modelo
        varchar color
        varchar tipo
        bool activo
        timestamptz created_at
        timestamptz updated_at
    }
    visitas {
        int id PK
        int propietario_id FK
        int recinto_id FK
        varchar nombre_visitante
        varchar rut_visitante
        varchar patente
        varchar motivo
        timestamptz fecha_inicio
        timestamptz fecha_fin
        varchar estado
        timestamptz created_at
        timestamptz updated_at
    }
    dispositivos {
        int id PK
        int recinto_id FK
        varchar nombre
        varchar identificador UK
        varchar api_key_hash
        varchar ip
        varchar estado
        timestamptz ultima_sincronizacion
        timestamptz ultimo_heartbeat
        timestamptz created_at
        timestamptz updated_at
    }
    camaras {
        int id PK
        int recinto_id FK
        int dispositivo_id FK,UK
        varchar nombre
        varchar ubicacion
        varchar sentido
        varchar ip
        varchar url_stream
        varchar estado
        timestamptz created_at
        timestamptz updated_at
    }
    accesos {
        bigint id PK
        int recinto_id FK
        int camara_id FK
        int dispositivo_id FK
        varchar patente_detectada
        numeric confianza_ocr
        varchar imagen_url
        varchar sentido
        timestamptz fecha_hora
        varchar resultado
        int vehiculo_id FK
        int visita_id FK
        int guardia_id FK
        text detalle_autorizacion
        timestamptz created_at
    }
    alertas {
        bigint id PK
        int recinto_id FK
        bigint acceso_id FK,UK
        varchar estado
        varchar decision
        int guardia_id FK
        text detalle
        timestamptz atendida_at
        timestamptz created_at
    }
    notificaciones {
        bigint id PK
        int recinto_id FK
        int usuario_destino_id FK
        int usuario_origen_id FK
        varchar tipo
        varchar entidad
        bigint entidad_id
        jsonb datos_anteriores
        jsonb datos_nuevos
        varchar mensaje
        bool leida
        timestamptz created_at
    }
    sincronizaciones {
        bigint id PK
        int dispositivo_id FK
        timestamptz fecha_hora
        int registros_enviados
        varchar estado
        text detalle_error
    }
    auditoria {
        bigint id PK
        timestamptz fecha
        int recinto_id FK
        varchar actor_tipo
        int usuario_id FK
        varchar actor_nombre
        varchar actor_rol
        varchar accion
        varchar entidad
        bigint entidad_id
        jsonb datos_anteriores
        jsonb datos_nuevos
        text detalle
        varchar ip
    }
```

## Tablas

| Tabla | Descripción |
|---|---|
| **roles** | Roles que se asignan dentro de un recinto: admin_recinto, guardia y propietario. Una persona puede tener varios (en `usuario_recinto`). |
| **recintos** | Lugares controlados (condominio, empresa, estacionamiento). Se desactivan en vez de borrarse; un recinto inactivo bloquea el ingreso de sus usuarios. |
| **unidades** | Departamentos, casas u oficinas de un recinto. El identificador es único dentro del recinto. |
| **usuarios** | Una cuenta por persona (un email, un RUT y una contraseña con hash bcrypt). No guarda roles ni recintos: eso está en `usuario_recinto`. `es_admin_plataforma` marca al administrador de plataforma. |
| **usuario_recinto** | Roles de cada persona en cada recinto: una fila por recinto + rol, con la unidad (solo en el rol propietario) y su estado. Así una misma cuenta puede administrar 3 recintos, ser guardia en 2 y propietaria en 1, y al iniciar sesión elige con qué perfil entrar (HU-19, HU-20). Único: (usuario, recinto, rol). El admin de plataforma no se vincula (HU-22). Un trigger valida rol, unidad y recinto. |
| **vehiculos** | Vehículos de cada propietario en un recinto. Patente normalizada y única por recinto. |
| **visitas** | Visitas con ventana horaria: hasta 24 h si las programa el propietario, hasta 30 días el admin (HU-28). Si traen patente, queda autorizada mientras estén vigentes. |
| **dispositivos** | Raspberry Pi de cada recinto (API key con hash, último heartbeat y última sincronización). Cada equipo atiende **una sola cámara** (relación 1 a 1); un equipo sin cámara queda pendiente de asignación. |
| **camaras** | Cámaras IP; cada una controla una entrada o una salida. `dispositivo_id` es único (1 a 1 con la Raspberry Pi) y opcional: sin equipo, la cámara queda **pendiente de asignación** y no se usa (no registra accesos ni aparece en el monitor del guardia). |
| **accesos** | Historial de detecciones con su resultado. La captura se guarda en Cloudinary como privada (solo la URL en la BD) y se elimina a los 60 días (HU-32). |
| **alertas** | Una por cada acceso denegado. El guardia la atiende autorizando (detalle obligatorio) o rechazando; queda pendiente o atendida con la decisión (HU-31). |
| **notificaciones** | Avisos en tiempo real al administrador (cambios de propietarios, visitas, accesos no autorizados). |
| **sincronizaciones** | Bitácora de cada envío de patentes a una Raspberry Pi por Socket.io (HU-36). |
| **auditoria** | Bitácora inmutable de cada creación, edición o eliminación: autor (usuario, equipo o sistema), acción, entidad, datos antes/después, recinto, fecha e IP (HU-5). |

## Otros objetos

- **`fn_actualizar_updated_at()`** + triggers `trg_*_updated_at`: actualizan `updated_at` en cada UPDATE.
- **`fn_normalizar_patente()`** + triggers: guardan las patentes en mayúsculas y sin guiones ni espacios.
- **`fn_validar_usuario_recinto()`**: impide vincular al admin de plataforma, exige unidad en el rol propietario (y solo en ese rol) y que la unidad sea del mismo recinto.
- **`fn_auditoria_inmutable()`**: impide `UPDATE`, `DELETE` y `TRUNCATE` sobre `auditoria`.
- **`vw_patentes_autorizadas`**: vehículos activos de propietarios activos en el recinto + visitas vigentes. Es lo que se sincroniza con cada Raspberry Pi.

## Cambios respecto al MER original (HU-6)

- **Implementadas tal como se diseñaron:** `usuario_recinto` (con `unidad_id` en vez de `numero_vivienda` y con `rol_id`: el rol se asigna por recinto), `alertas` y `auditoria`.
- **Modificadas:** las tablas ADMIN, PROPIETARIO y GUARDIA se reemplazaron por una sola cuenta en `usuarios` + `roles` asignados por recinto en `usuario_recinto`; VEHICULO perdió `es_visita`/`fecha_expiracion` (ahora tabla `visitas`) y `registrado_por` (lo cubre la auditoría); PROCESADOR pasó a `dispositivos`, manteniendo la relación 1 a 1 con la cámara pero opcional (cámara o equipo sin pareja = pendiente de asignación); REGISTRO_ACCESO pasó a `accesos` con más datos.
- **Nuevas:** `roles`, `unidades`, `visitas`, `notificaciones` y `sincronizaciones`.

## Criterios de borrado (ON DELETE)

- Los recintos y usuarios **no se borran, se desactivan**. Borrar un recinto queda bloqueado si tiene usuarios, accesos o auditoría.
- Los **accesos** se conservan aunque se borren vehículos, visitas o equipos (`SET NULL`); la cámara y el guardia que autorizó están protegidos (`RESTRICT`).
- La **auditoría** no se puede modificar ni borrar.
