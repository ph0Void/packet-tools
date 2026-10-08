# Frontend - Packet Tools

Interfaz web de **Packet Tools**, la plataforma de automatización y gestión de redes compatible con Cisco Packet Tracer, GNS3 y equipos físicos (Cisco, Huawei, Aruba, MikroTik) vía SSH, Telnet y puerto serie.

Aplicación Next.js (App Router) que consume la API del backend, mantiene la sesión con JWT en cookie httpOnly y concentra la experiencia del operador: chat agéntico, terminal de consola, workspace de topologías, base de conocimiento RAG, tareas programadas y administración de usuarios y proveedores de IA.

- [README principal del proyecto](../../README.md)
- [Backend (`@packet-tools/server`)](../server/README.md)

---

## Stack tecnológico

| Área | Tecnología |
| --- | --- |
| Framework | Next.js 16.3 (App Router) |
| UI | React 19.2 + React Compiler (`reactCompiler: true`), TypeScript |
| Estilos | Tailwind CSS v4, shadcn UI (estilo `radix-nova`), `radix-ui`, `class-variance-authority`, `tw-animate-css` |
| Estado | Zustand con persistencia selectiva en `localStorage` |
| Iconografía y avisos | `lucide-react`, `sonner` |
| Animación y UI avanzada | `motion`, `cmdk` |
| Tiempo real | `socket.io-client` (eventos del agente y canales de terminal) |
| Terminal | `@xterm/xterm` + `@xterm/addon-fit` |
| Topologías | `@xyflow/react` (React Flow) |
| Markdown del chat | `streamdown` + `shiki` (código, mermaid y matemáticas) |
| Utilidades | `use-stick-to-bottom`, `cron-parser`, `zod`, `jose` |

## Requisitos previos

