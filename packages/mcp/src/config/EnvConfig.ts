/**
 * Configuración del servidor MCP.
 *
 * Todo se lee de `process.env` con un valor por defecto razonable, igual que
 * `packages/server/src/config/EnvConfig.ts`, para que el servidor arranque sin
 * configurar nada y se pueda afinar con variables de entorno.
 *
 * IMPORTANTE (stdio): un servidor MCP sobre stdio usa **stdout exclusivamente
 * para el protocolo JSON-RPC**. Cualquier `console.log` lo corrompe y el cliente
 * deja de entenderse con él. Por eso aquí se expone `MCP_DEBUG`, que manda los
 * logs a **stderr**, y el Logger del proyecto nunca escribe en stdout.
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

/**
 * Carga el `.env` de la raíz del monorepo.
 *
 * Hace walk-up desde `__dirname` porque el MCP se puede lanzar desde cualquier
 * `cwd` (un cliente MCP lo arranca con el directorio que le dé la gana) y porque
 * turbo solo propaga las variables de `turbo.json#globalEnv`.
 *
 * `quiet: true` NO es cosmético: dotenv imprime por STDOUT un banner del tipo
 * "injected env (16) from ...", y stdout es el canal EXCLUSIVO del protocolo
 * JSON-RPC. Sin silenciarlo, la primera línea que lee el cliente no es JSON y la
 * sesión MCP se rompe con un error de parseo en el arranque. Comprobado: el
 * banner aparecía como primera línea de stdout y desaparece con esta opción.
 */
function cargarEnvRaiz(): void {
  const candidatos: string[] = [];
  let actual = __dirname;
  for (let i = 0; i < 8; i++) {
    candidatos.push(path.join(actual, ".env"));
    actual = path.dirname(actual);
  }
  candidatos.push(path.resolve(process.cwd(), ".env"));

  for (const candidato of candidatos) {
    if (!fs.existsSync(candidato)) continue;
    dotenv.config({ path: candidato, override: false, quiet: true });
    return;
  }
}

cargarEnvRaiz();

/**
 * Raíz del paquete `packages/mcp`.
 *
 * POR QUÉ SUBE DOS NIVELES: este módulo vive en `<pkg>/src/config` en desarrollo
 * (con `tsx`) y en `<pkg>/dist/config` una vez compilado, así que en AMBOS casos
 * la raíz del paquete está dos niveles más arriba. Con un solo `..` la raíz caía
 * en `src/` (o `dist/`), y entonces `MCP_SKILLS_DIR` y `MCP_PLANS_DIR` apuntaban
 * a carpetas que no existen.
 *
 * Se comprueba el resultado en vez de darlo por hecho: si el paquete se
 * reestructura (por ejemplo, anidando más el código), la detección por marcador
 * encuentra la raíz real en lugar de fallar en silencio.
 */
function resolverRaizPaquete(): string {
  let actual = path.resolve(__dirname, "..", "..");
  // La raíz del paquete es la carpeta que contiene `package.json`; se sube
  // hasta encontrarla (con un tope, para no recorrer el disco entero si algo
  // va mal).
  for (let i = 0; i < 3; i++) {
    if (fs.existsSync(path.join(actual, "package.json"))) return actual;
    actual = path.dirname(actual);
  }
  return path.resolve(__dirname, "..", "..");
}

export const PACKAGE_ROOT = resolverRaizPaquete();

