import { sanitizeCommandsForPrompt } from "@/agent/terminal/sanitizeCommands";
import {
  CONFIRMACION_DESTRUCTIVA_RE,
  CONSERVADOR,
  detectVendorIdFromPrompt,
  getVendorProfile,
  resolveVendorProfile,
  type VendorProfile,
} from "@/agent/security/VendorProfile";
import { Logger } from "@/utils/Logger";
import { requestContext } from "@/utils/RequestContext";

function turnoAbortado(): boolean {
  return requestContext.getStore()?.abortSignal?.aborted === true;
}
import {
  ANSI_RE,
  clasificarEsperaDeEntrada,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_MS,
  DEFAULT_POLL_MS,
  detectarPaginador,
  diagnosticarSinPrompt,
  INTERACTIVE_EOL,
  INVITACION_RESPUESTA_RE,
  limpiarMarcasPaginador,
  PAGINADOR_KEY,
  PAGINADOR_TAIL_CHARS,
  PENDING_PROMPT_RE,
  pendingInputReason,
  recortarPorEco,
  REMOVED_REASON,
  waitForOutput,
  type DiagnosticoSinPrompt,
  type DeteccionPaginador,
  type MotivoCorte,
  type MotivoSinPrompt,
  type PaginadorVariante,
  type WaitEndReason,
  type WaitForOutputResult,
} from "@/sockets/terminalIO";

export {
  ANSI_RE,
  PENDING_PROMPT_RE,
  detectarPaginador,
  limpiarMarcasPaginador,
  PAGINADOR_KEY,
} from "@/sockets/terminalIO";

export interface TerminalSessionRegistration {
  socketId: string;
  userId: string;
  providerId: string | null;
  protocol: string | null;
  deviceName: string | null;

  fingerprint: string | null;

  typeDevice?: string | null;

  preflight?: boolean;
  write: (data: string) => void;
  isAlive: () => boolean;
  onBusyChange?: (busy: boolean) => void;
}

export interface TerminalSession extends TerminalSessionRegistration {}

export interface TerminalSessionSnapshot {
  sessionId: string;
  protocol: string | null;
  deviceName: string | null;
  providerId: string | null;
  fingerprint: string | null;
  alive: boolean;
  busy: boolean;
  prompt: string | null;

  lastLines: string[];

  vendor: string;

  promptWaitMessage: string | null;

  despertar: DespertarConsola | null;

  motivoSinPrompt: MotivoSinPrompt | null;

  pendiente: string | null;

  ultimaLinea: string | null;
}

export interface DespertarConsola {

  intentos: number;

  motivoFinal: string | null;
}

export class TerminalPreFlightError extends Error {

  readonly diagnostico: DiagnosticoSinPrompt;

  readonly despertar: DespertarConsola | null;

  constructor(
    mensaje: string,
    diagnostico: DiagnosticoSinPrompt,
    despertar: DespertarConsola | null = null,
  ) {
    super(mensaje);
    this.name = "TerminalPreFlightError";
    this.diagnostico = diagnostico;
    this.despertar = despertar;
  }

  get motivoSinPrompt(): MotivoSinPrompt {
    return this.diagnostico.motivo;
  }

  get motivo(): MotivoSinPrompt {
    return this.diagnostico.motivo;
  }

  get consejo(): string {
    return this.diagnostico.consejo;
  }
}

export function diagnosticoSinPromptDe(
  error: unknown,
): DiagnosticoSinPrompt | null {
  if (error instanceof TerminalPreFlightError) return error.diagnostico;
  const dato = (error as { diagnostico?: unknown } | null)?.diagnostico;
  return dato && typeof dato === "object"
    ? (dato as DiagnosticoSinPrompt)
    : null;
}

export interface TerminalPreflightOptions {

  enabled?: boolean;

  timeoutMs?: number;
}

export interface TerminalRunOptions {
  idleMs?: number;
  maxMs?: number;

  preflight?: TerminalPreflightOptions | false;
}

export interface TerminalCommandResult {

  output: string;

  executed: string[];

  omitidasPorAbort?: string[];

  abortado?: boolean;

  removed: string[];

  removedReason: string | null;

  endReason: WaitEndReason;

  timedOut: boolean;

  pendingInput: string | null;
  elapsedMs: number;

  vendor: string;

  promptAtSend: string | null;

  preflightWaitMs: number;

  paged: boolean;

  pages: number;

  pagerVariant: PaginadorVariante | null;

  recortado: boolean;

  motivoCorte: MotivoCorte | null;

  despertar: DespertarConsola | null;
}

export interface CapturaPaginada {

  paged: boolean;

  pages: number;

  pagerVariant: PaginadorVariante | null;
}

export type ConfigFase =

  | "preambulo"

  | "privilegio"

  | "config"
  | "comando"

  | "guardar"

  | "salida"

  | "verificacion";

export type ConfigEstado =

  | "enviado"

  | "omitido"

  | "dialogo"

  | "error";

export type ConfigMotivoAborto =

  | "pregunta_al_usuario"

  | "confirmacion_destructiva"

  | "paginador_sin_respuesta"

  | "dialogo_desconocido"

  | "equipo_no_responde"

  | "salida_no_soportada"

  | "no_se_sale_de_config"

  | "sesion_caida"

  | "turno_abortado";

export type ConfigDialogoTipo =

  | "confirmacion_propia"

  | "pregunta_al_usuario"

  | "destructiva"

  | "arranque"

  | "desconocido";

export interface ConfigDialogo {

  texto: string;

  tipo: ConfigDialogoTipo;

  fase: ConfigFase;

  patron: string | null;

  respuesta: string;

  motivo: string;
}

export interface ConfigPlanLinea {
  fase: ConfigFase;

  comando: string;

  motivo: string;
}

export interface ConfigPlanOmitida {
  fase: ConfigFase;

  porque: string;
}

export interface ConfigPlan {

  lineas: ConfigPlanLinea[];
  omitidas: ConfigPlanOmitida[];
}

export interface ConfigPaso extends ConfigPlanLinea {
  estado: ConfigEstado;

  output: string;

  paged: boolean;
  pages: number;

  detalle: string | null;
}

export interface ConfigVerificacion {

  pedidos: string[];

  resultados: { comando: string; output: string; endReason: WaitEndReason }[];

  completa: boolean;

  motivo: string | null;
}

export type ConfigModo = "config" | "privilegiado" | "usuario" | "desconocido";

export interface TerminalConfigOptions {

  comandos: string[];

  guardar?: boolean;

  dryRun?: boolean;

  verifyCommands?: string[];
  idleMs?: number;
  maxMs?: number;
  preflight?: TerminalPreflightOptions | false;
}

export interface TerminalConfigResult {

  dryRun: boolean;
  vendor: string;
  vendorLabel: string;

  plan: ConfigPlan;

  pasos: ConfigPaso[];

  dialogos: ConfigDialogo[];

  dialogoPendiente: ConfigDialogo | null;

  abortado: boolean;
  motivoAborto: ConfigMotivoAborto | null;

  motivoAbortoTexto: string | null;

  executed: string[];

  output: string;

  salioDeConfig: boolean;

  avisoSalida: string | null;

  intentosSalida: number;

  modoFinal: ConfigModo;

  modoIndeterminado: boolean;
  promptFinal: string | null;

  entramosEnConfig: boolean;

  guardado: boolean;

  verificacion: ConfigVerificacion | null;

  despertar: DespertarConsola | null;

  motivoSinPrompt: MotivoSinPrompt | null;

  pendiente: string | null;

  ultimaLinea: string | null;
}

interface InternalSession extends TerminalSession {
  capturing: boolean;
  captureBuffer: string;
  busy: boolean;

  recentBuffer: string;

  lines: string[];

  lineCarry: string;

  lastUserInputAt: number;

  vendor: VendorProfile | null;

  preflightEnabled: boolean;
}

export const SSH2_HANDSHAKE_PREFIX = "SSH-2.0-ssh2js";

const MAX_CAPTURE_CHARS = 200_000;
const MAX_RECENT_CHARS = 100_000;
const MAX_SNAPSHOT_LINES = 100;
const COMMAND_GAP_MS = 150;
const KEEPALIVE_INTERVAL_MS = 60_000;
const WAIT_PROMPT_DEFAULT_MS = 10_000;
const WAIT_PROMPT_MAX_MS = 60_000;

const WAIT_PROMPT_MIN_POLLS = 2;

const MOTIVO_CAIDA = "caida";

interface EsperaPrompt {

  ok: boolean;

  despertar: DespertarConsola | null;

  motivoFinal: string | null;

  caida: boolean;
}
const CLOSING_COMMAND_RE = /^(?:exit|quit|logout|disconnect|close)$/i;

const OPENING_COMMAND_RE = /(?:^|[/\s])(?:exit|quit|logout|disconnect|close)$/i;

const USER_INPUT_QUIET_MS = 5_000;

const PREFLIGHT_DEFAULT_MS = 2_000;
const PREFLIGHT_MAX_MS = 10_000;

const PREFLIGHT_IDLE_MS = 300;

const DESPERTAR_INTENTOS_MAX = 2;

const DESPERTAR_ESPERA_POR_INTENTO_MS = 600;

const DESPERTAR_ESPERA_MINIMA_MS = 250;

export const PAGINADOR_MAX_PAGINAS = 40;

const PAGINADOR_SETTLE_MS = 500;

const PAGINADOR_PROGRESO_MIN_CHARS = 2;

const PAGINADOR_INTENTOS_SIN_PROGRESO = 2;

const PROGRESO_COLA_CHARS = 64;

const CONFIG_MAX_COMANDOS = 60;

const CONFIG_MAX_VERIFICACION = 10;

const CONFIG_POST_DIALOGO_MS = 2_500;

const CONFIG_ESPERA_SIN_PROMPT_MS = 800;

const CONFIG_DIALOGO_COLA_CHARS = 600;

const CONFIG_ESPERA_ESTABLE_MS = 120;

const CONFIG_ESPERA_ANTES_DE_LINEA_MS = 2_000;

const CONFIG_SALIDA_INTENTOS_MAX = 4;

const NOMBRES_SUBMODO: Readonly<Record<string, string>> = {
  "": "configuración",
  "if": "interfaz",
  "router": "enrutador",
  "router bgp": "enrutador BGP",
  "line": "línea",
  "vlan": "VLAN",
  "aaa": "AAA",
  "route-map": "route-map",
  "ip": "IP",
  "crypto": "criptografía",
  "class-map": "class-map",
  "policy-map": "policy-map",
  "spanning-tree": "spanning-tree",
};

const TOKEN_SPLIT_RE = /[^a-z0-9_@.-]+/;