- Node.js 20.9 o superior y npm (el monorepo fija `npm@10.8.2`).
- Archivo `.env` en la raíz del monorepo (ver [Variables de entorno](#variables-de-entorno)).
- Backend en ejecución (por defecto en `http://localhost:7531`).

## Puesta en marcha

Ejecuta los comandos desde la raíz del monorepo:

```bash
npm run init       # copia .example.env a .env e instala dependencias
npm run migrate    # aplica las migraciones de Prisma (SQLite)
npm run generate   # genera el cliente Prisma
npm run seed       # carga datos iniciales (usuario admin, configuración, etc.)
npm run dev        # levanta backend y frontend en paralelo (turbo)
```

Con el entorno en marcha:

| Servicio | URL |
| --- | --- |
| Frontend | `http://localhost:3090` |
| Backend | `http://localhost:7531` |

## Variables de entorno

Todas las variables viven en el `.env` de la raíz del monorepo (se carga con `dotenv-cli` desde los scripts raíz y turbo). Plantilla de referencia: [`.example.env`](../../.example.env).

| Variable | Descripción | Valor de ejemplo |
| --- | --- | --- |
| `PORT` | Puerto del frontend | `3090` |
| `NEXT_PUBLIC_API_URL` | URL base del backend; alimenta el rewrite de `/api` y `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:7531` |
| `NEXT_PUBLIC_COOKIE_NAME` | Nombre de la cookie de sesión | `packet-tools-cookie` |
| `NEXT_PUBLIC_PROYECT_NAME` | Nombre visible del proyecto | `Packet Tools` |
| `VERSION` | Versión mostrada en la interfaz | `1.2.0` |
| `NODE_ENV` | Entorno de ejecución; el `.env` raíz usa `development` | `development` |

## Scripts

| Script | Comando | Descripción |
| --- | --- | --- |
| `dev` | `next dev` | Servidor de desarrollo |
| `build` | `node scripts/build.mjs` | Build de producción |
| `start` | `next start` | Sirve el build de producción |
| `lint` | `eslint` | ESLint del paquete |

No hay script de typecheck ni tests en este paquete: la suite de pruebas vive en el backend.

> **Nota sobre el build**: el `.env` raíz exporta `NODE_ENV=development` porque el backend y el cron lo necesitan, pero `next build` exige `NODE_ENV=production` durante el prerender. Por eso `scripts/build.mjs` fuerza `NODE_ENV=production` antes de invocar el binario de Next. Usa siempre `npm run build` (del paquete o del raíz con turbo), nunca `next build` directamente con el entorno raíz cargado.

## Estructura del proyecto

```text
packages/web/
├── next.config.ts
├── scripts/
│   └── build.mjs           # Build con NODE_ENV=production forzado
└── src/
    ├── proxy.ts            # Middleware de Next 16 (función proxy + matcher)
    ├── action/             # Server actions por dominio (auth, chats, config, ...)
    ├── app/                # App Router: /, /auth y /dashboard/*
    ├── component/          # Componentes de dominio (chat, terminal, workspace, ...)
    ├── components/
    │   ├── ui/             # Componentes shadcn UI
    │   └── ai-elements/    # Piezas reutilizables del chat (mensajes, razonamiento, ...)
    ├── config/             # EnvConfig
    ├── context/            # ChatContext
    ├── hooks/              # useCiscoChat, useCiscoSocket
    ├── lib/                # Utilidades (cn)
    ├── service/            # Servicios de dominio (Chat, Topology, Devices, ...)
    │   └── client/         # ApiClient, BackendService, CookieService
    ├── store/              # Stores Zustand (auth, chat, terminal, topology, ui)
    ├── types/              # Tipos compartidos
    └── utils/              # CookieHelper, FormatDate, Logger
```

## Rutas y páginas del dashboard

Roles: **USER** accede en modo lectura, **STAFF** gestiona dispositivos, topologías, chats, tareas y alertas, **ADMIN** administra además usuarios, proveedores de IA, configuración y borrado de registros.

| Ruta | Descripción | Rol |
| --- | --- | --- |
| `/` | Redirige a `/dashboard` o `/auth` según la sesión | Público |
| `/auth` | Inicio de sesión y registro | Público |
| `/dashboard` | Inicio: estadísticas, alertas recientes y accesos rápidos | USER+ |
| `/dashboard/alert` | Gestión de alertas de red | USER / STAFF+ |
| `/dashboard/chat` | Chat agéntico con el agente de red | USER+ |
| `/dashboard/configuration` | Prompt global del sistema y proveedores de modelos | ADMIN |
| `/dashboard/connection` | Dispositivos registrados y proveedores de conexión | USER / STAFF+ |
| `/dashboard/data` | Base de conocimiento RAG | USER / STAFF+ |
| `/dashboard/jobs` | Tareas programadas (cron STANDARD/INTELLIGENT) | USER / STAFF+ |
| `/dashboard/log` | Registros del sistema | USER / ADMIN borra |
| `/dashboard/providers` | Proveedores de modelos LLM | ADMIN |
| `/dashboard/resources` | Manual de usuario y cheat sheets | USER+ |
| `/dashboard/skills` | Skills del agente (crear/editar STAFF+, borrar ADMIN) | USER+ |
| `/dashboard/terminal` | Consola interactiva (SSH, Telnet, serie) | USER solo lectura |
| `/dashboard/topology` | Tabla de topologías guardadas | USER / STAFF+ |
| `/dashboard/workspace` | Listado y acceso a los canvas de topologías | USER / STAFF+ |
| `/dashboard/workspace/[id]` | Canvas interactivo de una topología | USER solo lectura |
| `/dashboard/users` | Gestión de usuarios | USER / ADMIN |

## Autenticación y permisos

La autenticación se aplica en dos capas:

1. **Comprobación de cookie en `src/proxy.ts`** (convención de Next 16: función `proxy` y `matcher`). Solo verifica la presencia de la cookie `NEXT_PUBLIC_COOKIE_NAME` (`packet-tools-cookie`) para `/dashboard/:path*` y `/auth`: sin cookie redirige a `/auth`, con cookie en `/auth` redirige a `/dashboard` y una llegada a `/auth?expired=true` elimina la cookie.
2. **Validación real en server components** con `getSessionUser()` de `src/action/SecureAction.ts`: llama a `GET /api/auth/me` con el token en `Bearer` y devuelve `id`, `username` y `role`. El layout del dashboard fuerza `dynamic = "force-dynamic"` y redirige a `/auth?expired=true` si la sesión no es válida.

El login vive en `AuthAction.loginAction`: guarda el token como cookie httpOnly (30 días, `sameSite: lax`) mediante `CookieHelper`. `SessionHydrator` hidrata el usuario en `authStore` para que el rol controle el menú, las páginas y los permisos de la interfaz.

## Comunicación con el backend

- **Rewrite**: `next.config.ts` redirige `/api/:path*` a `${NEXT_PUBLIC_API_URL}/api/:path*` (por defecto `http://localhost:7531`) y define el bloque `env` que inlinea `NEXT_PUBLIC_BACKEND_URL` a partir de `NEXT_PUBLIC_API_URL`.
- **Server actions**: usan `ApiClient` (`src/service/client/ApiClient.ts`) contra la URL absoluta `NEXT_PUBLIC_BACKEND_URL` con `Authorization` leído de la cookie.
- **Servicios client-safe**: usan `fetch` relativo para pasar por el rewrite de Next.
- **Streaming del chat (SSE) y aprobaciones HITL**: hacen `fetch` directo al backend, sin proxy, para no bufferizar el stream. El parser de `useCiscoChat` maneja los eventos `text_delta`, `reasoning`, `tool_call_start`, `tool_call_result`, `tool_approval_required`, `tool_approval_resolved`, `terminal_command`, `agent_progress`, `handoff`, `error` y `complete`.
- **Socket.IO**: `useCiscoSocket` conecta a `NEXT_PUBLIC_BACKEND_URL` con `withCredentials` y usa los eventos `tool_call`/`tool_result` y los canales de terminal.

## Funcionalidades destacadas

### Chat agéntico

`ChatPrincipalWraper` funciona en dos variantes (página completa y panel), con historial lateral colapsable, selector de modelo, selector de conexión, modo autónomo para STAFF/ADMIN (ejecuta acciones sin aprobación HITL), razonamiento en vivo y segmentos de texto intercalados con herramientas. Los `ToolCard` cubren las variantes HITL: solicitud de aprobación, aprobada, rechazada, expirada, `TERMINAL_REQUIRED` y error. Los mensajes admiten hasta 4 adjuntos.

### Terminal

Consola `xterm.js` con `FitAddon` y tema Tokyo Night, eco local con deduplicación, detección de modo contraseña, resaltado automático de salida Cisco, reconexión, marcadores de comandos inyectados por la IA y modo solo lectura para el rol USER. La toolbar permite conectar por dispositivo guardado o manual (SSH, Telnet o serie con baudrate) y el panel lateral del asistente puede adjuntar el buffer de la consola al chat.

### Workspace

Canvas React Flow con nodos custom por tipo de dispositivo, inspector de dispositivo, sincronización en vivo con Packet Tracer (evento `getNetwork`), guardado y actualización de topologías y modo lectura para USER.

### Otras capacidades

- **Configuración de IA (ADMIN)**: prompt global del sistema y gestión de proveedores de modelos.
- **Base de conocimiento RAG**: subida de documentos `.pdf`, `.txt` y `.md` de hasta 25 MB para indexarlos.
- **Tareas programadas**: cron jobs de tipo STANDARD (script/CLI) e INTELLIGENT (prompt de IA), con validación y vista previa de la expresión cron.
- **Alertas y registros**: feed de alertas recientes, tablas con detalle y registros del sistema con borrado para ADMIN.
- **Usuarios**: administración de cuentas y roles desde la interfaz.

### Interfaz

Componentes shadcn en `src/components/ui`, componentes propios en `src/component/` y piezas de chat en `src/components/ai-elements/`. Tema claro/oscuro con variables CSS en `src/app/globals.css` y script anti-flash en el layout raíz, diseño mobile-first con Tailwind y notificaciones con `sonner`.

## Docker

El repositorio incluye una imagen todo-en-uno (`dockerfile` + `docker-compose.yml`) que ejecuta backend y frontend en un solo contenedor: el frontend queda expuesto en el puerto `3090` y el backend en `7531`. Los valores se toman del `.env` raíz y los datos persisten en un volumen. Consulta el [README principal](../../README.md) para las instrucciones de despliegue.