/** Lee un entero de entorno, con default y mínimo/máximo opcionales. */
function numeroDeEnv(nombre: string, porDefecto: number): number {
  const bruto = Number(process.env[nombre]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : porDefecto;
}

/** Lee un booleano de entorno. Solo `"false"` desactiva (fail-safe: activo). */
function booleanoDeEnv(nombre: string, porDefecto: boolean): boolean {
  const bruto = process.env[nombre];
  if (bruto === undefined || bruto === "") return porDefecto;
  return bruto !== "false";
}

/**
 * Ruta configurable, resuelta respecto a la raíz del paquete cuando es relativa.
 * Así `MCP_SKILLS_DIR=skills` funciona igual desde cualquier `cwd`.
 */
function rutaDeEnv(nombre: string, porDefecto: string): string {
  const bruto = (process.env[nombre] ?? "").trim() || porDefecto;
  return path.isAbsolute(bruto) ? bruto : path.join(PACKAGE_ROOT, bruto);
}

export const envConfig = {
  // ---------------------------------------------------------------------------
  // Bridge de Packet Tracer
  // ---------------------------------------------------------------------------
  /**
   * Puerto del backend Packet Tools.
   *
   * **LEGADO**: desde que el MCP aloja su propio puente
   * (`domains/packetTracer/PacketTracerBridgeServer.ts`), el MCP NO necesita el
   * backend para nada, y este valor ya no se usa para el bridge. Se conserva
   * porque otras piezas del monorepo siguen hablando de él y porque quitar una
   * variable de entorno pública romperá a quien la tenga puesta.
   */
  SERVER_PORT: numeroDeEnv("SERVER_PORT", 7531),

  /**
   * Host donde escucha el bridge de Packet Tracer **del propio MCP**.
   *
   * POR QUÉ 127.0.0.1 Y NO `0.0.0.0`: el puente expone una operación que ejecuta
   * comandos sobre el motor de Packet Tracer, así que exposure en la red solo
   * con la extensión de por medio. Quien necesite alcanza la máquina desde otra
   * (p. ej. Packet Tracer en otro equipo) pone `0.0.0.0` aquí explícitamente y
   * protege el puerto con `PT_EXTENSION_SECRET`.
   */
  MCP_BRIDGE_HOST: (process.env.MCP_BRIDGE_HOST ?? "127.0.0.1").trim() || "127.0.0.1",

  /**
   * Puerto del bridge de Packet Tracer del MCP. Es la URL a la que tiene que
   * conectarse la extensión (`http://127.0.0.1:7532` por defecto).
   *
   * POR QUÉ UN PUERTO PROPIO y no el del backend (7531): compartirlo obligaría al
   * MCP a depender de que el backend esté arrancado, que es justo la atadura que
   * se quería romper. Con puerto propio, cada proceso MCP tiene su puente y dos
   * instancias pueden convivir.
   */
  MCP_BRIDGE_PORT: numeroDeEnv("MCP_BRIDGE_PORT", 7532),

  /**
   * Interruptor del puente. `false` deja el MCP sin escuchar en el puerto: es el
   * interruptor limpio cuando el cliente MCP se usa solo para GNS3/SSH/serie y no
   * hay ningún Packet Tracer al que dar acceso.
   *
   * POR QUÉ fail-safe a `true`: `booleanoDeEnv` solo desactiva con el literal
   * `"false"`, así que una variable mal escrita o vacía no deja al usuario sin
   * Packet Tracer sin haberlo pedido.
   */
  MCP_BRIDGE_ENABLED: booleanoDeEnv("MCP_BRIDGE_ENABLED", true),

  /**
   * Host del backend, usado antes de que el MCP tuviera puente propio.
   *
   * **LEGADO**: ya no interviene en el tráfico de Packet Tracer (eso lo resuelve
   * `MCP_BRIDGE_HOST`). Se mantiene por compatibilidad con configuraciones y
   * documentación antiguas.
   */
  MCP_PACKET_TRACER_HOST: (process.env.MCP_PACKET_TRACER_HOST ?? "localhost").trim(),

  /**
   * Secreto compartido con la extensión. Vacío = la extensión se autentica solo
   * por su identidad (user-agent con "Qt" o `clientType=packet-tracer`), que es el
   * caso por defecto; con valor, además tiene que presentarlo en `auth.secret` o
   * en la cabecera `x-packet-tools-secret`.
   */
  PT_EXTENSION_SECRET: (process.env.PT_EXTENSION_SECRET ?? "").trim(),

  // ---------------------------------------------------------------------------
  // GNS3
  // ---------------------------------------------------------------------------
  /**
   * URL base del API de GNS3 usada cuando no hay ninguna fila en la BD propia.
   * OJO: el default histórico de la librería es `http://localhost:3080/v2`, que
   * colisiona con el puerto del frontend web; se mantiene por compatibilidad y
   * se puede sobrescribir aquí.
   */
  MCP_GNS3_URL: (process.env.MCP_GNS3_URL ?? "").trim(),

  // ---------------------------------------------------------------------------
  // Timeouts y límites
  // ---------------------------------------------------------------------------
  /** Techo de una llamada suelta al bridge de Packet Tracer (respaldo). */
  MCP_TOOL_TIMEOUT_MS: numeroDeEnv("MCP_TOOL_TIMEOUT_MS", 120_000),
  /** Espera máxima de una sesión de terminal (SSH/Telnet/Serial) por comando. */
  MCP_TERMINAL_MAX_MS: numeroDeEnv("MCP_TERMINAL_MAX_MS", 20_000),
  /** Silencio que se considera "salida terminada" al leer una consola. */
  MCP_TERMINAL_IDLE_MS: numeroDeEnv("MCP_TERMINAL_IDLE_MS", 700),
  /** Caracteres máximos devueltos por tool (evita volcar consolas enteras). */
  MCP_MAX_OUTPUT_CHARS: numeroDeEnv("MCP_MAX_OUTPUT_CHARS", 20_000),

  // ---------------------------------------------------------------------------
  // Planes y skills
  // ---------------------------------------------------------------------------
  /** Carpeta de los checklists markdown generados por `@plan`. */
  MCP_PLANS_DIR: rutaDeEnv("MCP_PLANS_DIR", "plans"),
  /** Carpeta de las skills en markdown del usuario. */
  MCP_SKILLS_DIR: rutaDeEnv("MCP_SKILLS_DIR", "skills"),

  // ---------------------------------------------------------------------------
  // Diagnóstico
  // ---------------------------------------------------------------------------
  /** Log de depuración. SIEMPRE por stderr: stdout es del protocolo. */
  MCP_DEBUG: booleanoDeEnv("MCP_DEBUG", false),
  /** Registra las llamadas a tools en stderr (muy útil al depurar un cliente). */
  MCP_TRACE_TOOLS: booleanoDeEnv("MCP_TRACE_TOOLS", false),
} as const;

export type EnvConfig = typeof envConfig;
