# Modelo Entidad-Relación – SegurIA-LPR

El script completo está en [`sql/schema.sql`](../sql/schema.sql).

```mermaid
erDiagram
    ROLES ||--o{ USUARIOS : "asigna"
    RECINTOS ||--o{ UNIDADES : "contiene"
    RECINTOS ||--o{ USUARIOS : "pertenecen"
    UNIDADES |o--o{ USUARIOS : "habita (propietario)"
    USUARIOS ||--o{ VEHICULOS : "es dueño"
    RECINTOS ||--o{ VEHICULOS : "autoriza"
    USUARIOS ||--o{ VISITAS : "programa"
    RECINTOS ||--o{ VISITAS : "recibe"
    RECINTOS ||--o{ DISPOSITIVOS : "tiene"
    RECINTOS ||--o{ CAMARAS : "tiene"
    DISPOSITIVOS |o--o{ CAMARAS : "procesa"
    RECINTOS ||--o{ ACCESOS : "registra"
    CAMARAS ||--o{ ACCESOS : "captura"
    DISPOSITIVOS |o--o{ ACCESOS : "detecta"
    VEHICULOS |o--o{ ACCESOS : "identificado en"
    VISITAS |o--o{ ACCESOS : "identificada en"
    USUARIOS |o--o{ ACCESOS : "autoriza (guardia)"
    RECINTOS ||--o{ NOTIFICACIONES : "genera"
    USUARIOS ||--o{ NOTIFICACIONES : "recibe"
    USUARIOS |o--o{ NOTIFICACIONES : "origina"
    DISPOSITIVOS ||--o{ SINCRONIZACIONES : "registra"

    ROLES {
        int id PK
        varchar nombre UK "admin_plataforma | admin_recinto | propietario | guardia"
        varchar descripcion
    }
    RECINTOS {
        int id PK
        varchar nombre
        varchar direccion
        varchar comuna
        varchar region
        varchar tipo "condominio | empresa | estacionamiento | otro"
        varchar telefono
        boolean activo
        timestamptz created_at
        timestamptz updated_at
    }
    UNIDADES {
        int id PK
        int recinto_id FK
        varchar identificador "UK con recinto_id"
        varchar tipo
        boolean activo
    }
    USUARIOS {
        int id PK
        varchar rut UK
        varchar nombre
        varchar apellido
        varchar email UK
        varchar password_hash
        varchar telefono
        int rol_id FK
        int recinto_id FK "NULL solo admin_plataforma"
        int unidad_id FK "solo propietarios"
        boolean activo
        timestamptz ultimo_login
    }
    VEHICULOS {
        int id PK
        int propietario_id FK
        int recinto_id FK
        varchar patente "UK con recinto_id, normalizada"
        varchar marca
        varchar modelo
        varchar color
        varchar tipo "auto | moto | camioneta | otro"
        boolean activo
    }
    VISITAS {
        int id PK
        int propietario_id FK
        int recinto_id FK
        varchar nombre_visitante
        varchar rut_visitante
        varchar patente
        varchar motivo
        timestamptz fecha_inicio
        timestamptz fecha_fin "mayor o igual a fecha_inicio"
        varchar estado "programada | activa | finalizada | cancelada"
    }
    DISPOSITIVOS {
        int id PK
        int recinto_id FK
        varchar nombre
        varchar identificador UK
        varchar api_key_hash
        varchar ip
        varchar estado "activo | inactivo | sin_conexion"
        timestamptz ultima_sincronizacion
        timestamptz ultimo_heartbeat
    }
    CAMARAS {
        int id PK
        int recinto_id FK
        int dispositivo_id FK
        varchar nombre
        varchar ubicacion
        varchar sentido "entrada | salida"
        varchar ip
        varchar url_stream
        varchar estado "activa | inactiva | falla"
    }
    ACCESOS {
        bigint id PK
        int recinto_id FK
        int camara_id FK
        int dispositivo_id FK
        varchar patente_detectada
        numeric confianza_ocr
        varchar imagen_url "Cloudinary"
        varchar sentido
        timestamptz fecha_hora
        varchar resultado "autorizado | denegado | autorizado_manual | visita"
        int vehiculo_id FK
        int visita_id FK
        int guardia_id FK
        text detalle_autorizacion
    }
    NOTIFICACIONES {
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
        boolean leida
    }
    SINCRONIZACIONES {
        bigint id PK
        int dispositivo_id FK
        timestamptz fecha_hora
        int registros_enviados
        varchar estado "ok | error"
        text detalle_error
    }
```

## Tablas

| Tabla | Descripción |
|---|---|
| **roles** | Los 4 roles del sistema. Cada usuario tiene exactamente uno. |
| **recintos** | Lugares controlados (condominio, empresa, estacionamiento). Se desactivan en vez de borrarse para conservar el historial. |
| **unidades** | Departamentos, casas u oficinas de un recinto. El identificador es único dentro del recinto. |
| **usuarios** | Administradores, propietarios y guardias. Contraseña con hash bcrypt. Un trigger obliga a que solo `admin_plataforma` no tenga recinto y que solo los propietarios tengan unidad (de su mismo recinto). |
| **vehiculos** | Vehículos autorizados de cada propietario. La patente se normaliza (mayúsculas, sin guiones) y es única por recinto. |
| **visitas** | Visitas programadas por un propietario. Si traen patente, queda autorizada mientras estén vigentes. |
| **dispositivos** | Raspberry Pi de cada recinto. Se autentican con una API key (se guarda solo su hash) y reportan heartbeat. |
| **camaras** | Cámaras IP conectadas a un dispositivo; cada una controla una entrada o una salida. |
| **accesos** | Historial de detecciones con su resultado. La imagen se guarda en Cloudinary (solo la URL). Si el resultado es `autorizado_manual`, el guardia y el detalle son obligatorios (CHECK). |
| **notificaciones** | Avisos al administrador (ej. un propietario editó un vehículo), con datos anteriores y nuevos en JSONB. |
| **sincronizaciones** | Bitácora de cada envío de patentes autorizadas a una Raspberry Pi. |

## Otros objetos

- **`fn_actualizar_updated_at()`** + triggers `trg_*_updated_at`: actualizan `updated_at` en cada UPDATE.
- **`fn_normalizar_patente()`** + triggers: guardan las patentes en mayúsculas y sin guiones ni espacios.
- **`fn_validar_usuario()`**: valida la combinación rol / recinto / unidad.
- **`vw_patentes_autorizadas`**: patentes de vehículos activos (de propietarios activos) más visitas programadas/activas vigentes, por recinto. Es lo que se sincroniza con cada Raspberry Pi.

## Criterios de borrado (ON DELETE)

- Borrar un **recinto** elimina en cascada unidades, cámaras, dispositivos, vehículos y visitas, pero queda **bloqueado** (`RESTRICT`) si tiene usuarios o accesos. En la práctica los recintos y usuarios se **desactivan** (`activo = false`).
- Los **accesos** nunca se pierden al borrar vehículos, visitas o dispositivos (`SET NULL`); la cámara y el guardia que autorizó están protegidos (`RESTRICT`).
