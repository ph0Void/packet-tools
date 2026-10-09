# Packet Tools AI - Multi-Agent Network Automation Platfor

![Licencia](https://img.shields.io/badge/licencia-ISC-blue)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020-339933)
![Windows](https://img.shields.io/badge/Windows-instalador-0078D4)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Express](https://img.shields.io/badge/Express-5-000000)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748)

Plataforma full-stack de automatización y gestión de redes que unifica **simuladores** (Cisco Packet Tracer y GNS3), **equipos físicos** (SSH, Telnet y consola serial) y **agentes de IA** para configurar, diagnosticar y documentar infraestructura de red en lenguaje natural.

El proyecto es un monorepo TypeScript con un backend Express que orquesta agentes con Deep Agents, un frontend Next.js con dashboard, terminal web y workspace de topologías, y una extensión nativa que conecta Cisco Packet Tracer con el agente.

También se distribuye como **aplicación de escritorio** con instalador propio: empaqueta backend, frontend y base de datos en un solo programa, sin requerir Node.js ni Docker en el equipo destino. Disponible para Windows (instalador NSIS) y Linux (AppImage / `.deb`); ver [Instalador para Windows](#instalador-para-windows).

- Repositorio: [github.com/ph0Void/packet-tools](https://github.com/ph0Void/packet-tools)
- [Backend (`packages/server`)](./packages/server/README.md)
- [Frontend (`packages/web`)](./packages/web/README.md)
- [MCP (`packages/mcp`)](./packages/mcp/README.md)
- [Extensión de Packet Tracer](./extension-packetracer/README.md)

## Descripción

Packet Tools nace de una idea simple: **un solo lugar para administrar la red, con ayuda de agentes**. Desde el dashboard puedes abrir una consola SSH a un switch real, pedirle al agente que revise y configure la red, levantar una topología en Packet Tracer o GNS3, guardar la topología resultante, programar tareas recurrentes y dejar registro de todo lo que ocurre.

El agente no es un chatbot que solo responde texto: es un **controlador de consola y simulador** con herramientas reales. Se conecta a los dispositivos mediante los mismos protocolos que usaría un ingeniero, clasifica el riesgo de cada comando y, cuando una acción es sensible, pide aprobación humana antes de ejecutarla (Human-in-the-Loop).

## Características principales

### IA agéntica multi-agente

- Orquestación con **Deep Agents**: un nodo supervisor enruta cada petición al agente especialista correcto y permite delegaciones encadenadas con transferencia visible en el chat.
- **Cinco agentes especialistas**: Packet Tracer, GNS3, SSH, Telnet y consola serial, cada uno con sus propias herramientas.
- **Auto-routing**: si el mensaje trae una conexión objetivo (`@dispositivo` o el selector del chat), la petición va directo al agente del protocolo correspondiente; si no, el supervisor decide.
- **Modo autónomo** para `STAFF` y `ADMIN`: ejecuta acciones sin confirmaciones (los comandos destructivos siguen protegidos).

### Múltiples proveedores de IA

- **Proveedores soportados**: OpenAI, Google (Gemini), Anthropic, OpenRouter, Ollama, LM Studio y endpoints personalizados compatibles con la API de OpenAI.
- Modelos de tipo **CHAT** y **EMBEDDING**, con temperatura, `baseUrl`, API key enmascarada, activación individual y permisos por rol (`userPermission`).
- Selector de modelo por conversación y fallback automático para modelos locales que devuelven streams vacíos.
- Prompt global del sistema configurable por el `ADMIN`.

### Terminal web integrada

- Consola **xterm.js** con conexión **SSH** (shell completo vía `ssh2`), **Telnet** y **puerto serial** (RS-232 / USB-Serial) con baudrate configurable.
- El agente **opera la consola activa**: detecta el prompt, espera la salida, respeta los tiempos del equipo y no abre conexiones paralelas.
- Resaltado de salida Cisco, eco local, detección de modo contraseña, reconexión y marcadores de comandos inyectados por la IA.
- Sesiones registradas (`GET /api/terminal/sessions`) y modo **solo lectura** para el rol `USER`.

### Human-in-the-Loop (HITL)

- Cada herramienta tiene una política de riesgo: lectura, configuración, destructiva o de control de sesión.
- Los comandos **destructivos** (`reload`, `write erase`, `erase`, `format`, `delete`, `boot system`) requieren aprobación explícita y nunca se ejecutan sin canal interactivo.
- El agente no puede cerrar la consola del usuario (`exit`, `quit`, `logout`) y los lotes de cierre se bloquean por completo.
- Las aprobaciones expiran (10 minutos), cuentan reintentos y quedan registradas en el historial del chat.

### Simuladores y equipos físicos

- **Cisco Packet Tracer**: extensión propia (Socket.IO) con más de 30 herramientas: crear topologías, añadir dispositivos, módulos y enlaces, configurar IOS, simular PDUs, mover/encender equipos, exportar/importar topologías, etc.
- **GNS3**: cliente REST para crear proyectos, nodos, enlaces, plantillas y control de energía de las máquinas virtuales.
- **Equipos físicos**: fabricantes modelados Cisco, Huawei, Aruba, MikroTik y genéricos, por SSH, Telnet o consola serial.

### Base de conocimiento (RAG) y búsqueda web

- Subida de documentos `.pdf`, `.txt` y `.md` (hasta 25 MB) desde la web, indexados con embeddings del proveedor activo.
- Consulta determinista desde el chat con la mención `@rag` y herramienta `search_knowledge_base` disponible para todos los agentes.
- Búsqueda web integrada sin API key (DuckDuckGo Lite) para datos actuales.

### Workspace de topologías

- Canvas interactivo (React Flow) con nodos por tipo de dispositivo, inspector de interfaces e IPs y estados en vivo.
- **Sincronización con Packet Tracer** (`getNetwork`) para reflejar la topología real del simulador.
- Guardado, actualización y exportación/importación de topologías en la base de datos.

### Automatización y operación

- **Tareas programadas (cron)**: tipo `STANDARD` (registra la carga útil) e `INTELLIGENT` (el agente ejecuta la tarea sobre la topología o el dispositivo asociado) con expresión cron validada y previsualización.
- **Alertas** por severidad (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) ligadas a topologías.
- **Logs de auditoría** de agentes, herramientas y cron, con filtros y borrado solo para `ADMIN`.
- Dashboard con métricas, alertas recientes y accesos rápidos; tema claro/oscuro persistente.

### Seguridad

- Autenticación **JWT en cookie httpOnly**, validada además contra el token almacenado en la base de datos (logout invalida la sesión).
- Roles jerárquicos `USER` < `STAFF` < `ADMIN` aplicados en cada ruta de la API y en los sockets.
- Rate limit en autenticación, validación con `zod`, CORS con credenciales y enmascarado automático de secretos (`password`, `token`, `apiKey`) en las respuestas.

### Chat multimodal

- Hasta 4 adjuntos por mensaje: imágenes (enviadas al modelo como bloques base64) y documentos (PDF/TXT/MD/CSV/JSON extraídos a texto).
- Historial de conversaciones por usuario estilo chat, con tarjetas de herramientas, razonamiento en vivo y segmentos intercalados de texto y ejecución.
- La selección de modelo de IA y de conexión/dispositivo se recuerda por chat (persistida en la base de datos y en caché local).

### Servidor MCP (Model Context Protocol)

- Expone el motor de Packet Tools (Packet Tracer, GNS3, serial, Telnet y SSH) como **herramientas MCP** que cualquier agente de código puede invocar: **Claude Code, Codex CLI, OpenCode, VS Code (GitHub Copilot), LM Studio, Cursor, Windsurf, DeepSeek** y cualquier cliente MCP estándar.
- Se ejecuta directo desde GitHub, sin clonar ni compilar:
  ```json
  {
    "mcp": {
      "packet-tools": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "github:ph0Void/packet-tools",
          "packet-tools-mcp"
        ],
        "enabled": true
      }
    }
  }
  ```
- **95 herramientas en 7 dominios** (`packet_tracer_*`, `gns3_*`, `serial_*`, `telnet_*`, `ssh_*`, `plan_*`, `skills_*`) sobre transporte **stdio**.
- La integración con Packet Tracer necesita la **extensión v1.1.0 o superior**; el resto de dominios funciona sin ella. Detalle y configuración por cliente en [`packages/mcp/README.md`](./packages/mcp/README.md).

## Stack tecnológico

| Capa                  | Tecnología                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Backend               | Node.js, TypeScript, Express 5, `tsx`, Socket.IO                                                         |
| IA                    | LangChain + Deep Agents (`deepagents`), OpenAI, Google, Anthropic, OpenRouter, Ollama, LM Studio, custom |
| Base de datos         | Prisma 7 + SQLite (`better-sqlite3`)                                                                     |
| Frontend              | Next.js 16 (App Router), React 19 + React Compiler, Tailwind CSS v4, shadcn UI, Zustand                  |
| Escritorio            | Electron + electron-builder (instalador NSIS, AppImage, `.deb`)                                          |
| Terminal y topologías | `@xterm/xterm`, React Flow (`@xyflow/react`)                                                             |
| Conectividad          | `ssh2`, Telnet sobre `net`, `serialport`, cliente REST de GNS3                                           |
| Pruebas               | Vitest + Supertest (backend)                                                                             |
| Monorepo              | npm workspaces + Turborepo                                                                               |
| Contenedores          | Docker + Docker Compose                                                                                  |

## Estructura del repositorio

```text
Mono-Packet-Tools/
├── packages/
│   ├── server/                 # Backend: API, agentes, sockets, Prisma (más detalle en packages/server/README.md)
│   ├── web/                    # Frontend: dashboard, chat, terminal, workspace (más detalle en packages/web/README.md)
│   ├── desktop/                # Instalador de escritorio Electron (NSIS, AppImage, deb; ver packages/desktop/README.md)
│   └── mcp/                    # Servidor MCP (Model Context Protocol)
├── extension-packetracer/      # Extensión nativa de Cisco Packet Tracer (JavaScript, cliente Socket.IO)
├── dockerfile                  # Imagen todo-en-uno (backend + frontend)
├── docker-compose.yml          # Despliegue con un comando y volumen para SQLite
├── docker-entrypoint.sh        # Migraciones + seed + arranque de servicios
├── .example.env                # Plantilla de variables de entorno
├── turbo.json                  # Pipeline de Turborepo
└── package.json                # Scripts raíz y workspaces
```

## Requisitos

- **Node.js 20 o superior** (recomendado 22 LTS) y **npm 10+**.
- Copia del archivo `.env` en la raíz (se genera con `npm run init`).
- **Instalador de escritorio** (alternativa sin Node.js): ver [Instalador para Windows](#instalador-para-windows).
- Opcional:
  - **Docker Desktop** para desplegar todo en un contenedor.
  - **Cisco Packet Tracer** con la extensión instalada para usar el agente de simulación.
  - **GNS3** (servidor local en `http://localhost:3080`) para los laboratorios virtuales.
  - Dispositivos físicos accesibles por SSH, Telnet o cable consola.

## Guía de inicio rápido

> ¿Solo quieres usarlo en tu PC? Salta directamente al [instalador para Windows](#instalador-para-windows); no necesitas Node.js ni Docker.

### 1. Clonar e instalar

```bash
git clone https://github.com/ph0Void/packet-tools.git
cd packet-tools
npm run init   # copia .example.env a .env e instala las dependencias
```

> `npm run init` usa `cp`; funciona en Linux, macOS, Git Bash y PowerShell (alias de `Copy-Item`).

### 2. Preparar la base de datos

```bash
npm run migrate    # crea la base SQLite y aplica las migraciones
npm run generate   # genera el cliente de Prisma
npm run seed       # carga datos iniciales (usuario admin, dispositivos y modelos de ejemplo)
```

### 3. Levantar el entorno

```bash
npm run dev        # backend + frontend en paralelo (Turborepo)
```

| Servicio                  | URL                     |
| ------------------------- | ----------------------- |
| Frontend (dashboard)      | `http://localhost:3090` |
| Backend (API + Socket.IO) | `http://localhost:7531` |

Los puertos se definen en el `.env` raíz (`PORT` y `SERVER_PORT`).

### 4. Iniciar sesión

| Usuario | Contraseña | Rol     |
| ------- | ---------- | ------- |
| `admin` | `admin123` | `ADMIN` |

> Advertencia: cambia la contraseña de `admin` y define un `JWT_SECRET` propio antes de exponer el servicio fuera de tu equipo. La clave incluida en `.example.env` es solo de ejemplo.

### 5. Configurar un proveedor de IA

1. Entra al dashboard con `admin`.
2. Ve a **Configuración** (`/dashboard/configuration`).
3. Añade o edita un proveedor de modelos: elige el proveedor, el modelo, la `baseUrl` (para Ollama/LM Studio/custom) y la API key cuando corresponda.
4. Actívalo y ajusta `userPermission` para decidir qué roles pueden usarlo.
5. Para RAG, activa además un proveedor de tipo `EMBEDDING`.

### 6. Conectar la extensión de Packet Tracer (opcional)

1. Copia la carpeta `extension-packetracer/` dentro del directorio `extensions` de tu instalación de Cisco Packet Tracer y reinicia el programa.
2. Con el backend corriendo, abre **Extensions > Packet Tracer API**; se abrirá una ventana que muestra el estado de la conexión.
3. Desde el chat o el workspace de Packet Tools ya puedes pedirle al agente que cree topologías, añada dispositivos y simule tráfico.

## Instalador para Windows

Packet Tools incluye un **instalador de escritorio** (Electron + electron-builder) que empaqueta el backend, el frontend y la base de datos SQLite en una sola aplicación. **No requiere Node.js, Docker ni dependencias adicionales** en el equipo donde se instala: la aplicación trae su propio runtime de Node y arranca todo automáticamente.

1. Descarga `Packet Tools Setup <versión>.exe` desde la sección [Releases](https://github.com/ph0Void/packet-tools/releases).
2. Ejecuta el instalador (permite elegir la carpeta de instalación y crea accesos directos).
3. Abre **Packet Tools**: la aplicación levanta el backend y el frontend, y abre su propia ventana. El primer arranque aplica las migraciones, ejecuta el seed y crea el usuario `admin` / `admin123`.

| Detalle               | Valor                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Requisitos            | Windows 10/11 (x64); puertos `7531` y `3090` libres                                                  |
| Datos y configuración | `%APPDATA%\Packet Tools` (base de datos, `uploads/`, `logs/` y secreto JWT generado automáticamente) |
| Servicios             | Backend en `http://localhost:7531` y frontend en `http://localhost:3090`                             |
| Otras plataformas     | El mismo pipeline genera `AppImage` y `.deb` para Linux                                              |

Para generar el instalador desde el código fuente:

```bash
npm run build-desktop -- --win     # instalador NSIS (.exe) — se compila en Windows
npm run build-desktop -- --linux   # AppImage / .deb — se compila en Linux
```

Los artefactos quedan en `packages/desktop/dist/`. El proceso descarga Electron, el runtime de Node y las herramientas de empaquetado (requiere conexión a internet) y no necesita Visual Studio Build Tools. Detalles técnicos del empaquetado en [`packages/desktop/AGENTS.md`](./packages/desktop/AGENTS.md).

## Docker

El repositorio incluye una imagen **todo-en-uno** que ejecuta backend y frontend en el mismo contenedor (es la configuración más simple, porque `NEXT_PUBLIC_API_URL` apunta a `http://localhost:7531`, válido tanto desde tu navegador como dentro del contenedor).

```bash
cp .example.env .env     # si aún no existe
docker compose up --build
```

| Recurso  | Detalle                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Frontend | `http://localhost:3090`                                                                               |
| Backend  | `http://localhost:7531`                                                                               |
| Datos    | Volumen `packet-tools-data` montado en `/app/data` (`DATABASE_URL=file:/app/data/packet_tools.db`)    |
| Arranque | El entrypoint aplica migraciones (`prisma migrate deploy`), ejecuta el seed y levanta ambos servicios |
| Salud    | Healthcheck contra `GET /api/health`                                                                  |

Notas:

- Al arrancar, el contenedor crea el usuario `admin` / `admin123`. Cámbialo después del primer acceso.
- Los valores del `.env` raíz se pasan al contenedor (`env_file`); `NEXT_PUBLIC_API_URL` también se usa como argumento de build, así que si despliegas en un servidor remoto edítalo antes de construir (por ejemplo `NEXT_PUBLIC_API_URL=http://mi-servidor:7531`).
- Para equipos físicos por **puerto serial**, descomenta el mapeo `devices` en `docker-compose.yml` (`/dev/ttyUSB0:/dev/ttyUSB0`).
- Construcción manual sin Compose:

```bash
docker build -f dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:7531 -t packet-tools .
docker run -p 7531:7531 -p 3090:3090 -v packet-tools-data:/app/data --env-file .env packet-tools
```

## Variables de entorno

Todas viven en el `.env` de la raíz del monorepo. Plantilla: [`.example.env`](./.example.env).

> El `.env`, la base de datos SQLite (`packages/server/.packet_tool_database.db`) y los archivos subidos (`packages/server/uploads/`) están gitignoreados y nunca se publican en el repositorio.

| Variable                   | Descripción                                                                | Valor por defecto               |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `NAME`                     | Nombre del proyecto                                                        | `Packet Tools`                  |
| `VERSION`                  | Versión visible                                                            | `1.2.0`                         |
| `SERVER_PORT`              | Puerto del backend                                                         | `7531`                          |
| `PORT`                     | Puerto del frontend                                                        | `3090`                          |
| `NODE_ENV`                 | Entorno (`development` / `production` / `test`)                            | `development`                   |
| `DATABASE_URL`             | Ruta del archivo SQLite (relativa a `packages/server`)                     | `file:.packet_tool_database.db` |
| `JWT_SECRET`               | Clave de firma de los JWT                                                  | cadena aleatoria larga          |
| `JWT_EXPIRATION`           | Vigencia del token en segundos o string (`30d`)                            | `36000`                         |
| `RATE_LIMIT_REFRESH`       | Ventana del rate limit en ms                                               | `900000`                        |
| `RATE_LIMIT_REQUESTS`      | Peticiones por ventana                                                     | `100`                           |
| `NEXT_PUBLIC_API_URL`      | URL base del backend                                                       | `http://localhost:7531`         |
| `NEXT_PUBLIC_PROYECT_NAME` | Nombre mostrado en el frontend                                             | `Packet Tools AI`               |
| `DESKTOP_OBFUSCATE`        | Compila backend y frontend a bytecode V8 antes de empaquetar el instalador | `true`                          |
| `NEXT_PUBLIC_COOKIE_NAME`  | Nombre de la cookie de sesión                                              | `packet-tools-cookie`           |

## Scripts disponibles

Desde la raíz del monorepo:

| Script                                                                                         | Descripción                                                                            |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run init`                                                                                 | Copia `.example.env` a `.env` e instala dependencias                                   |
| `npm run dev`                                                                                  | Levanta backend y frontend en paralelo                                                 |
| `npm run build`                                                                                | Compila backend, frontend y servidor MCP                                               |
| `npm run build:mcp`                                                                            | Compila sólo el servidor MCP (`packages/mcp`)                                          |
| `npm run build-desktop`                                                                        | Genera el instalador de escritorio (Electron); acepta `-- --win` / `-- --linux`        |
| `npm run lint`                                                                                 | ESLint del frontend                                                                    |
| `npm run migrate`                                                                              | Crea y aplica migraciones (desarrollo)                                                 |
| `npm run generate`                                                                             | Regenera el cliente de Prisma                                                          |
| `npm run reset`                                                                                | Recrea la base de datos (destructivo)                                                  |
| `npm run seed`                                                                                 | Carga los datos iniciales                                                              |
| `npm run studio`                                                                               | Abre Prisma Studio                                                                     |
| `npm test`                                                                                     | Ejecuta la suite de pruebas del backend (84 suites)                                    |
| `npm run test-pt` / `test-terminal` / `test-telnet` / `test-ssh` / `test-serial` / `test-gns3` | Suites en vivo contra transportes reales (requieren hardware o simuladores conectados) |

Pruebas:

```bash
npm test                        # toda la suite
npm test -- test/auth.test.ts   # una suite concreta
npm test -- --watch             # modo watch
```

## Roles y permisos

| Rol     | Alcance                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER`  | Lectura de recursos, chats propios, alertas propias, terminal en modo solo lectura y uso de los modelos habilitados por el `ADMIN`           |
| `STAFF` | Todo lo anterior más CRUD de dispositivos, topologías, alertas, tareas programadas y base de conocimiento; aprobaciones HITL y modo autónomo |
| `ADMIN` | Gestión completa: usuarios, proveedores de IA, configuración global, borrado de logs y todas las operaciones anteriores                      |

## Próximos cambios

- **Plantillas de configuración por fabricante**: el modelo `ConfigTemplate` ya está en la base de datos; falta el CRUD, la UI y la ejecución de plantillas con variables (`hostname`, `ip`, etc.) desde el chat y las tareas programadas.
- **Delegación multi-agente más profunda**: evolucionar de "una directiva → un especialista" a "una directiva → múltiples agentes → delegación → ejecución → verificación → resultado", con síntesis final del supervisor.
- **Más dispositivos y protocolos**: ampliar la cobertura para los fabricantes ya modelados (Huawei, Aruba, MikroTik).
- **Listener syslog para GNS3**: capturar los logs de los dispositivos virtualizados (la API REST de GNS3 no los expone; requeriría un receptor UDP en el backend).
- **Documentación de la extensión**: guía de instalación paso a paso y capturas de pantalla del flujo completo.
- **Cobertura de pruebas**: sumar pruebas de integración del frontend y de los flujos de terminal y topologías.

## Contribución

Las contribuciones son bienvenidas. Si encuentras un error o quieres proponer una mejora, abre un [issue](https://github.com/ph0Void/packet-tools/issues) o envía un pull request describiendo el cambio.

## Licencia

MIT. Consulta `package.json` para más detalle.

## Autor

Desarrollado por [ph0Void](https://github.com/ph0Void).