const PROMPT_MARKER_RE = /[#>\]$%]/;

export function buildTerminalFingerprint(input: {
  protocol?: string | null;
  host?: string | null;
  port?: number | null;
  serialPort?: string | null;
  baudRate?: number | null;
}): string | null {
  const protocol = String(input.protocol ?? "").trim().toUpperCase();
  const serialPort = String(input.serialPort ?? "").trim().toUpperCase();
  const host = String(input.host ?? "").trim().toUpperCase();

  if (protocol === "SERIAL" || (!protocol && serialPort)) {
    if (!serialPort) return null;
    const baudRate = Number(input.baudRate ?? 9600) || 9600;
    return `SERIAL:${serialPort}:${baudRate}`;
  }

  if (!host) return null;
  if (protocol === "SSH") {
    const port = Number(input.port ?? 22) || 22;
    return `SSH:${host}:${port}`;
  }
  if (protocol === "TELNET") {
    const port = Number(input.port ?? 23) || 23;
    return `TELNET:${host}:${port}`;
  }
  const port = Number(input.port ?? 0) || 0;
  if (!port) return null;
  return `${protocol || "TCP"}:${host}:${port}`;
}

export function detectPrompt(raw: string): string | null {
  const lineas = String(raw ?? "").split("\n");
  let ultima = "";
  for (let i = lineas.length - 1; i >= 0; i--) {
    const limpia = lineas[i].replace(ANSI_RE, "").replace(/\r/g, "").trim();
    if (limpia) {
      ultima = limpia;
      break;
    }
  }
  if (!ultima) return null;
  if (PENDING_PROMPT_RE.test(ultima)) return null;
  if (ultima.length > 120) return null;
  if (!/[#>$]$/.test(ultima) && !esPromptEntreCorchetes(ultima)) return null;
  return ultima;
}

function esPromptEntreCorchetes(linea: string): boolean {
  if (/^\[[^\]\n]*\]$/.test(linea)) return true;
  return /^\[[^\]\n]*@[^\]\n]*\]\s*\/\S+/.test(linea);
}

export function shouldKeepalive(raw: string): boolean {
  if (!detectPrompt(raw)) return false;
  return pendingInputReason(raw) === null;
}

export function sanitizeTerminalOutput(text: string): string {
  return String(text ?? "")
    .split("\n")
    .filter((line) => {
      const sinRetorno = line.endsWith("\r") ? line.slice(0, -1) : line;
      return !sinRetorno.startsWith(SSH2_HANDSHAKE_PREFIX);
    })
    .join("\n");
}

