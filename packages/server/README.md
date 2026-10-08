# Backend - Packet Tools

Servidor API y capa de tiempo real de Packet Tools: gestión y configuración de redes (simuladores y equipos físicos) con agentes de IA. Express 5 + TypeScript sobre Prisma 7 + SQLite.

- [README principal](../../README.md)
- [Frontend (Next.js)](../web/README.md)
- [Ejemplo de variables de entorno](../../.example.env)

## Descripción general

El backend expone una API REST bajo `/api` y canales Socket.IO para la integración con los simuladores (Cisco Packet Tracer y GNS3), consolas SSH/Telnet/Serial y el dashboard web. Sobre esa base se ejecuta un supervisor agéntico (Deep Agents) que interpreta peticiones en lenguaje natural, delega en agentes especialistas de contexto aislado, opera herramientas sobre dispositivos y solicita aprobación humana (HITL) antes de ejecutar comandos de riesgo. Incluye autenticación JWT por cookie, control de roles, base de conocimiento con RAG, búsqueda web, alertas, logs y trabajos programados por cron.

## Stack tecnológico

| Área | Tecnología |
| --- | --- |
| Runtime y lenguaje | Node.js, TypeScript (CommonJS; en desarrollo se ejecuta con `tsx`) |
| Framework HTTP | Express 5 |
| Base de datos | Prisma 7 + SQLite (`better-sqlite3` + `@prisma/adapter-better-sqlite3`) |
| Agentes e IA | LangChain + Deep Agents (`deepagents`), proveedores OpenAI, Google, Anthropic, OpenRouter, Ollama, LM Studio y personalizados |
| Tiempo real | Socket.IO, Server-Sent Events (SSE) |
| Conectividad de red | `ssh2`, Telnet sobre `net`, `serialport` |
| Autenticación | JWT (`jsonwebtoken`) en cookie httpOnly, `bcryptjs` |
| Validación y errores | `zod` |
| Archivos | `multer` + `pdf-parse` (PDF/TXT/MD, hasta 25 MB) |
| Programación de tareas | `node-schedule` (temporizador de un disparo) + `cron-parser` (cuándo toca) |
| Seguridad HTTP | `cors`, `express-rate-limit` |
| Pruebas | Vitest + Supertest |

## Arquitectura

El servidor sigue una organización por capas sobre `src/app.ts`:

```text
src/app.ts               Entry point: Express, Socket.IO, cron y arranque del servidor
  └─ src/api/            API REST
       ├─ ServerApi.ts   Monta todos los routers bajo /api
       └─ router/        Routers por recurso (ResourceRouter para CRUD genérico)
  └─ src/middleware/     authMiddleware, requireRoles, manejo de errores
  └─ src/controller/     Controladores de apoyo
  └─ src/service/        Lógica de negocio (chat, cron, vector store, búsqueda web, etc.)
  └─ src/agent/          Grafo de agentes, especialistas y herramientas
  └─ src/client/         Clientes GNS3, Packet Tracer, SSH, Telnet y Serial
  └─ src/sockets/        Socket.IO: autenticación, simulación y terminal
  └─ src/config/         Variables de entorno, modelos de IA y rate limiting
  └─ src/prisma/         Cliente Prisma generado (`src/prisma/generated`)
  └─ src/utils/          JWT, bcrypt, logger y utilidades
```

El flujo de una petición de chat es: router → `ChatService` / grafo de agentes → herramientas → respuesta SSE, persistiendo mensajes, resultados de herramientas y segmentos en la base de datos.

## API REST

Todas las rutas se montan bajo `/api` desde `src/api/ServerApi.ts` y responden con el formato estándar:

```json
{
  "success": true,
  "message": "Descripción del resultado",
  "data": {}
}
```

Salvo `/api/health` y las rutas públicas de autenticación, cada endpoint aplica `authMiddleware`. `safe()` elimina `password` y `token` de las respuestas y enmascara `apiKey` como `"[configured]"`.

