/**
 * Bridge Socket.IO **propio** del servidor MCP hacia la extensión de Packet Tracer.
 *
 * POR QUÉ EXISTE (y por qué no se reutiliza el del backend)
 * -------------------------------------------------------
 * Antes, el MCP no tenía puente: `PacketTracerBridge.ts` era un cliente
 * `socket.io-client` que se dializaba al `http://localhost:7531` del backend
 * (`SERVER_PORT`), porque el único puente era
 * `packages/server/src/sockets/simulation.socket.ts` y por eso la extensión de
 * Packet Tracer se conectaba al BACKEND. Eso ataba el MCP al backend: sin él
 * arrancado no había ni Packet Tracer ni herramientas de ese dominio.
 *
 * Ahora el MCP aloja su propio puente en un puerto dedicado (`MCP_BRIDGE_PORT`,
 * 7532 por defecto) y la extensión se conecta AL MCP. Consecuencias:
 *  - `callTool` ya no necesita socket: la petición y la respuesta se resuelven en
 *    el mismo proceso, contra un registro de promesas (ver `solicitarTool`).
 *  - El MCP es autónomo: GNS3, serie, SSH, telnet, planes y skills nunca
 *    dependieron del backend, y ahora Packet Tracer tampoco.
 *  - Sigue siendo un puente (y no una llamada directa a la extensión) porque la
 *    extensión es la única que tiene el motor de Packet Tracer delante; el MCP
 *    solo retransmite peticiones y respuestas.
 *
 * COPIA DEL CONTABILIDAD DE `simulation.socket.ts` (a propósito)
 * ---------------------------------------------------------------
 * `LlamadaPendiente`, `VIGENCIA_LLAMADA_MS`, `MAX_LLAMADAS_PENDIENTES`,
 * `podarLlamadas`, `registrarLlamada`, `tomarLlamada`, `olvidarLlamadasDe` y
 * `esExtensionDePacketTracer` están copiados del backend porque los dos paquetes
 * NO comparten código (ni deben: el MCP compila a CommonJS con sus propios alias
 * `@/` y arrastrar el server entero detrás de un import sería el problema que
 * esto resuelve). Si algún día se extrae un paquete compartido, esta es la lista
 * exacta de lo que habría que mover.
 *
 * REGLAS DE ORO DE ESTE MÓDULO
 * ----------------------------
 * 1. **NADA se escribe en stdout.** Este proceso es un servidor MCP sobre stdio:
 *    stdout es el canal EXCLUSIVO del protocolo JSON-RPC y un `console.log`
 *    suelto rompe la sesión entera. Todo el logging pasa por `Logger`, que escribe
 *    en stderr (`utils/Logger.ts`).
 * 2. **Nada tira el proceso.** Un `EADDRINUSE` o cualquier fallo al escuchar
 *    deja el puente inactivo y lo reporta por stderr: si el proceso MCP muriera
 *    aquí, el cliente stdio se quedaría colgado sin servidor, sin herramientas y
 *    sin ninguna pista de qué pasó. Es preferible un MCP vivo al que le fallan
 *    las tools de packetTracer con un mensaje accionable.
 * 3. **`iniciarBridge()` es idempotente**: llamarlo dos veces no rompe nada (el
 *    arranque del MCP y una prueba pueden coincidir).
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import { errorNoDisponible } from "@/core/errors";

/** Evento con el que se le pide una herramienta a la extensión. */
export interface LlamadaTool {
  tool_call_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/** Evento con el que la extensión responde. */
export interface ResultadoTool {
  tool_call_id: string;
  result?: unknown;
}

/**
 * Vigencia de una llamada registrada.
 *
 * Es del orden del timeout más largo de la tabla de `PacketTracerBridge`
 * (120 s) con holgura, porque la extensión puede entregar un resultado que
 * encoló tras un corte de conexión (ella encola hasta `RESULTADOS_PENDIENTES_MS
 * = 300000`, ver `extension/interface/interface.js`). Pasado ese plazo el
 * resultado se descarta igual: quien pidió la llamada ya habría rechazado por
 * timeout y resolver su promesa tarde solo daría un estado falso.
 */
const VIGENCIA_LLAMADA_MS = 300_000;

/**
 * Tope de llamadas registradas. Nadie espera cientos simultáneas, así que un
 * tope alto es gratis y evita que la extensión emita `tool_result` de operaciones
 * que nadie pidió y haga crecer el registro sin límite.
 */
const MAX_LLAMADAS_PENDIENTES = 512;

/** Alguien esperando el resultado de una llamada, con su temporizador. */
interface EsperaLlamada {
  /** La promise en sí, para que varios esperadores compartan la misma espera. */
  promesa: Promise<unknown>;
  resolver: (valor: unknown) => void;
  rechazar: (error: unknown) => void;
  temporizador: NodeJS.Timeout;
}

/**
 * Tool-call en vuelo: qué extensión se esperaba que la respondiera y hasta
 * cuándo puede hacerlo.
 *
 * El `tool_call_id` es lo único que ata un resultado con su petición, así que
 * hace falta saber QUIÉN tenía que responderla. Aquí no hay relé entre sockets
 * (el solicitante es el propio MCP), pero el destino importa igual: cuando esa
 * extensión se desconecta, sus llamadas no tienen a quién volver y se resuelven
 * con un error accionable en vez de quedar colgadas.
 */
interface LlamadaPendiente {
  /** `socket.id` de la extensión registrada cuando se lanzó la llamada. */
  socketOrigen: string;
  /** Instante (ms) a partir del cual la respuesta ya no se acepta. */
  expiraEn: number;
  /** Promise viva esperando el resultado; null si todavía nadie espera. */
  espera: EsperaLlamada | null;
  /**
   * Resultado que llegó antes de que nadie esperara (buffer de un solo uso).
   * Existe para que un `tool_result` muy temprano no se pierda por un detalle de
   * orden: se guarda y se entrega en cuanto se engancha la espera.
   */
  resultadoListo: { valor: unknown } | null;
}

/** Estado del puente, tal como lo consume `packet_tracer_connection_status`. */
export interface EstadoBridge {
  /** true solo si hay un servidor Socket.IO escuchando de verdad. */
  activo: boolean;
  /** URL a la que tiene que conectarse la extensión. */
  url: string;
  /** true si hay una extensión de Packet Tracer conectada y viva. */
  extensionConectada: boolean;
  /** `socket.id` de la extensión registrada, o null si no hay. */
  socketExtension: string | null;
  /** Llamas en vuelo pendientes de respuesta. */
  peticionesPendientes: number;
}

/** Opcionales del arranque. Solo los usan las pruebas (puerto efímero). */
export interface OpcionesArranque {
  /** Puerto a escuchar; `0` pide uno efímero al sistema operativo. */
  puerto?: number;
  /** Host a escuchar (por defecto `MCP_BRIDGE_HOST`). */
  host?: string;
}

// ---------------------------------------------------------------------------
// Estado del módulo
// ---------------------------------------------------------------------------

/**
 * Estado global del puente.
 *
 * Es un módulo con estado y no una clase instanciada porque el puente es un
 * recurso ÚNICO del proceso: lo usan `McpServer` (arranque y cierre),
 * `PacketTracerBridge` (las tools) y el dominio para informar del estado. Igual
 * que `simulationBridge` en el backend, solo hay un socket de extensión: abrir
 * más conexiones no daría acceso a más equipos, solo duplicaría reconexiones.
 */
let io: Server | null = null;
let httpServer: HttpServer | null = null;
/** Puerto realmente escuchando; puede diferir del configurado si se pidió el 0. */
let puertoEfectivo: number | null = null;
/** Socket de la extensión registrada (una sola: la primera que se presenta). */
let extensionSocket: Socket | null = null;
/** `tool_call_id` → llamada pendiente: el índice de entrega y de descarte. */
const llamadasPendientes = new Map<string, LlamadaPendiente>();

/** URL del puente, con el puerto REAL (importa cuando se pidió uno efímero). */
function urlBridge(): string {
  return `http://${envConfig.MCP_BRIDGE_HOST}:${puertoEfectivo ?? envConfig.MCP_BRIDGE_PORT}`;
}

/**
 * Error accionable para cuando la extensión no está conectada.
 *
 * Falla RÁPIDO a propósito: esperar al timeout de la herramienta (hasta 120 s)
 * para descubrir que no hay nadie escuchando desperdicia el turno del modelo, y
 * además el mensaje de timeout advierte de "no repetir a ciegas", lo que aquí solo
 * serviría para perder tiempo.
 */
function errorExtensionAusente(): Error {
  return errorNoDisponible(
    `La extensión de Packet Tracer no está conectada al bridge del servidor MCP (${urlBridge()}).`,
    "Abre Packet Tracer con la extensión cargada y comprueba el estado con packet_tracer_connection_status. " +
      "Si la extensión se conecta a otra URL, ajusta MCP_BRIDGE_HOST y MCP_BRIDGE_PORT en el servidor MCP y " +
      "reinícialo. NO hace falta que el backend de Packet Tools esté arrancado: el puente vive en el MCP.",
  );
}

/** Error accionable para cuando el puente no llegó a escuchar. */
function errorBridgeInactivo(): Error {
  return errorNoDisponible(
    `El bridge de Packet Tracer del servidor MCP no está escuchando en ${urlBridge()}.`,
    "Comprueba que MCP_BRIDGE_ENABLED no sea false y que el puerto esté libre (si hay otra instancia del MCP o " +
      "el backend de Packet Tools ocupando el puerto, cambia MCP_BRIDGE_PORT y reinicia el servidor MCP). " +
      "El resto de dominios del MCP (GNS3, serie, SSH, telnet, planes y skills) siguen funcionando.",
  );
}

// ---------------------------------------------------------------------------
// Clasificación y autenticación (réplica de `socket.auth.ts`)
// ---------------------------------------------------------------------------

/**
 * Detecta a la extensión del simulador: declara `clientType` o su webview Qt lo
 * delata en el user-agent. Copiado de `socket.auth.ts:5-9` a propósito.
 */
function esClienteSimulador(socket: Socket): boolean {
  const clientType = String((socket.handshake?.query as { clientType?: unknown })?.clientType ?? "");
  const userAgent = String(socket.handshake?.headers?.["user-agent"] ?? "");
  return clientType === "packet-tracer" || userAgent.includes("Qt");
}

/** Secreto compartido vigente (opcional: vacío = solo se exige la identidad). */
function secretoVigente(): string {
  return envConfig.PT_EXTENSION_SECRET;
}

/** Extrae el secreto presentado por el cliente (`auth` o cabecera). */
function secretoPresentado(socket: Socket): string {
  const fromAuth = socket.handshake?.auth?.secret;
  const fromHeader = socket.handshake?.headers?.["x-packet-tools-secret"];
  return (
    (typeof fromAuth === "string" ? fromAuth : "") ||
    (typeof fromHeader === "string" ? fromHeader : "")
  );
}

/**
 * Middleware de autenticación.
 *
 * Réplica de la decisión de `socket.auth.ts`: la extensión va exenta de JWT a
 * propósito (no tiene sesión de la web) y, si `PT_EXTENSION_SECRET` está
 * informado, tiene que presentarlo en `auth.secret` o en la cabecera
 * `x-packet-tools-secret`. Cualquier OTRO cliente se rechaza: aquí no hay
 * navegador ni `backend-agent`, solo la extensión.
 */
function autenticar(socket: Socket, next: (error?: Error) => void): void {
  if (!esClienteSimulador(socket)) {
    Logger.warning(
      `[BRIDGE_MCP] Conexión rechazada: el puente solo acepta la extensión de Packet Tracer [ID: ${socket.id}]`,
      {
        clientType: (socket.handshake?.query as { clientType?: unknown })?.clientType,
        userAgent: socket.handshake?.headers?.["user-agent"],
      },
    );
    next(new Error("El bridge MCP solo acepta la extensión de Packet Tracer"));
    return;
  }

  const secreto = secretoVigente();
  if (secreto && secretoPresentado(socket) !== secreto) {
    Logger.warning(`[BRIDGE_MCP] Secreto de extensión inválido; se rechaza [ID: ${socket.id}]`);
    next(new Error("Secreto de extensión inválido"));
    return;
  }

  next();
}

/** true si este socket es la extensión de Packet Tracer registrada en el puente. */
function esExtensionDePacketTracer(socket: Socket): boolean {
  return extensionSocket !== null && extensionSocket.id === socket.id;
}

// ---------------------------------------------------------------------------
// Contabilidad de llamadas en vuelo
// ---------------------------------------------------------------------------

/** Entrega el valor de una llamada, o lo guarda si todavía nadie espera. */
function entregar(llamada: LlamadaPendiente, valor: unknown): void {
  if (llamada.espera) {
    clearTimeout(llamada.espera.temporizador);
    llamada.espera.resolver(valor);
    llamada.espera = null;
    return;
  }
  llamada.resultadoListo = { valor };
}

/** Corta una espera viva con un error, sin dejar temporizadores colgados. */
function cortar(llamada: LlamadaPendiente, error: Error): void {
  if (!llamada.espera) return;
  clearTimeout(llamada.espera.temporizador);
  llamada.espera.rechazar(error);
  llamada.espera = null;
}

/** Error de una llamada que se pasó de plazo. */
function errorCaducada(toolCallId: string): Error {
  return errorNoDisponible(
    `La llamada '${toolCallId}' caducó antes de que la extensión respondiera (${Math.round(
      VIGENCIA_LLAMADA_MS / 1000,
    )} s).`,
    "El comando pudo haberse aplicado igualmente en Packet Tracer: comprueba el estado con una lectura antes de repetirlo.",
  );
}

/**
 * Poda las entradas caducadas y, si aún así no cabe, las más antiguas.
 * `Map` conserva el orden de inserción, así que la primera clave es la más vieja.
 *
 * A diferencia del backend, una entrada podada RECHAZA su espera: aquí no hay un
 * cliente remoto que se quede esperando, sino una promesa nuestra. Sin este
 * `cortar`, una promesa olvidada quedaría colgada.
 */
function podarLlamadas(ahora: number): void {
  for (const [id, llamada] of llamadasPendientes) {
    if (llamada.expiraEn > ahora) continue;
    cortar(llamada, errorCaducada(id));
    llamadasPendientes.delete(id);
  }
  while (llamadasPendientes.size >= MAX_LLAMADAS_PENDIENTES) {
    const masAntigua = [...llamadasPendientes.keys()][0];
    if (masAntigua === undefined) break;
    const llamada = llamadasPendientes.get(masAntigua);
    if (llamada) {
      cortar(
        llamada,
        errorNoDisponible(
          `La llamada '${masAntigua}' se descartó por superar el máximo de ${MAX_LLAMADAS_PENDIENTES} llamadas en vuelo.`,
          "Reduce el número de operaciones concurrentes de Packet Tracer (espera a que terminen las anteriores) y vuelve a intentarlo.",
        ),
      );
    }
    llamadasPendientes.delete(masAntigua);
  }
}

/**
 * Registra una llamada en vuelo. Devuelve false si el `tool_call_id` ya está
 * pendiente: reutilizar un id vivo dejaría que otro resultado decidiera a qué
 * promesa se entrega, así que se descarta en lugar de pisar la entrada.
 */
function registrarLlamada(toolCallId: string, socketOrigen: string): boolean {
  const ahora = Date.now();
  podarLlamadas(ahora);
  if (llamadasPendientes.has(toolCallId)) return false;
  llamadasPendientes.set(toolCallId, {
    socketOrigen,
    expiraEn: ahora + VIGENCIA_LLAMADA_MS,
    espera: null,
    resultadoListo: null,
  });
  return true;
}

/**
 * Consume la llamada pendiente: una respuesta por llamada, así que un reintento o
 * una entrega encolada por la extensión dos veces se ignoran (no resuelven una
 * promesa ya resuelta). Una llamada caducada también se consume y se devuelve
 * `null`, para que no pueda volver a entregarse.
 */
function tomarLlamada(toolCallId: string): LlamadaPendiente | null {
  const llamada = llamadasPendientes.get(toolCallId);
  if (!llamada) return null;
  llamadasPendientes.delete(toolCallId);
  return llamada.expiraEn <= Date.now() ? null : llamada;
}

/**
 * Olvida las llamadas esperando a una extensión que se va: su respuesta ya no
 * tiene destino, así que sus promesas se cortan con un error accionable. Sin
 * esto, un `callTool` en vuelo se quedaría colgado hasta su timeout (hasta
 * 120 s) sin decir por qué.
 */
function olvidarLlamadasDe(socketId: string, motivo: string): void {
  for (const [id, llamada] of llamadasPendientes) {
    if (llamada.socketOrigen !== socketId) continue;
    cortar(
      llamada,
      errorNoDisponible(
        `La extensión de Packet Tracer se desconectó con la llamada '${id}' en vuelo (${motivo}).`,
        "Reabre Packet Tracer con la extensión cargada y comprueba con packet_tracer_connection_status. " +
          "El comando pudo haberse aplicado igualmente: verifica con una lectura antes de repetirlo.",
      ),
    );
    llamadasPendientes.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Ciclo de vida del servidor
// ---------------------------------------------------------------------------

/**
 * Arranca el puente Socket.IO. Idempotente.
 *
 * NO propaga fallos: si el puerto está ocupado o el host no existe, deja el
 * puente inactivo, lo dice por stderr y sigue. El proceso MCP debe sobrevivir
 * SIEMPRE (es el servidor stdio que el cliente ya tiene abierto); lo que falla
 * son las tools de packetTracer, y eso se explica con `errorBridgeInactivo()`
 * cuando el modelo intente usarlas.
 *
 * `opciones` existe para las pruebas: piden puerto 0 (efímero) para no chocar con
 * una instancia real ni depender de que un puerto concreto esté libre.
 */
export async function iniciarBridge(opciones: OpcionesArranque = {}): Promise<void> {
  if (io) {
    Logger.debug(`[BRIDGE_MCP] iniciarBridge() ignorado: ya hay un puente escuchando en ${urlBridge()}.`);
    return;
  }

  if (!envConfig.MCP_BRIDGE_ENABLED) {
    Logger.warning(
      "[BRIDGE_MCP] MCP_BRIDGE_ENABLED=false: el puente no se arranca y las herramientas de Packet Tracer fallarán.",
      { urlEsperada: urlBridge() },
    );
    return;
  }

  const puerto = opciones.puerto ?? envConfig.MCP_BRIDGE_PORT;
  const host = opciones.host ?? envConfig.MCP_BRIDGE_HOST;

  // `cors: { origin: true }` se mantiene aunque los clientes usen
  // `transports: ["websocket"]`: el fallback a polling de Socket.IO lo necesita, y
  // sin expresarlo la reconexión de la extensión falla en cuanto el cliente
  // degrada a long-polling.
  const http = createServer();
  const servidor = new Server(http, { cors: { origin: true } });

  try {
    await new Promise<void>((resolver, rechazar) => {
      const alError = (error: Error): void => {
        http.off("listening", alListo);
        rechazar(error);
      };
      const alListo = (): void => {
        http.off("error", alError);
        resolver();
      };
      http.once("error", alError);
      http.once("listening", alListo);
      http.listen(puerto, host);
    });
  } catch (error) {
    // Camino esperado: EADDRINUSE porque hay otro MCP (o el backend) en el puerto.
    // Se cierra lo creado a medias y se devuelve el control sin tumbar el proceso.
    const codigo = (error as NodeJS.ErrnoException)?.code;
    Logger.error(
      `No se pudo arrancar el bridge de Packet Tracer en http://${host}:${puerto}: ` +
        (codigo === "EADDRINUSE"
          ? "el puerto ya está ocupado (EADDRINUSE). Puede ser otra instancia del servidor MCP o el backend de Packet Tools."
          : String((error as Error)?.message ?? error)) +
        " El servidor MCP sigue funcionando; las herramientas packet_tracer_* fallarán con este motivo.",
      { host, puerto, code: codigo },
    );
    servidor.close();
    http.close();
    return;
  }

  // Puerto real, por si se pidió uno efímero (pruebas) o un 0 explícito.
  const direccion = http.address() as AddressInfo | string | null;
  puertoEfectivo = direccion && typeof direccion === "object" ? direccion.port : puerto;

  io = servidor;
  httpServer = http;
  servidor.use((socket, next) => autenticar(socket, next));
  servidor.on("connection", registrarConexion);

  Logger.info(`Bridge de Packet Tracer escuchando en ${urlBridge()} (la extensión se conecta aquí).`);
}

/**
 * Registra la lógica de `connection`: clasifica el socket, adjunta la extensión
 * al puente y aplica la entrega exclusiva de resultados.
 */
function registrarConexion(socket: Socket): void {
  const esSimulador = esClienteSimulador(socket);
  Logger.info(
    `[BRIDGE_MCP] Nueva conexión ${esSimulador ? "EXTENSION PACKET TRACER" : "cliente"} [ID: ${socket.id}]`,
    {
      clientType: (socket.handshake?.query as { clientType?: unknown })?.clientType,
      userAgent: socket.handshake?.headers?.["user-agent"],
    },
  );

  if (esSimulador) adjuntarExtension(socket);

  // Un `tool_call` desde un socket no tiene sentido aquí: el MCP lanza sus llamadas
  // directamente contra la extensión (`solicitarTool`), no hace de relé para
  // terceros. Se registra para que quede traza si alguien intenta usarlo como
  // puente de paso.
  socket.on("tool_call", (data: LlamadaTool) => {
    Logger.warning(
      `[BRIDGE_MCP] tool_call desde un socket conectado; el MCP entrega sus llamadas directamente a la extensión, así que se descarta [ID: ${socket.id}]`,
      { toolName: data?.tool_name },
    );
  });

  socket.on("tool_result", (data: ResultadoTool) => {
    const toolCallId = typeof data?.tool_call_id === "string" ? data.tool_call_id : "";
    if (!toolCallId) {
      Logger.warning(`[BRIDGE_MCP] tool_result sin tool_call_id; se descarta [ID: ${socket.id}]`);
      return;
    }

    // 1) AUTENTICIDAD DE ORIGEN: la extensión registrada es la única que ejecuta
    //    llamadas del puente, así que la única que puede responderlas. Va exenta de
    //    JWT a propósito, de modo que aquí no hay token que comprobar y el papel se
    //    valida en el puente: una segunda extensión puede conectarse, pero su
    //    resultado se ignora.
    if (!esExtensionDePacketTracer(socket)) {
      Logger.warning(
        `[BRIDGE_MCP] tool_result desde un socket que no es la extensión registrada; se ignora [ID: ${socket.id}]`,
        { toolCallId },
      );
      return;
    }

    // 2) Solo se acepta la respuesta de una llamada viva: huérfana (nadie la pidió),
    //    ya respondida o caducada. Un `tool_result` huérfano es un síntoma raro,
    //    así que se registra en vez de descartarlo en silencio.
    const llamada = tomarLlamada(toolCallId);
    if (!llamada) {
      Logger.info("[BRIDGE_MCP] tool_result huérfano, repetido o caducado; se descarta", {
        toolCallId,
      });
      return;
    }

    // 3) ENTREGA EXCLUSIVA a la promesa del solicitante (nunca `io.emit`): el resto
    //    de sockets no tienen nada que ver con este resultado y emitirlo por el
    //    servidor filtraría datos entre clientes.
    entregar(llamada, data.result);
  });

  socket.on("disconnect", (motivo: string) => {
    Logger.info(`[BRIDGE_MCP] Desconexión [ID: ${socket.id}] (${motivo})`);
    if (extensionSocket?.id === socket.id) {
      extensionSocket = null;
      olvidarLlamadasDe(socket.id, motivo || "desconexión");
    }
  });
}

/**
 * Adjunta la extensión al puente.
 *
 * Primera gana: si ya hay una extensión viva, la nueva se conecta pero NO
 * sustituye a la anterior (como en `SimulationBridge`, solo hay un puente). La
 * anterior sigue siendo la dueña de las llamadas ya registradas, que es lo que
 * evita que una reconexión de Packet Tracer robe respuestas en vuelo. Cuando la
 * vieja se vaya, su `disconnect` la libera y la nueva ocupa el sitio en la
 * siguiente conexión.
 */
function adjuntarExtension(socket: Socket): void {
  if (extensionSocket && extensionSocket.connected) {
    Logger.warning(
      `[BRIDGE_MCP] Ya hay una extensión registrada (${extensionSocket.id}); esta conexión (${socket.id}) queda como cliente y sus tool_result se ignorarán.`,
    );
    return;
  }
  extensionSocket = socket;
  Logger.info(`[BRIDGE_MCP] Extensión de Packet Tracer registrada [ID: ${socket.id}] en ${urlBridge()}.`);
}

/**
 * Detiene el puente y corta todo lo que estuviera en vuelo. Idempotente.
 *
 * Se llama desde el cierre del servidor MCP (SIGINT/SIGTERM/stdin cerrado): dejar
 * el puerto ocupado tras cerrar el proceso provocaría un `EADDRINUSE` engañoso
 * en el siguiente arranque.
 */
export async function detenerBridge(): Promise<void> {
  const servidor = io;
  io = null;
  httpServer = null;
  puertoEfectivo = null;
  extensionSocket = null;

  if (!servidor) return;

  for (const [id, llamada] of llamadasPendientes) {
    cortar(
      llamada,
      errorNoDisponible(
        `El servidor MCP se cerró con la llamada '${id}' en vuelo.`,
        "Reinicia el servidor MCP: se cerró mientras esperaba respuesta de Packet Tracer. El comando pudo haberse aplicado igualmente.",
      ),
    );
    llamadasPendientes.delete(id);
  }

  await new Promise<void>((resolver) => {
    servidor.close(() => resolver());
  });
  Logger.info("[BRIDGE_MCP] Puente de Packet Tracer detenido.");
}

/** Estado del puente, para el tool `packet_tracer_connection_status`. */
export function estadoBridge(): EstadoBridge {
  return {
    // Se mira también que el servidor HTTP esté escuchando de verdad: `io` no es
    // null hasta que `listen` resuelve, y null si el arranque falló (puerto
    // ocupado). Un `listening` false con `io` puesto solo ocurre si alguien cerró
    // el puerto por debajo, y entonces el puente NO está operativo.
    activo: io !== null && httpServer?.listening === true,
    url: urlBridge(),
    extensionConectada: extensionSocket !== null && extensionSocket.connected,
    socketExtension: extensionSocket?.id ?? null,
    peticionesPendientes: llamadasPendientes.size,
  };
}

/** Socket de la extensión registrada, o null si no hay ninguno vivo. */
export function getExtensionSocket(): Socket | null {
  return extensionSocket && extensionSocket.connected ? extensionSocket : null;
}

// ---------------------------------------------------------------------------
// Camino en proceso: pedir y esperar
// ---------------------------------------------------------------------------

/**
 * Pide una herramienta a la extensión de Packet Tracer y devuelve su id.
 *
 * POR QUÉ DEVUELVE EL ID Y NO LA PROMESA: el id es el contrato del protocolo
 * (`tool_call` / `tool_result`) y la promise se engancha aparte con
 * `esperarResultado`. Así el registro de llamadas en vuelo es el MISMO para
 * cualquier solicitante y las dos piezas (emitir y esperar) se pueden usar por
 * separado, que es justo lo que necesitan las pruebas.
 *
 * Falla rápido si no hay quién ejecute la llamada (puente inactivo o extensión no
 * conectada): es preferible un error accionable en el segundo 0 a un timeout de
 * dos minutos.
 */
export function solicitarTool(
  nombre: string,
  input: Record<string, unknown>,
): { toolCallId: string } {
  if (!envConfig.MCP_BRIDGE_ENABLED) {
    throw errorNoDisponible(
      "El bridge de Packet Tracer está desactivado en este servidor MCP (MCP_BRIDGE_ENABLED=false).",
      "Las herramientas packet_tracer_* no pueden funcionar sin él. Reactiva MCP_BRIDGE_ENABLED y reinicia el servidor MCP.",
    );
  }
  if (!io) throw errorBridgeInactivo();

  const extension = getExtensionSocket();
  if (!extension) throw errorExtensionAusente();

  // El prefijo `tool-<nombre>-<uuid>` es el que la extensión reconoce; se mantiene
  // literal por compatibilidad con el contrato del plugin.
  const toolCallId = `tool-${nombre}-${randomUUID()}`;
  if (!registrarLlamada(toolCallId, extension.id)) {
    throw new Error(`La llamada '${toolCallId}' ya está en vuelo (id duplicado).`);
  }

  Logger.traza(`[BRIDGE_MCP] tool_call → ${nombre}`, { toolCallId });
  extension.emit("tool_call", {
    tool_call_id: toolCallId,
    tool_name: nombre,
    tool_input: input,
  });

  return { toolCallId };
}

/**
 * Espera el resultado de una llamada registrada por `solicitarTool`.
 *
 * Se resuelve con el `result` CRUDO que envió la extensión (el envoltorio
 * `{code, result}` de `runCode` lo quita `PacketTracerBridge`, que es quien conoce
 * esa peculiaridad del motor) y se rechaza con un `McpToolError` accionable si la
 * extensión se va, si la llamada caduca o si nunca llegó.
 *
 * El temporizador propio NO es redundante con `VIGENCIA_LLAMADA_MS`: garantiza
 * que la promesa se resuelva siempre, incluso si su entrada se podó del registro.
 * Esa es la red que impide que una llamada en vuelo quede colgada para siempre.
 *
 * Es idempotente: si varios esperan la misma llamada, todos reciben la misma
 * promise (el resultado se entrega una sola vez, así que dos esperas
 * independientes dejarían a una de ellas colgada para siempre).
 */
export function esperarResultado(toolCallId: string): Promise<unknown> {
  const llamada = llamadasPendientes.get(toolCallId);
  if (!llamada) {
    return Promise.reject(
      errorNoDisponible(
        `No hay ninguna llamada en vuelo con el id '${toolCallId}'.`,
        "O bien su resultado ya se consumió, o bien caducó. Vuelve a pedir la operación; no reutilices ids viejos.",
      ),
    );
  }

  // Resultado que llegó antes de que nadie esperara: se entrega ya.
  if (llamada.resultadoListo) {
    const valor = llamada.resultadoListo.valor;
    llamadasPendientes.delete(toolCallId);
    return Promise.resolve(valor);
  }
  if (llamada.espera) return llamada.espera.promesa;

  let resolver!: (valor: unknown) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<unknown>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  const temporizador = setTimeout(() => {
    llamadasPendientes.delete(toolCallId);
    rechazar(errorCaducada(toolCallId));
  }, VIGENCIA_LLAMADA_MS);

  llamada.espera = { promesa, resolver, rechazar, temporizador };
  return promesa;
}

/**
 * Olvida una llamada en vuelo (la llama quien agota su propio timeout). Corta su
 * espera para que la promesa no quede viva, y con ello se evita además un
 * `unhandledRejection` si nadie la está escuchando ya.
 */
export function olvidarLlamada(toolCallId: string): void {
  const llamada = llamadasPendientes.get(toolCallId);
  if (!llamada) return;
  cortar(
    llamada,
    errorNoDisponible(
      `Se abandonó la espera de la llamada '${toolCallId}'.`,
      "El comando pudo haberse aplicado igualmente en Packet Tracer: verifica con una lectura antes de repetirlo.",
    ),
  );
  llamadasPendientes.delete(toolCallId);
}