export function normalizePromptText(texto?: string | null): string {
  return String(texto ?? "")
    .replace(ANSI_RE, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function esPromptCompleto(texto: string): boolean {
  return PROMPT_MARKER_RE.test(texto);
}

function tokensDePrompt(texto: string): string[] {
  return texto.toLowerCase().split(TOKEN_SPLIT_RE).filter(Boolean);
}

function esPromptDelPerfil(profile: VendorProfile, prompt: string): boolean {
  return (
    profile.prompt.isPrompt(prompt) ||
    profile.prompt.isNested(prompt) ||
    CONSERVADOR.prompt.isPrompt(prompt)
  );
}

export function promptSatisfies(
  profile: VendorProfile,
  prompt: string | null | undefined,
  expected?: string | null,
): boolean {
  const actual = normalizePromptText(prompt).toLowerCase();
  if (!actual) return false;
  const pedido = normalizePromptText(expected).toLowerCase();
  if (!pedido) return true;
  if (actual === pedido) return true;
  if (esPromptCompleto(pedido)) {
    return actual.endsWith(pedido) && esPromptDelPerfil(profile, actual);
  }
  if (actual.endsWith(pedido)) return true;
  return tokensDePrompt(actual).includes(pedido);
}

export function snapshotPromptSatisfies(
  snapshot: Pick<TerminalSessionSnapshot, "prompt" | "vendor">,
  expected?: string | null,
): boolean {
  return promptSatisfies(
    getVendorProfile(snapshot.vendor),
    snapshot.prompt,
    expected,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ultimoComandoEjecutado(comandos: readonly string[]): string {
  for (let i = comandos.length - 1; i >= 0; i -= 1) {
    const cmd = String(comandos[i] ?? "").trim();
    if (cmd) return cmd;
  }
  return "";
}

const COMANDO_RECHAZADO_RE =
  /(bad\s+command\s+name|unknown\s+command|invalid\s+input\s+detected|incomplete\s+command|ambiguous\s+command|unrecognized\s+command|syntax\s+error|command\s+not\s+found|invalid\s+input)/i;

export class TerminalSessionHub {
  private readonly sessions = new Map<string, InternalSession>();

  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  private preflightDefault = true;

  register(registration: TerminalSessionRegistration): void {

    const { preflight, ...registro } = registration;
    this.sessions.set(registration.socketId, {
      ...registro,
      capturing: false,
      captureBuffer: "",
      busy: false,
      recentBuffer: "",
      lines: [],
      lineCarry: "",
      lastUserInputAt: 0,
      vendor: null,
      preflightEnabled: preflight !== false,
    });
    this.startKeepalive();
  }

  setPreflightDefault(enabled: boolean): void {
    this.preflightDefault = enabled !== false;
  }

  unregister(socketId: string): void {
    this.sessions.delete(socketId);
    this.maybeStopKeepalive();
  }

  unregisterByUserId(userId: string): void {
    for (const [socketId, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(socketId);
    }
    this.maybeStopKeepalive();
  }

  get(socketId: string): TerminalSession | null {
    const session = this.sessions.get(socketId);
    return session ? this.toPublic(session) : null;
  }

  isBusy(socketId: string): boolean {
    return this.sessions.get(socketId)?.busy === true;
  }

  noteUserInput(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) session.lastUserInputAt = Date.now();
  }

  clear(): void {
    this.sessions.clear();
    this.stopKeepalive();
  }

  findMatch(
    userId: string,
    providerId: string | null,
    fingerprint?: string | null,
  ): TerminalSession | null {
    const alive = [...this.sessions.values()].filter(
      (session) => session.userId === userId && this.isAlive(session),
    );

    if (providerId) {
      const byProvider = alive.filter(
        (session) => session.providerId === providerId,
      );
      if (byProvider.length === 1) return this.toPublic(byProvider[0]);
      if (byProvider.length > 1) return null;
    }

    if (fingerprint) {
      const byFingerprint = alive.filter(
        (session) => session.fingerprint === fingerprint,
      );
      if (byFingerprint.length === 1) return this.toPublic(byFingerprint[0]);
      if (byFingerprint.length > 1) return null;
    }

    return null;
  }

  hasMatch(
    userId: string,
    providerId: string | null,
    fingerprint?: string | null,
  ): boolean {
    return this.findMatch(userId, providerId, fingerprint) !== null;
  }

  getSnapshot(sessionId: string): TerminalSessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    return session ? this.buildSnapshot(session) : null;
  }

  getSnapshotForUser(
    userId: string,
    sessionId: string,
  ): TerminalSessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return null;
    return this.buildSnapshot(session);
  }

  getActiveSnapshot(userId: string): TerminalSessionSnapshot | null {
    const vivas = this.aliveSessionsOf(userId);
    if (vivas.length !== 1) return null;
    return this.buildSnapshot(vivas[0]);
  }

  getActiveSession(userId: string): TerminalSession | null {
    const vivas = this.aliveSessionsOf(userId);
    if (vivas.length !== 1) return null;
    return this.toPublic(vivas[0]);
  }

  listSessions(userId: string): TerminalSessionSnapshot[] {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => this.buildSnapshot(session));
  }

  checkConnectionStatus(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? this.isAlive(session) : false;
  }

  async waitForPrompt(
    session: TerminalSession,
    options?: { expected?: string; timeoutMs?: number },
  ): Promise<TerminalSessionSnapshot> {
    const internal = this.sessions.get(session.socketId);
    if (!internal) return this.buildSnapshotFromRegistration(session);

    const expected = options?.expected;
    const timeoutMs = this.normalizeWaitTimeout(options?.timeoutMs);

    const espera = await this.esperarPromptDespertando(internal, timeoutMs, expected);
    if (espera.ok) {
      const listo = this.buildSnapshot(internal);
      return espera.despertar ? { ...listo, despertar: espera.despertar } : listo;
    }
    return {
      ...this.buildSnapshot(internal),
      promptWaitMessage: this.mensajePromptNoVisto(
        internal,
        expected,
        timeoutMs,
        espera.motivoFinal === MOTIVO_CAIDA,
        espera.despertar,
      ),
      despertar: espera.despertar,
    };
  }

  async sendCommand(
    session: TerminalSession,
    command: string,
    options?: TerminalRunOptions,
  ): Promise<string> {
    return (await this.sendCommandDetailed(session, command, options)).output;
  }

  async sendCommandDetailed(
    session: TerminalSession,
    command: string,
    options?: TerminalRunOptions,
  ): Promise<TerminalCommandResult> {
    const internal = this.sessions.get(session.socketId);
    const prompt = detectPrompt(internal?.recentBuffer ?? "");
    const perfil = this.resolveVendor(internal, prompt);
    const cmd = String(command ?? "").trim();
    if (this.abreLaSesion(cmd, perfil) && prompt && !perfil.prompt.isNested(prompt)) {
      throw new Error(
        `Por seguridad no se envía '${command}' en el prompt raíz (${perfil.label}): cerraría la sesión interactiva. Solo se permite dentro de un sub-modo del vendor.`,
      );
    }
    return this.runCommandsDetailed(session, [command], options);
  }

  recordData(socketId: string, chunk: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    const saneado = sanitizeTerminalOutput(String(chunk ?? ""));
    if (!saneado) return;

    session.recentBuffer = (session.recentBuffer + saneado).slice(
      -MAX_RECENT_CHARS,
    );
    this.appendToLines(session, saneado);

    if (session.capturing) {
      session.captureBuffer = (session.captureBuffer + saneado).slice(
        -MAX_CAPTURE_CHARS,
      );
    }
  }

  async runCommands(
    session: TerminalSession,
    commands: string[],
    options?: TerminalRunOptions,
  ): Promise<string> {
    return (await this.runCommandsDetailed(session, commands, options)).output;
  }

  async runCommandsDetailed(
    session: TerminalSession,
    commands: string[],
    options?: TerminalRunOptions,
  ): Promise<TerminalCommandResult> {
    const internal = this.sessions.get(session.socketId);
    if (!internal) {
      throw new Error("La sesión de terminal ya no está activa.");
    }
    if (internal.busy) {
      throw new Error(
        "La consola está siendo utilizada por otra operación. Inténtalo de nuevo en unos segundos.",
      );
    }

    const idleMs = options?.idleMs ?? DEFAULT_IDLE_MS;
    const maxMs = options?.maxMs ?? DEFAULT_MAX_MS;
    const lista = Array.isArray(commands) ? commands : [];

    const prompt = detectPrompt(internal.recentBuffer);
    const perfil = this.resolveVendor(internal, prompt);
    const { commands: seguros, removed } = sanitizeCommandsForPrompt(
      lista,
      prompt,
      perfil,
    );
    if (removed.length > 0) {
      Logger.warning({
        message:
          "[TerminalSessionHub] Comandos descartados por cerrar la sesión interactiva.",
        data: { socketId: session.socketId, removed, prompt, vendor: perfil.id },
      });
    }

    const tieneAlguno =
      lista.some((cmd) => String(cmd ?? "").trim()) && seguros.length === 0;
    if (tieneAlguno && removed.length > 0) {
      throw new Error(
        "Comandos bloqueados por seguridad: cerrarían la sesión interactiva del usuario.",
      );
    }

    internal.busy = true;
    internal.capturing = true;
    internal.captureBuffer = "";
    internal.onBusyChange?.(true);

    let preflightWaitMs = 0;
    try {
      if (seguros.length === 0) {
        return {
          output: "",
          executed: [],
          removed,
          removedReason: removed.length > 0 ? REMOVED_REASON : null,
          endReason: "idle",
          timedOut: false,
          pendingInput: null,
          elapsedMs: 0,
          vendor: perfil.id,
          promptAtSend: prompt,
          preflightWaitMs: 0,

          paged: false,
          pages: 0,
          pagerVariant: null,

          recortado: false,
          motivoCorte: null,
          despertar: null,
        };
      }

      const preflight = await this.exigirPromptAntesDeEnviar(
        internal,
        options,
        idleMs,
        maxMs,
      );
      preflightWaitMs = preflight.waitedMs;

      let escritasReal = 0;
      for (let i = 0; i < seguros.length; i++) {

        if (turnoAbortado()) {
          Logger.warning({
            message:
              "[TerminalSessionHub] Lote interrumpido: el turno se abortó antes de completarlo.",
            data: {
              socketId: session.socketId,
              enviados: escritasReal,
              pendientes: seguros.length - escritasReal,
            },
          });
          break;
        }

        internal.write(`${seguros[i]}${INTERACTIVE_EOL}`);

        if (this.isAlive(internal)) escritasReal++;
        if (i < seguros.length - 1) await delay(COMMAND_GAP_MS);
      }

      const omitidasPorAbort = seguros.slice(escritasReal);

      const espera = await this.waitForCapture(internal, idleMs, maxMs);

      const capturado = espera.paged
        ? limpiarMarcasPaginador(espera.output)
        : espera.output;

      const corte = recortarPorEco(capturado, ultimoComandoEjecutado(seguros.slice(0, escritasReal)));
      return {
        output: this.sinPromptFinal(corte.texto),

        executed: seguros.slice(0, escritasReal),
        omitidasPorAbort,
        abortado: omitidasPorAbort.length > 0,
        removed,
        removedReason: removed.length > 0 ? REMOVED_REASON : null,
        endReason: espera.reason,
        timedOut: espera.reason === "maxMs",
        pendingInput: espera.pending,
        elapsedMs: espera.elapsedMs,
        vendor: perfil.id,
        promptAtSend: prompt,
        preflightWaitMs,
        paged: espera.paged,
        pages: espera.pages,
        pagerVariant: espera.pagerVariant,
        recortado: corte.recortado,

        motivoCorte: corte.motivo,
        despertar: preflight.despertar,
      };
    } finally {
      internal.capturing = false;
      internal.busy = false;
      internal.onBusyChange?.(false);
    }
  }

  async runConfigDetailed(
    session: TerminalSession,
    options: TerminalConfigOptions,
  ): Promise<TerminalConfigResult> {
    const internal = this.sessions.get(session.socketId);
    if (!internal) {
      throw new Error("La sesión de terminal ya no está activa.");
    }
    if (internal.busy) {
      throw new Error(
        "La consola está siendo utilizada por otra operación. Inténtalo de nuevo en unos segundos.",
      );
    }

    const idleMs = options?.idleMs ?? DEFAULT_IDLE_MS;
    const maxMs = options?.maxMs ?? DEFAULT_MAX_MS;
    const dryRun = options?.dryRun === true;
    const guardar = options?.guardar === true;

    const prompt = detectPrompt(internal.recentBuffer);
    const perfil = this.resolveVendor(internal, prompt);
    const etiqueta = perfil.label;

    const pedidos = (Array.isArray(options?.comandos) ? options.comandos : [])
      .flatMap((linea) => String(linea ?? "").split(/\r?\n/))
      .map((linea) => linea.trim())
      .filter(Boolean);
    if (pedidos.length > CONFIG_MAX_COMANDOS) {
      throw new Error(
        `El lote tiene ${pedidos.length} comandos y el máximo por llamada es ${CONFIG_MAX_COMANDOS}. ` +
          "Divide la configuración en varios lotes con verificación en medio: un lote largo " +
          "gasta el presupuesto del turno sin que nadie pueda leer lo que ocurre.",
      );
    }
    const verificacionPedida = (options?.verifyCommands ?? [])
      .flatMap((linea) => String(linea ?? "").split(/\r?\n/))
      .map((linea) => linea.trim())
      .filter(Boolean)
      .slice(0, CONFIG_MAX_VERIFICACION);

    const plan = this.planConfig(perfil, prompt, {
      comandos: pedidos,
      guardar,
      verificacion: verificacionPedida,
    });

    const base: Omit<
      TerminalConfigResult,
      | "pasos"
      | "dialogos"
      | "dialogoPendiente"
      | "abortado"
      | "motivoAborto"
      | "motivoAbortoTexto"
      | "executed"
      | "output"
      | "salioDeConfig"
      | "avisoSalida"
      | "intentosSalida"
      | "modoFinal"
      | "modoIndeterminado"
      | "promptFinal"
      | "entramosEnConfig"
      | "guardado"
      | "verificacion"
      | "despertar"
      | "motivoSinPrompt"
      | "pendiente"
      | "ultimaLinea"
    > = {
      dryRun,
      vendor: perfil.id,
      vendorLabel: etiqueta,
      plan,
    };

    if (dryRun) {
      const listo = this.isPromptReady(internal);
      const modo = this.modoDePrompt(perfil, prompt);

      const diag = listo
        ? null
        : diagnosticarSinPrompt(internal.recentBuffer, {
            caida: !this.viveLaSesion(internal),
          });
      return {
        ...base,
        pasos: [],
        dialogos: [],
        dialogoPendiente: null,
        abortado: false,
        motivoAborto: listo ? null : "equipo_no_responde",
        motivoAbortoTexto: listo
          ? null
          : `La consola no tiene un prompt listo${prompt ? "" : " (no se detectó ninguno)"} ` +
            `(motivo: ${diag?.motivo ?? "desconocido"}). ${diag?.consejo ?? ""} ` +
            `última línea: "${diag?.ultimaLinea || "(vacía)"}". ` +
            "El plan es el que se ejecutaría en cuanto el equipo responda, pero no se ha escrito nada.",
        executed: [],
        output: "",

        salioDeConfig: true,
        avisoSalida: null,
        intentosSalida: 0,
        modoFinal: modo.modo,
        modoIndeterminado: modo.indeterminado,
        promptFinal: prompt,
        entramosEnConfig: modo.modo === "config",
        guardado: false,
        verificacion: null,
        despertar: null,
        motivoSinPrompt: diag?.motivo ?? null,
        pendiente: diag?.pendiente ?? null,
        ultimaLinea: diag?.ultimaLinea ?? this.ultimaLinea(internal),
      };
    }

    internal.busy = true;
    internal.capturing = true;
    internal.onBusyChange?.(true);

    const pasos: ConfigPaso[] = [];
    const dialogos: ConfigDialogo[] = [];
    const executed: string[] = [];
    const salidas: string[] = [];
    let dialogoPendiente: ConfigDialogo | null = null;
    let motivoAborto: ConfigMotivoAborto | null = null;
    let motivoAbortoTexto: string | null = null;
    let entramosEnConfig = false;
    let guardado = false;

let promptPuntoDePartida: string | null = null;

    const planSinTransicionDeEntrada = !plan.lineas.some((l) => l.fase === "config");

    let salidaEnviada = false;
    let promptAntesSalida: string | null = null;

    let salidaRechazadaTexto: string | null = null;

    try {

      let despertar: DespertarConsola | null = null;
      const preflight = await this.exigirPromptAntesDeEnviar(
        internal,
        options,
        idleMs,
        maxMs,
      );
      despertar = preflight.despertar;

      for (const linea of plan.lineas) {

        if (linea.fase === "verificacion") continue;
        const promptAntes = detectPrompt(internal.recentBuffer);

        if (
          linea.fase === "salida" &&
          !this.esPromptDeConfiguracion(perfil, promptAntes)
        ) {
          pasos.push({
            ...linea,
            estado: "omitido",
            output: "",
            paged: false,
            pages: 0,
            detalle:
              `el prompt actual${promptAntes ? ` es "${promptAntes}"` : " no se detectó"} y no es un ` +
              `sub-modo de ${etiqueta}: no se envía '${linea.comando}' porque en la raíz cerraría ` +
              "la consola interactiva del usuario",
          });
          continue;
        }

        if (
          promptPuntoDePartida === null &&
          (linea.fase === "config" || planSinTransicionDeEntrada)
        ) {

          promptPuntoDePartida = promptAntes;
        }
        if (linea.fase === "salida") {
          salidaEnviada = true;
          promptAntesSalida = promptAntes;
        }
        const envio = await this.enviarLineaDeConfig(internal, {
          perfil,
          linea,
          idleMs,
          maxMs,

          protegido: linea.fase === "comando",
        });
        pasos.push(envio.paso);

        if (envio.escrito) {
          executed.push(envio.escrito);
          if (envio.paso.output.trim()) salidas.push(envio.paso.output.trim());
          if (linea.fase === "config") entramosEnConfig = true;
          if (linea.fase === "guardar") guardado = true;
        }

        if (envio.dialogo) {
          dialogos.push(envio.dialogo);
          const resuelto = await this.resolverDialogoConfig(internal, {
            perfil,
            dialogo: envio.dialogo,
            linea,
            idleMs,
            maxMs,
          });
          if (resuelto.paso) pasos.push(resuelto.paso);
          if (resuelto.respuesta) executed.push(resuelto.respuesta);
          if (!resuelto.ok) {
            dialogoPendiente = resuelto.dialogo;
            motivoAborto = resuelto.motivo;
            motivoAbortoTexto = resuelto.texto;
            break;
          }
        } else if (envio.motivo) {
          motivoAborto = envio.motivo;
          motivoAbortoTexto = envio.motivoTexto;
          if (envio.motivo === "salida_no_soportada") {
            salidaRechazadaTexto = envio.motivoTexto;
          }
          break;
        }
      }

      let salioDeConfig = true;
      let avisoSalida: string | null = null;
      let intentosSalida = 0;

      if (salidaRechazadaTexto !== null) {
        salioDeConfig = false;
        avisoSalida = salidaRechazadaTexto;
      }
      const lineaSalida = plan.lineas.find((l) => l.fase === "salida") ?? null;
      if (salidaEnviada && lineaSalida && motivoAborto === null) {
        const salida = await this.salirDeConfigComprobando(internal, {
          perfil,
          linea: lineaSalida,
          idleMs,
          maxMs,
          yaEnviada: true,
          puntoDePartida: promptPuntoDePartida,
          promptEnviada: promptAntesSalida,
          pasos,
          executed,
          salidas,
        });
        salioDeConfig = salida.salio;
        avisoSalida = salida.aviso;
        intentosSalida = salida.intentos;
        if (!salida.salio && motivoAborto === null) {
          motivoAborto = "no_se_sale_de_config";
          motivoAbortoTexto = salida.aviso;
        }
        Logger.info({
          message: salida.salio
            ? "[TerminalSessionHub] La consola salió del modo configuración."
            : "[TerminalSessionHub] La consola NO salió del modo configuración: se aborta el lote.",
          data: {
            socketId: session.socketId,
            vendor: perfil.id,
            intentos: intentosSalida,
            causa: salida.causa,
            aviso: avisoSalida,
          },
        });
      }

      if (salioDeConfig && !salidaEnviada && !lineaSalida) {
        const promptActual = detectPrompt(internal.recentBuffer);
        const estadoFinal = this.estadoSalidaDeConfig(
          perfil,
          promptActual,
          promptPuntoDePartida,
        );
        if (estadoFinal.seguro) {
          salioDeConfig = false;
          avisoSalida =
            `El lote dejó la consola en "${promptActual}", que es un modo de ` +
            `configuración de ${etiqueta} distinto de "${promptPuntoDePartida ?? "(sin prompt)"}", ` +
            "y el motor NO la sacó: el perfil de " +
            `${etiqueta} no declara con qué SALIR del modo configuración (` +
            "`salirDeConfig`), así que el plan no traía línea de salida y solo decide " +
            `la salida desde la raíz. NO des el ciclo por cerrado: sal de ese ` +
            "modo con el comando de subida de nivel que use el equipo (el que " +
            "aparece en su propia ayuda) antes de seguir, y comprueba después " +
            "con read_terminal que la consola está en su prompt raíz.";
          if (motivoAborto === null) {
            motivoAborto = "no_se_sale_de_config";
            motivoAbortoTexto = avisoSalida;
          }
          Logger.warning({
            message:
              "[TerminalSessionHub] El lote dejó la consola en un sub-modo y el plan no traía línea de salida.",
            data: {
              socketId: session.socketId,
              vendor: perfil.id,
              promptActual,
              puntoDePartida: promptPuntoDePartida,
            },
          });
        }
      }

      let verificacion: ConfigVerificacion | null = null;
      if (verificacionPedida.length > 0) {
        verificacion = {
          pedidos: [...verificacionPedida],
          resultados: [],
          completa: true,
          motivo: null,
        };
        if (motivoAborto) {
          verificacion.completa = false;
          verificacion.motivo =
            `no se llegó a verificar porque el lote se paró antes (${motivoAborto}). ` +
            "NO des por aplicado lo que no has leído: comprueba la consola con read_terminal.";
        } else {
          for (const comando of verificacionPedida) {
            const envio = await this.enviarLineaDeConfig(internal, {
              perfil,
              linea: {
                fase: "verificacion",
                comando,
                motivo: "comprobación posterior de lo aplicado",
              },
              idleMs,
              maxMs,

              protegido: true,
            });
            pasos.push(envio.paso);
            if (envio.escrito) executed.push(envio.escrito);
            verificacion.resultados.push({
              comando,
              output: envio.paso.output,
              endReason: envio.endReason,
            });
            if (envio.motivo || envio.dialogo) {
              verificacion.completa = false;
              verificacion.motivo =
                `no se pudo leer la salida de '${comando}'` +
                (envio.motivo ? ` (${envio.motivo})` : "") +
                (envio.dialogo ? `: el equipo dejó el diálogo "${envio.dialogo.texto}"` : "") +
                ". NO des por aplicado lo que no has leído: vuelve a comprobarlo con read_terminal.";
              if (!motivoAborto) {
                motivoAborto = envio.motivo;
                motivoAbortoTexto = envio.motivoTexto;
              }
              break;
            }
          }
        }
      }

      const promptFinal = detectPrompt(internal.recentBuffer);
      const modo = this.modoDePrompt(perfil, promptFinal);
      if (guardar && !guardado) {

        Logger.info({
          message:
            "[TerminalSessionHub] Se pidió guardar y el perfil no declara comando de guardado.",
          data: { socketId: session.socketId, vendor: perfil.id },
        });
      }

      return {
        ...base,
        pasos,
        dialogos,
        dialogoPendiente,
        abortado: motivoAborto !== null,
        motivoAborto,
        motivoAbortoTexto,
        executed,
        output: salidas.join("\n"),
        salioDeConfig,
        avisoSalida,
        intentosSalida,
        modoFinal: modo.modo,
        modoIndeterminado: modo.indeterminado,
        promptFinal,
        entramosEnConfig,
        guardado,
        verificacion,
        despertar,

        motivoSinPrompt: this.isPromptReady(internal)
          ? null
          : diagnosticarSinPrompt(internal.recentBuffer, {
              caida: !this.viveLaSesion(internal),
            }).motivo,
        pendiente: pendingInputReason(internal.recentBuffer),
        ultimaLinea: this.ultimaLinea(internal),
      };
    } finally {
      internal.capturing = false;
      internal.busy = false;
      internal.onBusyChange?.(false);
    }
  }

  private planConfig(
    perfil: VendorProfile,
    prompt: string | null,
    opciones: { comandos: string[]; guardar: boolean; verificacion: string[] },
  ): ConfigPlan {
    const lineas: ConfigPlanLinea[] = [];
    const omitidas: ConfigPlanOmitida[] = [];
    const etq = perfil.label;
    const limpio = normalizePromptText(prompt);

    if (perfil.preambulo.sinPaginacion) {
      lineas.push({
        fase: "preambulo",
        comando: perfil.preambulo.sinPaginacion,
        motivo: `${etq}: desactiva el paginador para que la salida no se quede congelada a medias`,
      });
    } else {
      omitidas.push({
        fase: "preambulo",
        porque: `${etq} no declara cómo desactivar el paginador: el motor no lo inventa (y si aparece, el hub lo paga con la barra espaciadora)`,
      });
    }
    if (perfil.preambulo.sinLookupDns) {
      lineas.push({
        fase: "preambulo",
        comando: perfil.preambulo.sinLookupDns,
        motivo: `${etq}: evita los timeouts largos de la resolución de nombres`,
      });
    } else {
      omitidas.push({
        fase: "preambulo",
        porque: `${etq} no declara ningún comando de DNS: no se manda ninguno`,
      });
    }

    const yaPrivilegiado = limpio ? perfil.prompt.enable.test(limpio) : false;
    if (perfil.transiciones.aPrivilegiado) {
      if (yaPrivilegiado) {
        omitidas.push({
          fase: "privilegio",
          porque: `el prompt "${limpio}" ya es privilegiado en ${etq}: no se envía '${perfil.transiciones.aPrivilegiado}'`,
        });
      } else {
        lineas.push({
          fase: "privilegio",
          comando: perfil.transiciones.aPrivilegiado,
          motivo: `${etq}: sube a privilegio antes de configurar`,
        });
      }
    } else if (!yaPrivilegiado) {
      omitidas.push({
        fase: "privilegio",
        porque: `${etq} no declara con qué subir a privilegio (o no tiene niveles de privilegio): el motor deja la consola donde está`,
      });
    }

    const yaEnConfig = limpio ? perfil.prompt.config.test(limpio) : false;
    const entraEnConfig = Boolean(perfil.transiciones.aConfig);
    if (entraEnConfig) {
      if (yaEnConfig) {
        omitidas.push({
          fase: "config",
          porque: `el prompt "${limpio}" ya es el modo configuración de ${etq}: no se envía '${perfil.transiciones.aConfig}'`,
        });
      } else {
        lineas.push({
          fase: "config",
          comando: perfil.transiciones.aConfig as string,
          motivo: `${etq}: entra en modo configuración para aplicar el lote`,
        });
      }
    } else {
      omitidas.push({
        fase: "config",
        porque: yaEnConfig
          ? `el prompt "${limpio}" ya parece un modo de configuración: no se envía ninguna transición`
          : `${etq} no declara cómo entrar en modo configuración: el lote se envía en el modo actual de la consola`,
      });
    }

    for (const comando of opciones.comandos) {
      lineas.push({
        fase: "comando",
        comando,
        motivo: "comando del lote pedido por el agente",
      });
    }

    if (opciones.guardar) {
      if (perfil.transiciones.guardarConfig) {
        lineas.push({
          fase: "guardar",
          comando: perfil.transiciones.guardarConfig,
          motivo: "guarda la configuración en memoria no volátil (pedido explícitamente)",
        });
      } else {
        omitidas.push({
          fase: "guardar",
          porque: `${etq} no declara comando de guardado (su configuración es persistente o no está confirmado en el repo): no se manda ninguno`,
        });
      }
    }

    if (entraEnConfig && !yaEnConfig) {
      if (perfil.transiciones.salirDeConfig) {
        lineas.push({
          fase: "salida",
          comando: perfil.transiciones.salirDeConfig,
          motivo:
            `${etq}: sale del modo configuración, un nivel por envío y con topes, ` +
            "nunca más allá del punto de partida del ciclo (donde cerraría la consola del usuario)",
        });
      } else {
        omitidas.push({
          fase: "salida",
          porque: `${etq} no declara con qué salir del modo configuración: la consola se queda donde esté y se informa en 'modoFinal'`,
        });
      }
    } else if (!entraEnConfig && perfil.transiciones.salirDeConfig) {

      lineas.push({
        fase: "salida",
        comando: perfil.transiciones.salirDeConfig,
        motivo:
          `${etq} no declara cómo entrar en un modo de configuración: es el LOTE del agente ` +
          "quien puede entrar en él (en RouterOS, con su propia `/ruta`), así que la salida se " +
          "planifica igualmente y solo se escribe si al terminar el prompt es un sub-modo " +
          "(`prompt.config`), un nivel por envío y con topes",
      });
    } else {
      omitidas.push({
        fase: "salida",
        porque: "no se entró en modo configuración, así que no hay nada de lo que salir",
      });
    }

    for (const comando of opciones.verificacion) {
      lineas.push({
        fase: "verificacion",
        comando,
        motivo: "comprobación posterior de lo aplicado",
      });
    }

    return { lineas, omitidas };
  }

  private async enviarLineaDeConfig(
    session: InternalSession,
    ctx: {
      perfil: VendorProfile;
      linea: ConfigPlanLinea;
      idleMs: number;
      maxMs: number;
      protegido?: boolean;
    },
  ): Promise<{
    paso: ConfigPaso;

    escrito: string | null;
    dialogo: ConfigDialogo | null;
    endReason: WaitEndReason;
    motivo: ConfigMotivoAborto | null;
    motivoTexto: string | null;
  }> {
    const { perfil, linea, idleMs, maxMs } = ctx;
    const omitido = (detalle: string): ConfigPaso => ({
      ...linea,
      estado: "omitido",
      output: "",
      paged: false,
      pages: 0,
      detalle,
    });

    let comando = linea.comando;
    if (ctx.protegido) {
      const prompt = detectPrompt(session.recentBuffer);
      const saneado = sanitizeCommandsForPrompt([comando], prompt, perfil);
      if (saneado.commands.length === 0) {
        return {
          paso: omitido(
            `'${comando}' se descartó: ${REMOVED_REASON}. El motor nunca manda un cierre de sesión por su cuenta.`,
          ),
          escrito: null,
          dialogo: null,
          endReason: "idle",
          motivo: null,
          motivoTexto: null,
        };
      }
      comando = saneado.commands[0];
    }

    if (!this.viveLaSesion(session)) {
      return {
        paso: omitido("la sesión de terminal se cerró antes de escribir"),
        escrito: null,
        dialogo: null,
        endReason: "dead",
        motivo: "sesion_caida",
        motivoTexto: `La sesión de terminal se cerró antes de enviar '${comando}'.`,
      };
    }

    const lista = await this.esperarConsolaLista(session, {
      presupuestoMs: Math.min(CONFIG_ESPERA_ANTES_DE_LINEA_MS, maxMs),
    });
    if (!lista.ok) {
      const razon = lista.motivoFinal ?? "la consola no terminó de responder";
      return {
        paso: omitido(
          `no se escribió '${comando}': ${razon}. ` +
            `La consola está en "${this.ultimaLinea(session) || "(línea vacía)"}" y escribir a ciegas ` +
            "haría que el equipo se comiera el comando.",
        ),
        escrito: null,
        dialogo: null,
        endReason: lista.caida ? "dead" : "idle",
        motivo: lista.caida ? "sesion_caida" : "equipo_no_responde",
        motivoTexto:
          `No se escribió '${comando}': ${razon}. No se sigue con el resto del lote (la siguiente ` +
          "línea se escribiría a ciegas) y no se da por aplicado nada: comprueba la consola con " +
          "read_terminal antes de reintentar.",
      };
    }

    session.captureBuffer = "";

    const desde = session.recentBuffer.length;

    const capturado: { dialogo: ConfigDialogo | null } = { dialogo: null };

    if (turnoAbortado()) {
      return {
        paso: omitido("el turno se abortó antes de enviar esta línea"),
        escrito: null,
        dialogo: null,
        endReason: "dead",
        motivo: "turno_abortado",
        motivoTexto: "Se canceló la operación del agente antes de enviar esta línea.",
      };
    }
    try {

      session.write(`${comando}${perfil.eol}`);
    } catch (error) {
      return {
        paso: omitido(
          `no se pudo escribir '${comando}': ${error instanceof Error ? error.message : String(error)}`,
        ),
        escrito: null,
        dialogo: null,
        endReason: "dead",
        motivo: "sesion_caida",
        motivoTexto: `La sesión de terminal se cayó al enviar '${comando}'.`,
      };
    }

    const espera = await this.waitForCapture(session, idleMs, maxMs, (buffer) => {

      if (session.recentBuffer.length > desde && this.isPromptReady(session)) {
        return "idle";
      }

      const encontrado = this.evaluarDialogoConfig(perfil, buffer, linea.fase);
      if (encontrado) {
        capturado.dialogo = encontrado;
        return "dialogo";
      }
      return null;
    });

    const dialogo = capturado.dialogo;

    const corte = recortarPorEco(espera.output, comando);
    const output = this.sinPromptFinal(corte.texto);
    const paso: ConfigPaso = {
      ...linea,
      comando,
      estado: "enviado",
      output,
      paged: espera.paged,
      pages: espera.pages,
      detalle: null,
    };

    if (dialogo) {
      paso.estado = "dialogo";
      paso.detalle = `el equipo dejó el diálogo: "${dialogo.texto}"`;
      return {
        paso,
        escrito: comando,
        dialogo,
        endReason: espera.reason,
        motivo: null,
        motivoTexto: null,
      };
    }

    if (linea.fase === "salida") {
      const rechazo = this.comandoRechazadoPorElEquipo(output, comando);
      if (rechazo) {
        paso.estado = "error";
        paso.detalle =
          `el equipo rechazó el comando: ${rechazo}. ` +
          `El perfil de ${perfil.label} declara '${comando}' como salida del modo ` +
          "configuración, pero este equipo no lo acepta: no se insiste más con él.";
        return {
          paso,
          escrito: comando,
          dialogo: null,
          endReason: espera.reason,
          motivo: "salida_no_soportada",
          motivoTexto:
            `El comando de salida '${comando}' que declara el perfil de ${perfil.label} ` +
            `no existe en este equipo (respondió "${rechazo}"), así que el motor NO lo ` +
            "repite (insistir solo llenaría el equipo de errores). La consola se queda en " +
            'el modo en que está: sal a mano al prompt raíz antes de seguir y no des por ' +
            "cerrado el ciclo.",
        };
      }
    }

    if (espera.reason === "dead") {
      paso.estado = "error";
      paso.detalle = "la sesión de terminal se cayó durante el comando";
      return {
        paso,
        escrito: comando,
        dialogo: null,
        endReason: "dead",
        motivo: "sesion_caida",
        motivoTexto: `La sesión de terminal se cayó al enviar '${comando}': lo que se había aplicado hasta ahí sigue sin verificar.`,
      };
    }

    if (espera.reason === "maxMs") {
      paso.estado = "error";
      paso.detalle = `el equipo no volvió al prompt en ${maxMs} ms`;
      return {
        paso,
        escrito: comando,
        dialogo: null,
        endReason: "maxMs",

        motivo: "equipo_no_responde",
        motivoTexto:
          `El equipo no volvió al prompt en ${maxMs} ms tras '${comando}'. ` +
          "No se sigue con el resto del lote (el siguiente comando se lo comería lo que esté haciendo) y " +
          "no se da por aplicado nada: comprueba la consola con read_terminal antes de reintentar.",
      };
    }

    if (espera.reason === "pending") {
      paso.estado = "error";
      paso.detalle =
        `el equipo sigue esperando una respuesta (${espera.pending ?? "paginador"})` +
        (espera.paged ? ` tras ${espera.pages} página(s)` : "");
      return {
        paso,
        escrito: comando,
        dialogo: null,
        endReason: "pending",
        motivo: espera.paged ? "paginador_sin_respuesta" : "dialogo_desconocido",
        motivoTexto:
          (espera.paged
            ? `El paginador de '${comando}' dejó de responder al espacio`
            : `El equipo sigue esperando una respuesta a '${comando}'`) +
          `: "${espera.pending ?? "(sin texto)"}". Se corta el lote y se devuelve el estado al agente.`,
      };
    }

    if (espera.reason === "idle" && !this.isPromptReady(session)) {
      const margen = await this.esperarDialogoResuelto(
        session,
        perfil,
        CONFIG_ESPERA_SIN_PROMPT_MS,
      );
      if (margen.dialogo) {
        paso.estado = "dialogo";
        paso.detalle = `el equipo dejó el diálogo: "${margen.dialogo.texto}"`;
        return {
          paso,
          escrito: comando,
          dialogo: margen.dialogo,
          endReason: "dialogo",
          motivo: null,
          motivoTexto: null,
        };
      }
      if (!margen.resuelto) {
        paso.estado = "error";
        paso.detalle =
          "el equipo dejó de escribir pero no vuelve a mostrar prompt " +
          `(última línea: "${this.ultimaLinea(session) || "(vacía)"}")`;
        return {
          paso,
          escrito: comando,
          dialogo: null,
          endReason: "idle",
          motivo: "equipo_no_responde",
          motivoTexto:
            `Tras '${comando}' el equipo dejó de escribir sin volver al prompt (${margen.motivo}). ` +
            "No se sigue con el resto del lote (el siguiente comando se escribiría a ciegas) y no se da por " +
            "aplicado nada: comprueba la consola con read_terminal antes de reintentar.",
        };
      }
    }

    return { paso, escrito: comando, dialogo: null, endReason: espera.reason, motivo: null, motivoTexto: null };
  }

  private comandoRechazadoPorElEquipo(
    output: string,
    comando: string,
  ): string | null {
    const limpio = String(output ?? "").replace(ANSI_RE, "");
    const encontrado = limpio.match(COMANDO_RECHAZADO_RE);
    if (!encontrado) return null;

    const linea = limpio
      .split(/\r?\n/)
      .find((l) => COMANDO_RECHAZADO_RE.test(l));
    return (linea ?? encontrado[0]).replace(/\s+/g, " ").trim();
  }

  private async esperarConsolaLista(
    session: InternalSession,
    ctx: { presupuestoMs: number },
  ): Promise<EsperaPrompt> {
    const inicio = Date.now();
    let despertar: DespertarConsola | null = null;

    for (;;) {
      const restante = ctx.presupuestoMs - (Date.now() - inicio);
      if (restante <= 0) {
        return {
          ok: false,
          despertar,
          motivoFinal:
            `la consola no tuvo ${CONFIG_ESPERA_ESTABLE_MS} ms de silencio con prompt en ` +
            `${ctx.presupuestoMs} ms`,
          caida: !this.viveLaSesion(session),
        };
      }
      if (!this.viveLaSesion(session)) {
        return { ok: false, despertar, motivoFinal: MOTIVO_CAIDA, caida: true };
      }

      if (this.isPromptReady(session)) {
        const antes = this.ultimaLinea(session);
        await waitForOutput({
          read: () => this.ultimaLinea(session),
          idleMs: CONFIG_ESPERA_ESTABLE_MS,
          maxMs: restante,
          pollMs: DEFAULT_POLL_MS,
          requireOutput: false,
          abortOnPending: false,
          isAlive: () => this.viveLaSesion(session),
        });

        if (this.ultimaLinea(session) === antes && this.isPromptReady(session)) {
          return { ok: true, despertar, motivoFinal: null, caida: false };
        }
        continue;
      }

      const espera = await this.esperarPromptDespertando(session, restante);
      despertar = espera.despertar ?? despertar;
      if (espera.ok) return { ok: true, despertar, motivoFinal: null, caida: false };
      if (espera.caida) return { ok: false, despertar, motivoFinal: MOTIVO_CAIDA, caida: true };
      return {
        ok: false,
        despertar,
        motivoFinal:
          espera.motivoFinal ??
          `la consola no volvió al prompt en ${ctx.presupuestoMs} ms antes de escribir la línea`,
        caida: false,
      };
    }
  }

  private estadoSalidaDeConfig(
    perfil: VendorProfile,
    prompt: string | null,
    puntoDePartida: string | null,
  ): {
    legible: boolean;

    enConfig: boolean;

    enPuntoDePartida: boolean;

    seguro: boolean;
  } {
    const limpio = normalizePromptText(prompt);
    const objetivo = normalizePromptText(puntoDePartida);
    const legible = limpio.length > 0;
    const enConfig = legible && this.esPromptDeConfiguracion(perfil, limpio);
    const enPuntoDePartida = legible && objetivo.length > 0 && limpio === objetivo;
    return {
      legible,
      enConfig,
      enPuntoDePartida,
      seguro: enConfig && !enPuntoDePartida,
    };
  }

  private async salirDeConfigComprobando(
    session: InternalSession,
    ctx: {
      perfil: VendorProfile;
      linea: ConfigPlanLinea;
      idleMs: number;
      maxMs: number;

      yaEnviada: boolean;

      puntoDePartida: string | null;

      promptEnviada: string | null;
pasos: ConfigPaso[];
      executed: string[];
      salidas: string[];
    },
  ): Promise<{
    salio: boolean;
    intentos: number;
    aviso: string | null;

    causa: string | null;
  }> {
    const { perfil, linea, idleMs, maxMs, puntoDePartida } = ctx;
    const comando = linea.comando;
    const etq = perfil.label;
    let intentos = ctx.yaEnviada ? 1 : 0;

    for (;;) {
      const prompt = detectPrompt(session.recentBuffer);
      const estado = this.estadoSalidaDeConfig(perfil, prompt, puntoDePartida);

      if (!estado.enConfig || estado.enPuntoDePartida) {
        return {
          salio: true,
          intentos,
          aviso: null,
          causa:
            intentos > 1
              ? `${comando} necesitó ${intentos} envíos: ${etq} sube un nivel por envío y el lote ` +
                `había entrado en sub-modo (${ctx.promptEnviada ?? "?"} → ${prompt ?? "?"})`
              : null,
        };
      }

      if (!estado.seguro) {
        return {
          salio: false,
          intentos,
          aviso: this.avisoSalidaDeConfig(perfil, {
            comando,
            intentos,
            prompt,
            ultima: this.ultimaLinea(session),
            legible: false,
            salida: false,
            etq,
          }),
          causa: "el prompt de la consola no es legible, así que no se puede comprobar ni escribir",
        };
      }
      if (intentos >= CONFIG_SALIDA_INTENTOS_MAX) {
        return {
          salio: false,
          intentos,
          aviso: this.avisoSalidaDeConfig(perfil, {
            comando,
            intentos,
            prompt,
            ultima: this.ultimaLinea(session),
            legible: estado.legible,
            salida: true,
            etq,
          }),
          causa: `se agotaron los ${CONFIG_SALIDA_INTENTOS_MAX} envíos de '${comando}'`,
        };
      }

      const envio = await this.enviarLineaDeConfig(session, {
        perfil,
        linea,
        idleMs,
        maxMs,
      });
      ctx.pasos.push(envio.paso);
      if (envio.escrito) {
        ctx.executed.push(envio.escrito);
        if (envio.paso.output.trim()) ctx.salidas.push(envio.paso.output.trim());
        intentos += 1;
      }
      if (envio.dialogo || envio.motivo) {
        const promptFinal = detectPrompt(session.recentBuffer);
        return {
          salio: false,
          intentos,
          aviso: this.avisoSalidaDeConfig(perfil, {
            comando,
            intentos,
            prompt: promptFinal,
            ultima: this.ultimaLinea(session),
            legible: Boolean(promptFinal),
            salida: false,
            etq,
            extra: envio.motivoTexto ?? envio.dialogo?.motivo ?? null,
          }),
          causa: envio.motivoTexto ?? envio.dialogo?.motivo ?? "la consola pidió algo al salir",
        };
      }
    }
  }

  private avisoSalidaDeConfig(
    perfil: VendorProfile,
    ctx: {
      comando: string;
      intentos: number;
      prompt: string | null;
      ultima: string;
      legible: boolean;

      salida: boolean;
      etq: string;
      extra?: string | null;
    },
  ): string {
    const donde = this.nombreModoLegible(perfil, ctx.prompt);
    const veces = `${ctx.intentos} ${ctx.intentos === 1 ? "vez" : "veces"}`;
    const cabeza =
      ctx.salida && ctx.legible
        ? `La consola NO salió del modo configuración: '${ctx.comando}' se escribió ${veces} y el prompt ` +
          `sigue siendo "${ctx.prompt}" (${donde}). ${ctx.etq} sube un nivel por envío y el máximo del motor ` +
          `es ${CONFIG_SALIDA_INTENTOS_MAX}: no se insiste más.`
        : `No se pudo dejar la consola en un modo operable: el prompt está ` +
          `${ctx.legible ? `en "${ctx.prompt}" (${donde})` : `ilegible (última línea: "${ctx.ultima || "(vacía)"}")`} ` +
          `tras escribir '${ctx.comando}' ${veces}.`;
    return (
      `${cabeza} NO des el ciclo por cerrado ni verifiques nada más desde ahí: sal de ese modo a mano ` +
      `(envía '${ctx.comando}', que sube UN nivel por envío, hasta volver al modo en el que estaba la ` +
      `consola antes de configurar) y después comprueba con read_terminal.` +
      (ctx.extra ? ` Motivo del intento fallido: ${ctx.extra}` : "")
    );
  }

  private nombreModoLegible(perfil: VendorProfile, prompt: string | null): string {
    const limpio = normalizePromptText(prompt);
    if (!limpio) return "modo desconocido";
    const modo = this.modoDePrompt(perfil, limpio).modo;
    if (modo !== "config" && !perfil.prompt.isNested(limpio)) {
      if (modo === "privilegiado") return "modo privilegiado";
      if (modo === "usuario") return "modo usuario";
      return `modo no reconocido por el perfil de ${perfil.label}`;
    }

    const sub = limpio.match(/\((?:config[- ])?([^)]*)\)/)?.[1]?.trim().toLowerCase() ?? "";
    const nombre = NOMBRES_SUBMODO[sub];
    if (nombre) return sub ? `configuración de ${nombre}` : "configuración";
    return "sub-modo de configuración";
  }

  private evaluarDialogoConfig(
    perfil: VendorProfile,
    texto: string,
    fase: ConfigFase,
  ): ConfigDialogo | null {
    const cola = this.colaDeDialogo(texto);
    if (!cola.trim()) return null;

    if (detectPrompt(cola)) return null;
    if (!this.pareceDialogo(perfil, cola)) return null;

    const dialogos = perfil.dialogos;
    const ultima = this.ultimaLineaDeTexto(cola);

    if (detectarPaginador(cola).activo) return null;

    if (CONFIRMACION_DESTRUCTIVA_RE.test(cola) && INVITACION_RESPUESTA_RE.test(cola)) {
      return {
        texto: ultima,
        tipo: "destructiva",
        fase,
        patron: null,
        respuesta: "",
        motivo:
          "la confirmación es de algo destructivo (reload/erase/reboot/reset/factory-reset...): " +
          "el motor NUNCA la contesta, aunque el perfil la declare. Se aborta el lote y se devuelve al agente.",
      };
    }

    const global = cola.match(INVITACION_RESPUESTA_RE)?.[0] ?? null;
    if (global) {
      return {
        texto: ultima,
        tipo: "pregunta_al_usuario",
        fase,
        patron: global,
        respuesta: "",
        motivo:
          `la consola espera una respuesta del USUARIO ("${global}"): el motor no contesta confirmaciones ` +
          "a las que el agente no es quién debe responder. Se aborta el lote y se devuelve el diálogo.",
      };
    }
    const propio = dialogos.confirmacionPatrones.find((patron) => patron.test(cola));
    if (propio) {
      return {
        texto: ultima,
        tipo: "pregunta_al_usuario",
        fase,
        patron: propio.source,
        respuesta: "",
        motivo:
          `es una confirmación al usuario declarada por ${perfil.label} (${propio.source}): ` +
          "el motor se niega a contestarla y aborta el lote.",
      };
    }

    for (const legit of dialogos.confirmacionesLegitimas) {
      if (!legit.patron.test(cola)) continue;
      const respuesta =
        legit.respuesta !== undefined
          ? legit.respuesta
          : dialogos.respuestaConfirmacion;
      return {
        texto: ultima,
        tipo: "confirmacion_propia",
        fase,
        patron: legit.patron.source,
        respuesta,
        motivo:
          `confirmación propia de ${perfil.label}: ${legit.nota}. ` +
          (respuesta === ""
            ? 'Se responde con un Enter (valor por defecto), no con texto.'
            : `Se responde "${respuesta}".`),
      };
    }

    const arranque = dialogos.promptPatrones.find((patron) => patron.test(cola));
    if (arranque) {
      return {
        texto: ultima,
        tipo: "arranque",
        fase,
        patron: arranque.source,
        respuesta: "",
        motivo: perfil.abortKey
          ? `diálogo de arranque declarado por ${perfil.label} (${arranque.source}): no es una confirmación, ` +
            "así que se corta con la tecla de aborto del perfil en lugar de contestarlo."
          : `diálogo de arranque declarado por ${perfil.label} (${arranque.source}) y ${perfil.label} no ` +
            "declara tecla de aborto: no se puede cortar y no se contesta. Se aborta el lote.",
      };
    }

    return {
      texto: ultima,
      tipo: "desconocido",
      fase,
      patron: null,
      respuesta: "",
      motivo:
        `la consola se quedó esperando una respuesta que ${perfil.label} no explica ("${ultima.slice(0, 160)}"). ` +
        "El motor no contesta a lo que no entiende: se aborta el lote y se devuelve el diálogo.",
    };
  }

  private pareceDialogo(perfil: VendorProfile, cola: string): boolean {
    if (pendingInputReason(cola)) return true;
    if (INVITACION_RESPUESTA_RE.test(cola)) return true;
    const dialogos = perfil.dialogos;
    if (dialogos.confirmacionPatrones.some((p) => p.test(cola))) return true;
    if (dialogos.confirmacionesLegitimas.some((p) => p.patron.test(cola))) return true;
    if (dialogos.promptPatrones.some((p) => p.test(cola))) return true;

    const ultima = this.ultimaLineaDeTexto(cola);
    return /\?\s*$/.test(ultima) || /:\s*$/.test(ultima);
  }

  private async resolverDialogoConfig(
    session: InternalSession,
    ctx: {
      perfil: VendorProfile;
      dialogo: ConfigDialogo;
      linea: ConfigPlanLinea;
      idleMs: number;
      maxMs: number;
    },
  ): Promise<{
    ok: boolean;
    paso: ConfigPaso | null;

    respuesta: string | null;

    dialogo: ConfigDialogo | null;
    motivo: ConfigMotivoAborto | null;
    texto: string | null;
  }> {
    const { perfil, dialogo, linea, maxMs } = ctx;
    const abortar = (
      motivo: ConfigMotivoAborto,
      texto: string,
    ): {
      ok: boolean;
      paso: ConfigPaso | null;
      respuesta: string | null;
      dialogo: ConfigDialogo | null;
      motivo: ConfigMotivoAborto | null;
      texto: string | null;
    } => ({
      ok: false,
      paso: null,
      respuesta: null,
      dialogo,
      motivo,
      texto,
    });

    const cortar = async (texto: string): Promise<string> => {
      session.write(texto);
      const espera = await this.esperarDialogoResuelto(
        session,
        perfil,
        Math.min(maxMs, CONFIG_POST_DIALOGO_MS),
      );
      return espera.resuelto ? "" : espera.motivo ?? "";
    };

    if (dialogo.tipo === "confirmacion_propia") {
      const escrito = `${dialogo.respuesta}${perfil.eol}`;
      Logger.info({
        message:
          "[TerminalSessionHub] Se responde una confirmación que el perfil declara como propia.",
        data: {
          socketId: session.socketId,
          vendor: perfil.id,
          dialogo: dialogo.texto,
          respuesta: dialogo.respuesta || "(Enter)",
        },
      });
      try {
        session.write(escrito);
      } catch (error) {
        return abortar(
          "sesion_caida",
          `La sesión de terminal se cayó al responder el diálogo "${dialogo.texto}": ` +
            `${error instanceof Error ? error.message : String(error)}.`,
        );
      }
      const espera = await this.esperarDialogoResuelto(
        session,
        perfil,
        Math.min(maxMs, CONFIG_POST_DIALOGO_MS),
      );
      if (!espera.resuelto) {
        return {
          ok: false,
          paso: {
            ...linea,
            estado: "error",
            output: "",
            paged: false,
            pages: 0,
            detalle: `se respondió el diálogo y la consola siguió esperando`,
          },
          respuesta: escrito,
          dialogo: espera.dialogo ?? dialogo,
          motivo: "dialogo_desconocido",
          texto:
            `Se respondió el diálogo "${dialogo.texto}" con la respuesta que declara ${perfil.label} y el ` +
            `equipo siguió esperando${espera.motivo ? ` (${espera.motivo})` : ""}: no se insiste y se aborta el lote.`,
        };
      }
      return {
        ok: true,
        paso: null,
        respuesta: escrito,
        dialogo: null,
        motivo: null,
        texto: null,
      };
    }

    if (dialogo.tipo === "arranque") {
      if (!perfil.abortKey) {
        return abortar(
          "dialogo_desconocido",
          `${dialogo.motivo} El lote se aborta y el diálogo se devuelve al agente.`,
        );
      }
      const fallo = await cortar(perfil.abortKey);
      if (fallo) {
        return abortar(
          "dialogo_desconocido",
          `Se intentó cortar el diálogo "${dialogo.texto}" con la tecla de aborto de ${perfil.label} ` +
            `y la consola siguió esperando${fallo ? ` (${fallo})` : ""}: el lote se aborta y se devuelve el diálogo.`,
        );
      }
      Logger.info({
        message:
          "[TerminalSessionHub] Diálogo de arranque cortado con la tecla de aborto del perfil.",
        data: { socketId: session.socketId, vendor: perfil.id, dialogo: dialogo.texto },
      });
      return { ok: true, paso: null, respuesta: null, dialogo: null, motivo: null, texto: null };
    }

    if (dialogo.tipo === "pregunta_al_usuario") {
      return abortar("pregunta_al_usuario", `${dialogo.motivo}`);
    }
    if (dialogo.tipo === "destructiva") {
      return abortar("confirmacion_destructiva", `${dialogo.motivo}`);
    }
    return abortar("dialogo_desconocido", `${dialogo.motivo}`);
  }

  private async esperarDialogoResuelto(
    session: InternalSession,
    perfil: VendorProfile,
    presupuestoMs: number,
  ): Promise<{
    resuelto: boolean;

    dialogo: ConfigDialogo | null;
    motivo: string | null;
  }> {
    const desde = session.recentBuffer.length;
    const inicio = Date.now();
    for (;;) {
      const nuevo = session.recentBuffer.slice(desde);
      if (nuevo.length > 0 && this.isPromptReady(session)) {
        return { resuelto: true, dialogo: null, motivo: null };
      }
      const pendiente = this.evaluarDialogoConfig(perfil, nuevo, "guardar");
      if (pendiente) {
        return {
          resuelto: false,
          dialogo: pendiente,
          motivo: `sigue pendiente: "${pendiente.texto.slice(0, 120)}"`,
        };
      }
      if (Date.now() - inicio >= presupuestoMs) {
        return {
          resuelto: false,
          dialogo: null,
          motivo:
            nuevo.trim().length === 0
              ? `la consola no escribió nada en ${presupuestoMs} ms`
              : `la consola no volvió al prompt en ${presupuestoMs} ms`,
        };
      }
      await delay(DEFAULT_POLL_MS);
    }
  }

  private esPromptDeConfiguracion(perfil: VendorProfile, prompt: string | null): boolean {
    const limpio = normalizePromptText(prompt);
    if (!limpio) return false;
    return perfil.prompt.isNested(limpio) || perfil.prompt.config.test(limpio);
  }

  private modoDePrompt(
    perfil: VendorProfile,
    prompt: string | null,
  ): { modo: ConfigModo; indeterminado: boolean } {
    const limpio = normalizePromptText(prompt);
    if (!limpio) return { modo: "desconocido", indeterminado: true };
    if (perfil.prompt.config.test(limpio)) {

      const indistinguible =
        perfil.prompt.config.source === perfil.prompt.enable.source &&
        perfil.prompt.enable.source === perfil.prompt.user.source;
      return { modo: "config", indeterminado: indistinguible };
    }
    if (perfil.prompt.enable.test(limpio)) {
      return { modo: "privilegiado", indeterminado: false };
    }
    if (perfil.prompt.user.test(limpio)) {
      return { modo: "usuario", indeterminado: false };
    }
    return { modo: "desconocido", indeterminado: true };
  }

  private colaDeDialogo(texto: string): string {
    const limpio = String(texto ?? "").replace(ANSI_RE, "");
    return limpio.length > CONFIG_DIALOGO_COLA_CHARS
      ? limpio.slice(-CONFIG_DIALOGO_COLA_CHARS)
      : limpio;
  }

  private ultimaLineaDeTexto(texto: string): string {
    const lineas = texto
      .split(/\r?\n/)
      .map((linea) => linea.replace(ANSI_RE, "").replace(/\r/g, "").trim())
      .filter(Boolean);
    return lineas.length > 0 ? lineas[lineas.length - 1] : "";
  }

  stopKeepalive(): void {
    if (!this.keepaliveTimer) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) return;
    const timer = setInterval(() => this.keepaliveTick(), KEEPALIVE_INTERVAL_MS);

    (timer as unknown as { unref?: () => void }).unref?.();
    this.keepaliveTimer = timer;
  }

  private maybeStopKeepalive(): void {
    if (this.sessions.size === 0) this.stopKeepalive();
  }

  private keepaliveTick(): void {
    if (this.sessions.size === 0) {
      this.stopKeepalive();
      return;
    }
    for (const session of this.sessions.values()) {
      if (!this.isAlive(session) || session.busy) continue;
      if (!shouldKeepalive(session.recentBuffer)) continue;

      if (Date.now() - session.lastUserInputAt <= USER_INPUT_QUIET_MS) continue;
      try {

        session.write(INTERACTIVE_EOL);
      } catch {

      }
    }
  }

  private appendToLines(session: InternalSession, chunk: string): void {
    const partes = (session.lineCarry + chunk).split("\n");
    session.lineCarry = (partes.pop() ?? "").replace(/\r$/, "");
    for (const parte of partes) {
      session.lines.push(parte.replace(/\r$/, ""));
    }
    if (session.lines.length > MAX_SNAPSHOT_LINES) {
      session.lines.splice(0, session.lines.length - MAX_SNAPSHOT_LINES);
    }
  }

  private isPromptReady(
    session: InternalSession,
    expected?: string,
  ): boolean {
    const prompt = detectPrompt(session.recentBuffer);
    if (!prompt) return false;
    if (pendingInputReason(session.recentBuffer) !== null) return false;
    if (!expected) return true;

    return promptSatisfies(this.resolveVendor(session, prompt), prompt, expected);
  }

  private resolveVendor(
    session: InternalSession | null | undefined,
    prompt: string | null,
  ): VendorProfile {
    if (!session) return resolveVendorProfile({ prompt });

    const porTipo = resolveVendorProfile({
      typeDevice: session.typeDevice,
      prompt: null,
    });
    if (porTipo.id !== "conservative") {
      session.vendor = porTipo;
      return porTipo;
    }

    const detectado = detectVendorIdFromPrompt(prompt);
    if (detectado && detectado !== "conservative") {
      const perfil = getVendorProfile(detectado);
      session.vendor = perfil;
      return perfil;
    }

    return session.vendor ?? CONSERVADOR;
  }

  private abreLaSesion(command: string, profile: VendorProfile): boolean {
    const cmd = String(command ?? "").trim();
    if (CLOSING_COMMAND_RE.test(cmd)) return true;
    const transicion = profile.transiciones.aUsuario;
    if (!transicion) return false;
    const forma = transicion.trim().toLowerCase();
    return cmd.toLowerCase() === forma && OPENING_COMMAND_RE.test(forma);
  }

  private preflightActivo(
    session: InternalSession,
    op?: TerminalPreflightOptions | false,
  ): boolean {
    if (op === false) return false;
    if (op?.enabled === false) return false;
    if (op?.enabled === true) return true;
    return session.preflightEnabled && this.preflightDefault;
  }

  private presupuestoPreflight(
    op: TerminalPreflightOptions | false | undefined,
    idleMs: number,
    maxMs: number,
  ): number {
    const pedido =
      op && typeof op === "object" && Number.isFinite(op.timeoutMs)
        ? Number(op.timeoutMs)
        : PREFLIGHT_DEFAULT_MS;
    return Math.max(
      0,
      Math.min(pedido, Math.max(0, maxMs - idleMs), PREFLIGHT_MAX_MS),
    );
  }

  private async exigirPromptAntesDeEnviar(
    session: InternalSession,
    options: TerminalRunOptions | undefined,
    idleMs: number,
    maxMs: number,
  ): Promise<{ waitedMs: number; despertar: DespertarConsola | null }> {
    if (!this.preflightActivo(session, options?.preflight)) {
      return { waitedMs: 0, despertar: null };
    }

    const presupuesto = this.presupuestoPreflight(options?.preflight, idleMs, maxMs);
    const inicio = Date.now();
    const espera = await this.esperarPromptDespertando(session, presupuesto);
    const waitedMs = Date.now() - inicio;
    if (espera.ok) return { waitedMs, despertar: espera.despertar };

    const usuarioEscribiendo =
      Date.now() - session.lastUserInputAt <= USER_INPUT_QUIET_MS;
    if (usuarioEscribiendo) {
      Logger.info({
        message:
          "[TerminalSessionHub] Pre-flight sin prompt, pero el usuario está usando la consola: no se bloquea su sesión.",
        data: { socketId: session.socketId, waitedMs, despertar: espera.despertar },
      });
      return { waitedMs, despertar: espera.despertar };
    }

    const caida = espera.caida || espera.motivoFinal === MOTIVO_CAIDA;
    const diag = diagnosticarSinPrompt(session.recentBuffer, { caida });
    const ultima = diag.ultimaLinea;
    Logger.warning({
      message:
        "[TerminalSessionHub] Pre-flight: no se envía nada porque la consola no tiene prompt.",
      data: {
        socketId: session.socketId,
        waitedMs,
        motivo: diag.motivo,
        pendiente: diag.pendiente,
        ultima,
        despertar: espera.despertar,
      },
    });

    const intentoDespertar =
      (espera.despertar?.intentos ?? 0) > 0
        ? ` Se le mandaron ${espera.despertar?.intentos} Return(s) para despertarla y el prompt siguió sin aparecer.`
        : " No se mandó ningún Return: el equipo no pide ninguna tecla de arranque " +
          "(y con un login pendiente no se manda NADA, porque la respuesta es del usuario).";
    throw new TerminalPreFlightError(
      `No se envió ningún comando: la consola no tiene un prompt listo (se esperaron ${presupuesto} ms, ` +
        `motivo: ${diag.motivo}).` +
        intentoDespertar +
        (diag.pendiente
          ? ` El equipo está pidiendo una respuesta ("${diag.pendiente}");`
          : "") +
        ` última línea de la consola: "${ultima || "(vacía)"}".` +
        ` ${diag.consejo}`,
      diag,
      espera.despertar,
    );
  }

  private async esperarPromptDespertando(
    session: InternalSession,
    presupuestoMs: number,
    expected?: string,
  ): Promise<EsperaPrompt> {
    if (this.isPromptReady(session, expected)) {
      return { ok: true, despertar: null, motivoFinal: null, caida: false };
    }

    const inicio = Date.now();

    const minSondeos = presupuestoMs > 0 ? WAIT_PROMPT_MIN_POLLS : 1;

    const reserva = Math.min(
      DESPERTAR_ESPERA_POR_INTENTO_MS * DESPERTAR_INTENTOS_MAX,
      Math.floor(presupuestoMs / 2),
    );
    let intentos = 0;
    let sondeos = 0;

    for (;;) {
      const transcurrido = Date.now() - inicio;
      const restante = presupuestoMs - transcurrido;

      const caida = !this.viveLaSesion(session);
      if ((caida || restante <= 0) && sondeos >= minSondeos) {
        return {
          ok: false,
          despertar: this.diagnosticoDespertar(
            intentos,
            intentos > 0
              ? `no apareció el prompt ni después de mandar ${intentos} Return(s) para despertar la consola`
              : caida
                ? "la sesión de terminal se cerró antes de tiempo"
                : "no apareció el prompt",
          ),
          motivoFinal: caida ? MOTIVO_CAIDA : null,
          caida,
        };
      }

      if (
        this.debeDespertar(session, {
          presupuestoMs,
          transcurrido,
          reserva,
          intentos,
          restante,
        })
      ) {
        this.despertarConsola(session);
        intentos += 1;
      }

      await waitForOutput({

        read: () => this.ultimaLinea(session),
        idleMs: PREFLIGHT_IDLE_MS,
        maxMs: Math.max(1, restante),
        pollMs: DEFAULT_POLL_MS,
        requireOutput: false,
        abortOnPending: false,
        isAlive: () => this.viveLaSesion(session),
      });
      sondeos += 1;
      if (this.isPromptReady(session, expected)) {
        return {
          ok: true,
          despertar: this.diagnosticoDespertar(intentos, null),
          motivoFinal: null,
          caida: false,
        };
      }
    }
  }

  private debeDespertar(
    session: InternalSession,
    ctx: {
      presupuestoMs: number;
      transcurrido: number;
      reserva: number;
      intentos: number;
      restante: number;
    },
  ): boolean {
    if (ctx.intentos >= DESPERTAR_INTENTOS_MAX) return false;
    if (!this.viveLaSesion(session)) return false;

    if (Date.now() - session.lastUserInputAt <= USER_INPUT_QUIET_MS) return false;

    const espera = clasificarEsperaDeEntrada(session.recentBuffer);

    if (espera.pregunta) return false;

    if (espera.invariante) return ctx.restante >= DESPERTAR_ESPERA_MINIMA_MS;

    if (!espera.hayTexto) return false;
    if (ctx.transcurrido < Math.max(0, ctx.presupuestoMs - ctx.reserva)) return false;
    return ctx.restante >= DESPERTAR_ESPERA_POR_INTENTO_MS;
  }

  private despertarConsola(session: InternalSession): void {
    try {
      session.write(INTERACTIVE_EOL);
    } catch (error) {
      Logger.warning({
        message:
          "[TerminalSessionHub] No se pudo despertar la consola: sesión caída.",
        data: {
          socketId: session.socketId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private diagnosticoDespertar(
    intentos: number,
    motivoFinal: string | null,
  ): DespertarConsola | null {
    if (intentos === 0 && motivoFinal === null) return null;
    return { intentos, motivoFinal };
  }

  private ultimaLinea(session: InternalSession): string {
    const carry = session.lineCarry.trim();
    if (carry) return carry;
    for (let i = session.lines.length - 1; i >= 0; i--) {
      const linea = session.lines[i].trim();
      if (linea) return linea;
    }
    return "";
  }

  private sinPromptFinal(texto: string): string {
    const prompt = detectPrompt(texto);
    if (!prompt) return texto;
    const lineas = texto.split("\n");
    for (let i = lineas.length - 1; i >= 0; i -= 1) {
      const limpia = lineas[i].replace(ANSI_RE, "").replace(/\r/g, "").trim();
      if (!limpia) continue;
      if (limpia !== prompt) return texto;
      const resto = lineas.slice(0, i).join("\n");
      return resto.trim() ? resto : texto;
    }
    return texto;
  }

  private mensajePromptNoVisto(
    session: InternalSession,
    expected: string | undefined,
    timeoutMs: number,
    caida: boolean,
    despertar: DespertarConsola | null,
  ): string {
    const real = detectPrompt(session.recentBuffer);
    const pendiente = pendingInputReason(session.recentBuffer);

    const diag = diagnosticarSinPrompt(session.recentBuffer, { caida });
    const motivo = caida
      ? "la sesión de terminal se cerró antes de tiempo"
      : `no apareció el prompt esperado en ${timeoutMs} ms`;

    const intento = despertar && despertar.intentos > 0
      ? `; se mandaron ${despertar.intentos} Return(s) para despertar la consola y el prompt siguió sin aparecer`
      : "";
    return (
      `waitForPrompt: ${motivo}${expected ? ` (se esperaba "${expected}")` : ""} ` +
      `[motivo: ${diag.motivo}]. ` +
      `Prompt real de la consola: ${real ? `"${real}"` : "ninguno (no termina en prompt)"}; ` +
      `última línea: "${diag.ultimaLinea || "(vacía)"}"` +
      (pendiente ? `; el equipo espera una respuesta ("${pendiente}")` : "") +
      intento +
      `. ${diag.consejo}`
    );
  }

  private normalizeWaitTimeout(timeoutMs?: number): number {
    const valor =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? timeoutMs
        : WAIT_PROMPT_DEFAULT_MS;
    return Math.min(Math.max(valor, 0), WAIT_PROMPT_MAX_MS);
  }

  private aliveSessionsOf(userId: string): InternalSession[] {
    return [...this.sessions.values()].filter(
      (session) => session.userId === userId && this.isAlive(session),
    );
  }

  private buildSnapshot(session: InternalSession): TerminalSessionSnapshot {
    const lastLines = [...session.lines];
    if (session.lineCarry.trim()) lastLines.push(session.lineCarry);
    const prompt = detectPrompt(session.recentBuffer);
    const viva = this.viveLaSesion(session);

    const diag =
      prompt && pendingInputReason(session.recentBuffer) === null
        ? null
        : diagnosticarSinPrompt(session.recentBuffer, { caida: !viva });
    return {
      sessionId: session.socketId,
      protocol: session.protocol,
      deviceName: session.deviceName,
      providerId: session.providerId,
      fingerprint: session.fingerprint,
      alive: this.isAlive(session),
      busy: session.busy,
      prompt,
      lastLines: lastLines.slice(-MAX_SNAPSHOT_LINES),
      vendor: this.resolveVendor(session, prompt).id,
      promptWaitMessage: null,
      despertar: null,
      motivoSinPrompt: diag?.motivo ?? null,
      pendiente: diag?.pendiente ?? null,
      ultimaLinea: session.lineCarry.trim() || lastLines[lastLines.length - 1] || null,
    };
  }

  private buildSnapshotFromRegistration(
    session: TerminalSession,
  ): TerminalSessionSnapshot {
    return {
      sessionId: session.socketId,
      protocol: session.protocol,
      deviceName: session.deviceName,
      providerId: session.providerId,
      fingerprint: session.fingerprint,
      alive: false,
      busy: false,
      prompt: null,
      lastLines: [],
      vendor: resolveVendorProfile({ typeDevice: session.typeDevice }).id,
      promptWaitMessage: null,
      despertar: null,
      motivoSinPrompt: "sesion_caida",
      pendiente: null,
      ultimaLinea: null,
    };
  }

  private async waitForCapture(
    session: InternalSession,
    idleMs: number,
    maxMs: number,
    alCorte?: (buffer: string) => WaitEndReason | null,
  ): Promise<WaitForOutputResult & CapturaPaginada> {
    const pollMs = DEFAULT_POLL_MS;
    const inicio = Date.now();
    let ultimoCambio = inicio;
    let huella = this.huellaProgreso(session.captureBuffer);

    let venceProgreso = 0;

    let largoAlPagar = 0;

    let pagosSinProgreso = 0;
    let pages = 0;
    let pagerVariant: PaginadorVariante | null = null;

    for (;;) {
      const buffer = session.captureBuffer;
      const ahora = Date.now();
      const transcurrido = ahora - inicio;
      const actual = this.huellaProgreso(buffer);
      if (actual !== huella) {
        huella = actual;
        ultimoCambio = ahora;
      }

      if (
        venceProgreso !== 0 &&
        buffer.length - largoAlPagar >= PAGINADOR_PROGRESO_MIN_CHARS
      ) {
        venceProgreso = 0;
        pagosSinProgreso = 0;
      }
      const silencio = ahora - ultimoCambio;

      const cerrar = (
        reason: WaitEndReason,
        pending: string | null = null,
      ): WaitForOutputResult & CapturaPaginada => ({
        output: buffer,
        reason,
        pending,
        elapsedMs: transcurrido,
        paged: pages > 0,
        pages,
        pagerVariant,
      });

      if (!this.viveLaSesion(session)) return cerrar("dead");

      const deteccion = this.paginadorPendiente(session);

      const paginando = deteccion.activo && this.paginarEsSeguro(session);
      if (paginando) {
        if (!pagerVariant) pagerVariant = deteccion.variante;
        if (venceProgreso === 0) {
          if (pages >= PAGINADOR_MAX_PAGINAS) {
            Logger.warning({
              message:
                "[TerminalSessionHub] Se agotaron las páginas del paginador: la salida puede estar incompleta.",
              data: {
                socketId: session.socketId,
                pages,
                variante: deteccion.variante,
                marca: deteccion.marca,
              },
            });
            return cerrar("pending", deteccion.marca);
          }
          this.pagarPagina(session);
          pages += 1;
          largoAlPagar = buffer.length;
          pagosSinProgreso = 0;

          venceProgreso = ahora + Math.max(PAGINADOR_SETTLE_MS, idleMs);
        } else if (ahora >= venceProgreso) {

          pagosSinProgreso += 1;
          if (pagosSinProgreso >= PAGINADOR_INTENTOS_SIN_PROGRESO) {
            Logger.warning({
              message:
                "[TerminalSessionHub] El paginador no respondió al espacio: se deja de paginar.",
              data: { socketId: session.socketId, pages, marca: deteccion.marca },
            });
            return cerrar("pending", deteccion.marca);
          }
          venceProgreso = ahora + Math.max(PAGINADOR_SETTLE_MS, idleMs);
        }
      }

      if (!paginando && alCorte) {
        const motivo = alCorte(buffer);
        if (motivo) {
          return cerrar(motivo, motivo === "dialogo" ? this.ultimaLinea(session) : null);
        }
      }
      if (!paginando && buffer.length > 0 && silencio >= idleMs) {
        return cerrar("idle");
      }
      if (transcurrido >= maxMs) return cerrar("maxMs");
      await delay(pollMs);
    }
  }

  private viveLaSesion(session: InternalSession): boolean {
    return (
      this.isAlive(session) && this.sessions.get(session.socketId) === session
    );
  }

  private pagarPagina(session: InternalSession): void {
    try {
      session.write(PAGINADOR_KEY);
    } catch (error) {

      Logger.warning({
        message: "[TerminalSessionHub] No se pudo pagar el paginador: sesión caída.",
        data: {
          socketId: session.socketId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private paginadorPendiente(session: InternalSession): DeteccionPaginador {
    const buffer = session.captureBuffer;
    if (detectPrompt(buffer)) return { activo: false, variante: null, marca: null };
    return detectarPaginador(
      buffer.length > PAGINADOR_TAIL_CHARS
        ? buffer.slice(-PAGINADOR_TAIL_CHARS)
        : buffer,
    );
  }

  private paginarEsSeguro(session: InternalSession): boolean {
    const pendiente = pendingInputReason(session.captureBuffer);
    if (pendiente === null) return true;
    return detectarPaginador(pendiente).activo;
  }

  private huellaProgreso(buffer: string): string {
    return `${buffer.length}:${buffer.slice(-PROGRESO_COLA_CHARS)}`;
  }

  private isAlive(session: InternalSession): boolean {
    try {
      return session.isAlive();
    } catch {
      return false;
    }
  }

  private toPublic(session: InternalSession): TerminalSession {
    const {
      capturing: _capturing,
      captureBuffer: _captureBuffer,
      busy: _busy,
      recentBuffer: _recentBuffer,
      lines: _lines,
      lineCarry: _lineCarry,
      lastUserInputAt: _lastUserInputAt,
      vendor: _vendor,
      preflightEnabled: _preflight,
      ...publicSession
    } = session;
    return publicSession;
  }
}

export const terminalSessionHub = new TerminalSessionHub();