| Prefijo | Recurso | Endpoints principales | Permisos |
| --- | --- | --- | --- |
| `/api/auth` | Autenticación | `POST /register`, `POST /login`, `POST /logout`, `GET /me` | Público con rate limit; `logout` y `me` requieren sesión |
| `/api/users` | Usuarios | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` | Lectura: autenticado; mutaciones: `ADMIN` |
| `/api/chats` | Conversaciones del agente | `GET /`, `POST /`, `GET /:id/messages`, `POST /:id/messages` (SSE), `POST /:id/messages/:messageId/retry`, `POST /approvals/:approvalId`, `DELETE /:id` | Cada usuario accede a sus chats; aprobaciones y borrado: `ADMIN`/`STAFF` |
| `/api/alerts` | Alertas | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` | `USER` ve las propias; `ADMIN`/`STAFF` ven todas; mutaciones `ADMIN`/`STAFF` |
| `/api/devices` | Dispositivos detectados | CRUD vía `resourceRouter` (`GET`, `GET /:id`, `POST`, `PUT`, `PATCH`, `DELETE`) | Lectura: autenticado; mutaciones: `ADMIN`/`STAFF` |
| `/api/providers` | Perfiles de conexión (`deviceProviders`) | CRUD vía `resourceRouter` | Lectura: autenticado; mutaciones: `ADMIN` |
| `/api/topologies` | Topologías guardadas | CRUD vía `resourceRouter` | Lectura: autenticado; mutaciones: `ADMIN`/`STAFF` |
| `/api/data` | Base de conocimiento y skills | `GET /`, `POST /` (multipart, 25 MB, PDF/TXT/MD), `GET /:id/file`, `DELETE /:id`, `GET /data/skills`, `POST /data/skills`, `PUT /data/skills/:id`, `DELETE /data/skills/:id` | Carga y borrado: `ADMIN`/`STAFF`; lectura: autenticado; borrar skills: solo `ADMIN` |
| `/api/config` | Configuración e IA | `GET /`, `PUT /` (system prompt), `GET /available-models`, CRUD en `/models`, `POST /models/test` (prueba de conexión real) | `GET` autenticado; mutaciones y test: `ADMIN` |
| `/api/jobs` | Trabajos programados | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/run`, `GET /scheduler` | Lectura: autenticado (`USER` solo los suyos); mutaciones: `ADMIN`/`STAFF` |
| `/api/logs` | Historial de logs | `GET /` (paginado por `page`, `limit`, `level`), `DELETE /:id`, `DELETE /` | Lectura: autenticado; borrado: `ADMIN` |
| `/api/chats/attachments` | Contenido de adjuntos (el archivo no está en la base) | `GET /:id` | Dueño del adjunto o del chat, o `ADMIN` (`404` al resto) |
| `/api/terminal` | Consolas activas | `GET /sessions` | Autenticado |
| `/api/health` | Estado del servicio | `GET /health` | Público |

El CRUD genérico proviene de `resourceRouter(model, { roles, ownerField, scopeReads, adminMutations })` en `src/api/router/ResourceRouter.ts`; los modelos disponibles están tipados en la unión `Model` de ese archivo.

### SSE del chat

`POST /api/chats/:id/messages` responde con `text/event-stream`. El cuerpo admite:

| Campo | Descripción |
| --- | --- |
| `content` | Texto del mensaje (obligatorio) |
| `provider` | Agente/proveedor destino (`default`, `cisco_packet_tracer`, `gns3`, `ssh`, `telnet`, `serial`) |
| `connectionType`, `connectionId` | Conexión objetivo del turno |
| `modelProviderId` | Modelo de IA a utilizar |
| `terminalSessionId` | Sesión de terminal explícita |
| `origin` | `terminal` o `chat` (por defecto `chat`) |
| `stream` | `true` por defecto; con `false` solo persiste el mensaje (201) |
| `attachments` | Hasta 4 adjuntos (imágenes o documentos en data-URL) |
| `autonomousMode` | Ejecución sin confirmaciones para `STAFF`/`ADMIN` |

Eventos emitidos:

| Evento | Contenido |
| --- | --- |
| `user_message` | Mensaje del usuario persistido (con adjuntos) |
| `text_delta` | Fragmento de texto visible del asistente |
| `reasoning` | Fragmento de razonamiento del modelo |
| `tool_call_start` | Inicio de una herramienta (`id`, `name`, `input`) |
| `tool_call_result` | Resultado (`output`, `status`) |
| `tool_approval_required` | Aprobación HITL pendiente (comandos, nivel de riesgo, expiración) |
| `tool_approval_resolved` | Decisión registrada (`approve`/`reject`) |
| `terminal_command` | Comandos aprobados enrutados a la consola activa |
| `agent_progress` | Fase del agente: `reading`, `sending`, `waiting_prompt`, `terminal_required`, `connected`, `disconnected` |
| `handoff` | Transferencia del supervisor a un especialista (`from`, `to`) |
| `plan_update` | Avance del plan del agente (lista de pasos) |
| `skill_loading` / `skill_loaded` / `skill_created` | Carga y creación de skills |
| `subagent_started` / `subagent_completed` | Inicio y fin de un sub-agente |
| `rag_retrieved` | Fuentes recuperadas de la base de conocimiento |
| `admin_action` | Acción administrativa ejecutada desde el chat |
| `error` | Error amigable del stream |
| `complete` | Cierre con el mensaje del asistente persistido (incluye `segments`) |

El stream incluye un heartbeat periódico y persiste `toolCalls`, `reasoning` y `segments` en el modelo `Message`.

## Agentes y orquestación

La orquestación vive en `src/agent/deep/`: un supervisor agéntico (Deep Agents) con sub-agentes especializados de contexto aislado. El modelo elige a quién delegar con la tool nativa `task` (`packet_tracer_specialist`, `gns3_specialist`, `ssh_specialist`, `telnet_specialist`, `serial_specialist`, `knowledge_specialist`, `system_admin_specialist`) y el sub-agente recibe **solo** la tarea delegada, nunca el historial. El supervisor también consulta la base de conocimiento y la web por sí mismo, y lee las skills persistidas en la base de datos (filesystem virtual en memoria) antes de actuar. El presupuesto de pasos por turno (`AGENT_RECURSION_LIMIT`) acota las delegaciones encadenadas, y el historial se reinyecta desde la base de datos en cada turno.

Cada agente reside en `src/agent/<tipo>/` con los archivos `Agent.ts`, `Tool.ts` y `Promt.ts`:

| Agente | Especialidad | Herramientas principales |
| --- | --- | --- |
| `ciscoPacketTracer` | Topologías, dispositivos, módulos, enlaces, PDU, configuración IOS y verificación en Packet Tracer | `createTopology`, `addDevice`, `addModule`, `addLink`, `removeDevice`, `removeLink`, `configurePcIp`, `configureIosDevice`, `getNetwork`, `getDeviceInfo`, `setSimulationMode`, `getSimulationStatus`, `stepSimulation`, `sendPdu`, `renameDevice`, `moveDevice`, `setPower`, `getPduResults`, `getCommandLog`, `runDeviceCommand`, `pingTopology`, `reachMatrix`, `validateTopology`, `listDeviceModels`, `listDeviceModules`, `subnetCalc`, `getDeviceConfig`, `generateNetworkReport`, `qaTopologySuite`, `readDeviceConsole`, `getRoutingTable`, `getVlanConfiguration`, `getDeviceMetrics`, `validateSecurityConfig`, `saveDeviceConfig`, `restoreDeviceConfig`, `exportTopologyFile`, `importTopologyFile`, `clearWorkspace`, `simulateLinkFailure`, `restoreLink` |
| `gns3` | Laboratorios GNS3 vía REST: proyectos, nodos, enlaces, plantillas, energía y diagnóstico de puertos | `createGns3Project`, `createGns3Node`, `connectGns3Nodes`, `controlGns3NodePower`, `getGns3Templates`, `listGns3Nodes`, `listGns3Links`, `testGns3Connectivity` |
| `ssh` | Comandos en equipos físicos por SSH | `executeSshCommands` |
| `telnet` | Comandos en equipos físicos por Telnet | `executeTelnetCommands` |
| `serialPort` | Comandos por consola serial (RS-232 / USB-Serial) | `sendSerialCommand` |
| `knowledge` | Base de conocimiento (RAG) y búsqueda web | `search_knowledge_base`, `ingest_document_to_chroma`, `search_web_tool` |

Además existen herramientas compartidas en `src/agent/tools/`:

- `DeviceTools.ts` (`CONNECTION_TOOLS`): `listDeviceProviders`, `findDeviceByName`.
- `TerminalTools.ts`: `read_terminal`, `get_terminal_status`, `wait_for_prompt`, `send_command`; operan exclusivamente sobre la consola activa.

### Aprobación humana (HITL)

`src/agent/approval/ApprovalMiddleware.ts` y `ApprovalBroker.ts` gestionan las solicitudes de aprobación. `src/agent/security/CommandClassifier.ts` clasifica los comandos (lista blanca de solo lectura, lista negra de comandos peligrosos como `reload`, `write erase`, `erase`, `format`, `delete` o `boot system`, y control de comandos de sesión como `exit`, `quit` o `logout`), mientras que `ToolPolicy.ts` define la política por herramienta. Los comandos destructivos quedan bloqueados si no existe un canal interactivo disponible, la aprobación expira a los 10 minutos y `STAFF`/`ADMIN` pueden activar el modo autónomo.

### Menciones y terminal activa

`MentionParser` resuelve menciones en el mensaje: `@dispositivo` prioriza las consolas abiertas y luego los dispositivos registrados, y `@rag` consulta la base de conocimiento antes de responder. `TerminalSessionHub` mantiene las consolas activas (buffer circular, detección de prompt, keepalive, envío de comandos con espera de inactividad y sanitización de salida) y las herramientas del agente operan solo sobre la consola activa del usuario.

## Sockets

Los canales Socket.IO se registran en `src/app.ts`:

| Archivo | Eventos | Descripción |
| --- | --- | --- |
| `src/sockets/socket.auth.ts` | Middleware | Valida el JWT de la cookie `packet-tools-cookie` o del handshake; exceptúa a la extensión de Packet Tracer (`user-agent` Qt o `clientType=packet-tracer`) y a `clientType=backend-agent` |
| `src/sockets/simulation.socket.ts` | `tool_call`, `tool_result` | Puente con la extensión de Packet Tracer: reenvía las llamadas de herramientas y retransmite los resultados |
| `src/sockets/terminal.socket.ts` | Cliente: `terminal:connect`, `terminal:data`, `terminal:resize`, `terminal:disconnect`; servidor: `terminal:connected`, `terminal:data`, `terminal:error`, `terminal:closed`, `terminal:busy`, `terminal:free` | Consolas interactivas SSH, Telnet y Serial con salida saneada; si el agente opera la consola, las pulsaciones del usuario se ignoran |

## Seguridad y roles

- Autenticación JWT en cookie httpOnly (`packet-tools-cookie`), validada además contra el token almacenado en la base de datos (`src/middleware/auth.middleware.ts`).
- Autorización por jerarquía `USER` < `STAFF` < `ADMIN` con `requireRoles` (`src/middleware/role.middleware.ts`).
- Rate limit exclusivo sobre `/api/auth` (`src/config/RateLimiterConfig.ts`).
- Errores centralizados en `src/middleware/error.middleware.ts`: `ZodError` se traduce en 400 y los conflictos `P2002` de Prisma en 409.
- CORS con credenciales y cuerpo JSON/urlencoded de hasta 50 MB.

| Rol | Alcance |
| --- | --- |
| `USER` | Lectura de recursos autenticados, chats propios, alertas propias y uso de los modelos habilitados por el `ADMIN` |
| `STAFF` | Todo lo anterior más CRUD de dispositivos, topologías, alertas, trabajos y base de conocimiento, además de aprobaciones HITL y modo autónomo |
| `ADMIN` | Gestión completa: usuarios, proveedores de IA, configuración, borrado de logs y todas las operaciones anteriores |

## Base de datos y seed

Prisma 7 sobre SQLite con el adaptador `@prisma/adapter-better-sqlite3`. El esquema está en `prisma/schema.prisma`, las migraciones en `prisma/migrations`, la configuración en `prisma.config.ts` y el cliente generado en `src/prisma/generated`. Modelos principales: `User`, `Configuration`, `ModelProvider`, `Chat`, `Message`, `Attachment`, `KnowledgeBase`, `DeviceProviders`, `Topology`, `ClientTopology`, `Log`, `Alert`, `ConfigTemplate` y `CronJob`.

El seed (`src/seed/seed.ts`) es idempotente y crea:

- Usuario `admin` / `admin123` con rol `ADMIN`.
- Proveedores de conexión `Cisco Packet Tracer` y `GNS3`.
- Dos `ModelProvider` de ejemplo sobre LM Studio (modelos `CHAT` `qwen3.5-4b` y `EMBEDDING` `nomic-embed-text-v1.5`), inicialmente inactivos.

> Advertencia: cambia la contraseña por defecto de `admin` antes de exponer el servicio en cualquier entorno.

La base de conocimiento (`src/service/VectorStoreService.ts`) usa `MemoryVectorStore` de LangChain con los embeddings del proveedor `EMBEDDING` activo, indexa documentos en fragmentos de 1000 caracteres y se rehidrata desde SQLite al arrancar. Si no hay proveedor válido o el servicio de embeddings no responde, la búsqueda degrada automáticamente a coincidencia textual sobre los documentos guardados (modo `textual`). La búsqueda web no requiere API key (DuckDuckGo Lite).

Cada trabajo programado (`CronJob`) tiene **su propio temporizador de un disparo**, no un tick global: `JobScheduler` calcula con `cron-parser` la fecha exacta de la próxima ejecución (o la de `scheduledAt` en una ejecución única) y se la da a `node-schedule`, así que una automatización de las 14:37 corre a las 14:37 y no "en el próximo minuto". El `nextRun` de la base de datos es el espejo de ese temporizador. Al arrancar se arma uno por trabajo activo y los que ya habían vencido (servidor apagado) se recuperan ejecutándose una vez. Al ejecutarse, `CronExecutorService` invoca el grafo de agentes en los de tipo `INTELLIGENT` y ejecuta los comandos del `payload` sobre el dispositivo asignado en los de tipo `STANDARD` (SSH, Telnet, serie y Packet Tracer); ambos escriben su salida real en `Log` con `level = "CRON_EXECUTION"`. `GET /api/jobs/scheduler` devuelve el estado en memoria de los temporizadores.

## Variables de entorno

El archivo `.env` de la raíz del monorepo es obligatorio (copia de [`.example.env`](../../.example.env)); los scripts raíz lo cargan con `dotenv -e .env --`, y migrar o generar el cliente Prisma requiere esa configuración.

| Variable | Descripción | Ejemplo |
| --- | --- | --- |
| `SERVER_PORT` | Puerto del backend | `7531` |
| `NODE_ENV` | Entorno (`development` / `production` / `test`) | `development` |
| `DATABASE_URL` | Ruta del archivo SQLite relativa al paquete | `file:.packet_tool_database.db` |
| `JWT_SECRET` | Clave de firma de los JWT | cadena aleatoria larga |
| `JWT_EXPIRATION` | Vigencia del token | `36000` |
| `RATE_LIMIT_REFRESH` | Ventana del rate limit en milisegundos | `900000` |
| `RATE_LIMIT_REQUESTS` | Peticiones permitidas por ventana | `100` |
| `ATTACHMENTS_DIR` | Carpeta de adjuntos de chat (fuera de la base) | `uploads/attachments` |
| `AGENT_RECURSION_LIMIT` | Presupuesto de pasos por turno (supersteps) | `600` |

La lista completa de variables (`AGENT_*`, `PT_EXTENSION_SECRET`, `CORS_ORIGINS`, límites de terminal y reintentos de proveedor) está documentada en `AGENTS.md`.

## Scripts

Desde `packages/server` (o con `npm run <script> --workspace=@packet-tools/server`):

| Script | Comando | Descripción |
| --- | --- | --- |
| `dev` | `tsx watch src/app.ts` | Servidor en modo desarrollo con recarga |
| `build` | `clean-dist.mjs && tsc && rewrite-dist.mjs && postbuild.mjs` | Compila `dist/` como CommonJS (limpia restos, reescribe alias `@/` y verifica que no quede sintaxis ESM) |
| `start` | `node dist/app.js` | Ejecuta la compilación |
| `migrate` | `prisma migrate dev` | Crea y aplica migraciones en desarrollo |
| `migrate:deploy` | `prisma migrate deploy` | Aplica migraciones pendientes en producción |
| `generate` | `prisma generate && patch-generated.mjs` | Regenera el cliente Prisma (parchea `import.meta` → `__dirname`) |
| `reset` | `prisma migrate reset --force` | Recrea la base de datos |
| `seed` | `tsx src/seed/seed.ts` | Carga los datos iniciales |
| `studio` | `prisma studio` | Interfaz web de la base de datos |
| `test` | `vitest run` | Ejecuta la suite de pruebas (84 suites) |
| `eval` | `tsx test/agent-evals/run.ts` | Evaluaciones del agente |

## Tests

Las pruebas viven en `test/` (84 suites y `helpers.ts`, que comparte utilidades) y usan Vitest + Supertest contra la `app` exportada:

- `fileParallelism: false` y timeout de 20 s (`vitest.config.ts`).
- Bajo Vitest no se escucha ningún puerto y el cron se desactiva con `NODE_ENV=test`.
- Los tests de sockets abren su propio puerto efímero.

```bash
npm test                      # desde la raíz, toda la suite del backend
npm test -- test/auth.test.ts # una suite concreta
npm test -- --watch           # modo watch
```

Suites en vivo contra transportes reales (requieren el hardware o simulador conectado): `test-pt` (Packet Tracer + extensión), `test-terminal`, `test-telnet`, `test-ssh`, `test-serial` y `test-gns3`.

## Estructura del proyecto

```text
packages/server/
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── src/
│   ├── agent/
│   │   ├── approval/            # HITL: middleware y broker de aprobaciones
│   │   ├── ciscoPacketTracer/   # Agente y tools de Packet Tracer
│   │   ├── deep/                # Supervisor Deep Agents (orquestación)
│   │   ├── gns3/                # Agente y tools de GNS3
│   │   ├── knowledge/           # RAG y búsqueda web
│   │   ├── security/            # Clasificador de comandos y política de tools
│   │   ├── serialPort/          # Agente de consola serial
│   │   ├── skills/              # Skills sobre la tabla KnowledgeBase (sin ficheros)
│   │   ├── ssh/                 # Agente SSH
│   │   ├── systemAdmin/         # Administración desde el chat
│   │   ├── telnet/              # Agente Telnet
│   │   ├── terminal/            # Menciones, resolución de conexiones y sesiones
│   │   ├── tools/               # DeviceTools y TerminalTools compartidas
│   │   └── Model.ts             # Creación y configuración de modelos de IA
│   ├── api/
│   │   ├── router/              # Routers por recurso
│   │   └── ServerApi.ts         # Montaje de /api
│   ├── client/                  # Clientes GNS3, Packet Tracer, SSH, Telnet, Serial
│   ├── config/                  # Entorno, proveedores de modelos y rate limit
│   ├── controller/              # Controladores
│   ├── middleware/              # auth, roles y errores
│   ├── prisma/                  # Cliente Prisma generado
│   ├── seed/                    # Datos iniciales
│   ├── service/                 # Lógica de negocio
│   ├── sockets/                 # Socket.IO y TerminalSessionHub
│   ├── utils/                   # JWT, bcrypt, logger, contexto de petición
│   └── app.ts                   # Entry point
├── test/                        # Suites de Vitest + Supertest
├── package.json
├── prisma.config.ts
└── vitest.config.ts
```

## Docker

El repositorio incluye `docker-compose.yml` con una imagen única que compila backend y frontend:

```bash
docker compose up --build
```

- Backend en `http://localhost:7531` (healthcheck contra `/api/health`).
- Frontend en `http://localhost:3090`.
- Datos persistidos en el volumen `packet-tools-data` (`DATABASE_URL=file:/app/data/packet_tools.db`).
- Para equipos físicos por puerto serial, descomenta el mapeo de `devices` en `docker-compose.yml`.

Para más detalle consulta el [README principal](../../README.md).
