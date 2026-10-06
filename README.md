# SegurIA-LPR – Backend

API REST y servidor de tiempo real de **SegurIA-LPR**, sistema de control de acceso vehicular por reconocimiento de patentes (LPR). Proyecto Capstone – Duoc UC.

- **Stack:** Node.js 20, Express, Socket.io, PostgreSQL (`pg`), JWT, bcrypt.
- **Hosting:** Render (plan gratuito).
- **Frontend:** repositorio aparte → [seguria-lpr-frontend](https://github.com/dahyungotica/seguria-lpr-frontend).

> Estado actual: login, MER y los módulos de **ambos administradores** (plataforma y recinto) funcionales. Los endpoints del propietario (vehículos, visitas), del guardia (autorización manual) y de la Raspberry Pi están protegidos por rol y responden `501 No implementado`.

## Estructura

```
seguria-lpr-backend/
├── src/
│   ├── index.js           # Servidor HTTP + Express + Socket.io
│   ├── app.js             # Middlewares globales y rutas /api
│   ├── config/            # env.js (variables) y db.js (pool PostgreSQL)
│   ├── routes/            # Definición de endpoints y permisos por rol
│   ├── controllers/       # Reciben la petición y responden
│   ├── services/          # Lógica de negocio y consultas SQL
│   ├── middlewares/       # auth (JWT), roles, validar, errorHandler, authDispositivo
│   ├── sockets/           # Socket.io: autenticación y rooms
│   └── utils/
├── scripts/               # db-init, seed, db-reset
├── sql/                   # schema.sql (MER) y drop.sql
└── docs/MER.md            # Diagrama del modelo de datos
```

## Instalación

Requisitos: Node.js 20 o superior y una base de datos PostgreSQL (local o en Render).

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
# editar .env con tus valores
```

### Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3000; Render lo asigna solo). |
| `NODE_ENV` | `development` o `production`. |
| `DATABASE_URL` | Cadena de conexión de PostgreSQL. |
| `DB_SSL` | `true` si la BD exige SSL (conexión externa a Render), `false` en local. |
| `JWT_SECRET` | Secreto para firmar los tokens. Largo y aleatorio (mín. 32 caracteres en producción). |
| `JWT_EXPIRES_IN` | Duración del token (por defecto `8h`). |
| `FRONTEND_URL` | Origen(es) permitidos por CORS, separados por coma. Ej: `https://seguria-lpr.netlify.app`. |
| `CLOUDINARY_URL` | Credenciales de Cloudinary (`cloudinary://KEY:SECRET@CLOUD`). |

Para generar un `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Base de datos

| Script | Qué hace |
|---|---|
| `npm run db:init` | Crea tablas, triggers y vistas (`sql/schema.sql`). Si ya existen, no hace nada. |
| `npm run db:seed` | Carga datos de prueba (roles, recinto, unidades, cámara, dispositivo, usuarios, vehículos, accesos). |
| `npm run db:reset` | **Borra todo**, recrea el esquema y carga los datos de prueba. Bloqueado si `NODE_ENV=production`. |

El modelo está documentado en [docs/MER.md](docs/MER.md).

## Correr en local

```bash
npm run dev     # con nodemon (se reinicia al guardar)
npm start       # sin nodemon
```

Verificar: <http://localhost:3000/api/health> → `{ "ok": true, "db": "<hora de la BD>" }` (`db: null` si no hay conexión).

### Credenciales de prueba

> ⚠️ **SOLO PARA DESARROLLO.** Las crea `npm run db:seed`. Nunca uses estas cuentas ni esta contraseña en producción.

| Rol | Email | Contraseña |
|---|---|---|
| Administrador de plataforma | `admin@seguria.cl` | `Seguria2026!` |
| Administrador de recinto | `recinto@seguria.cl` | `Seguria2026!` |
| Propietario | `propietario@seguria.cl` | `Seguria2026!` |
| Guardia | `guardia@seguria.cl` | `Seguria2026!` |

El seed también imprime en consola la API key del dispositivo de prueba `RPI-AROMOS-01` (solo se guarda su hash).

### Probar el login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"guardia@seguria.cl","password":"Seguria2026!"}'

curl http://localhost:3000/api/auth/me -H "Authorization: Bearer <token>"
```

## Endpoints

| Módulo | Rutas | Quién | Estado |
|---|---|---|---|
| Salud | `GET /api/health` | público | ✅ |
| Auth | `POST /auth/login`, `GET /auth/me` | público / token | ✅ |
| Recintos | `GET/POST /recintos`, `GET/PUT /recintos/:id`, `PATCH /recintos/:id/estado` | admin_plataforma (admin_recinto solo ve el suyo) | ✅ |
| Usuarios | `GET/POST /usuarios`, `GET/PUT /usuarios/:id`, `PATCH /usuarios/:id/estado` | plataforma → admins de recinto · recinto → propietarios y guardias · guardia → solo lectura de propietarios | ✅ |
| Unidades | `GET/POST /unidades`, `GET/PUT/DELETE /unidades/:id` | admin_recinto (guardia lectura) | ✅ |
| Cámaras | `GET/POST /camaras`, `GET/PUT/DELETE /camaras/:id` | admin_recinto (guardia lectura) | ✅ |
| Dispositivos | `GET/POST /dispositivos`, `GET/PUT/DELETE /dispositivos/:id`, `POST /dispositivos/:id/api-key` | admin_recinto | ✅ |
| Accesos | `GET /accesos` (filtros + paginación), `GET /accesos/:id`, `GET /accesos/estadisticas` | admin_recinto, guardia, propietario (solo los suyos) | ✅ |
| Notificaciones | `GET /notificaciones`, `GET /notificaciones/no-leidas`, `PATCH /notificaciones/:id/leida`, `PATCH /notificaciones/leer-todas` | admin_recinto | ✅ |
| Vehículos / Visitas | `/vehiculos`, `/visitas` | propietario | 🚧 501 |
| Autorización manual | `POST /accesos/:id/autorizar` | guardia | 🚧 501 |
| Raspberry Pi | `/dispositivos/equipo/*` (API key) | dispositivo | 🚧 501 |

Notas:
- Todas las rutas (salvo health y login) van bajo `/api` y requieren `Authorization: Bearer <token>`.
- Los datos de un recinto se filtran siempre por el `recinto_id` del token: un administrador nunca ve ni modifica datos de otro recinto.
- Listados paginados (`usuarios`, `accesos`, `notificaciones`) aceptan `?pagina=1&limite=20` y responden `{ datos, total, pagina, limite, paginas }`.
- Errores de validación: `400 { error, detalles: [{ campo, mensaje }] }`. Duplicados (email, RUT, unidad, identificador): `409`.
- Al desactivar un recinto, ninguno de sus usuarios puede iniciar sesión.
- Al crear un dispositivo o regenerar su API key, la clave se devuelve **una sola vez** (solo se guarda su hash).

Los permisos de cada ruta están en `src/routes/*.routes.js` y el alcance por rol en `src/services/*.service.js`.

## Tiempo real (Socket.io)

El cliente se conecta con `io(URL, { auth: { token } })`. Cada socket se une a las rooms `recinto:<id>`, `rol:<nombre>`, `recinto:<id>:<rol>` y `usuario:<id>`.

Eventos: `acceso:nuevo`, `vehiculo:cambio`, `notificacion:nueva` (funciones para emitirlos en `src/sockets/index.js`).

## Deploy en Render

1. **Crear la base de datos:** New → PostgreSQL (plan Free). Anota la región.
2. **Crear el servicio web:** New → Web Service → conectar este repositorio.
   - **Región:** la misma que la base de datos.
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. **Variables de entorno** del servicio:
   - `DATABASE_URL` = **Internal Database URL** de la BD (conexión interna, sin SSL).
   - `DB_SSL` = `false`
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = secreto largo y aleatorio
   - `JWT_EXPIRES_IN` = `8h`
   - `FRONTEND_URL` = URL de Netlify (ej. `https://seguria-lpr.netlify.app`)
   - `CLOUDINARY_URL` = tus credenciales
4. **Crear las tablas desde tu PC:** en tu `.env` local usa la **External Database URL** y `DB_SSL=true`, luego:
   ```bash
   npm run db:init
   npm run db:seed    # opcional, solo para un ambiente de pruebas
   ```
5. Verificar `https://<tu-servicio>.onrender.com/api/health`.

> En el plan gratuito el servicio se "duerme" tras 15 minutos sin uso; la primera petición puede tardar unos 30–60 segundos.
