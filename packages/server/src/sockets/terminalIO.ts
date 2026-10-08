export type TerminalTransport = "SSH" | "TELNET" | "SERIAL";

export const TERMINAL_EOL: Readonly<Record<TerminalTransport, string>> = {
  SSH: "\r",
  TELNET: "\r\n",
  SERIAL: "\r\n",
};

export const INTERACTIVE_EOL = "\r";

export function eolFor(protocol: string | null | undefined): string {
  const clave = String(protocol ?? "").trim().toUpperCase();
  if (clave === "SSH") return TERMINAL_EOL.SSH;
  if (clave === "SERIAL") return TERMINAL_EOL.SERIAL;
  return TERMINAL_EOL.TELNET;
}

export const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export const PENDING_PROMPT_RE =
  /(--\s*more\s*--|-{2,}\s*\(\s*more\s*\)\s*-{2,}|-\s*more\s*-|\[\s*q\s*[|\s]\s*quit\s*\]|\(\s*end\s*\)\s*$|\[confirm\]|password\s*:|\(y\/n\)|\[y\/n\]|yes\/no|yes\s*,\s*no|continue\?)/im;

const PENDING_TAIL_CHARS = 240;

export const PAGINADOR_KEY = " ";

export const PAGINADOR_TAIL_CHARS = 400;

export type PaginadorVariante =
  | "q-quit"
  | "press-space"
  | "chino"
  | "mas-more-paren"
  | "mas-more"
  | "guion-more"
  | "end";

const PAGINADOR_VARIANTES: readonly (readonly [PaginadorVariante, RegExp])[] = [

  ["q-quit", /\[\s*q\s*[|\s]\s*quit\s*\]/i],

  [
    "press-space",
    /press\s+(?:space\b|q\s+to\s+stop\b)[^\n.]{0,60}?(?:continue|next\s+page)/i,
  ],

  ["chino", /按\s*(?:enter|回车|空格|任意键)[^\n]{0,12}继续/i],

  ["mas-more-paren", /-{2,}\s*\(\s*more\s*\)\s*-{2,}/i],

  ["mas-more", /-{2,}\s*more\s*-{2,}/i],

  ["guion-more", /-\s*more\s*-/i],

  ["end", /\(\s*end\s*\)\s*$/i],
];

export interface DeteccionPaginador {

  activo: boolean;

  variante: PaginadorVariante | null;

  marca: string | null;
}

export function detectarPaginador(texto: string): DeteccionPaginador {
  const bruto = String(texto ?? "");
  if (!bruto) return { activo: false, variante: null, marca: null };
  const limpio = bruto.replace(ANSI_RE, "");
  if (!limpio.trim()) return { activo: false, variante: null, marca: null };
  const cola =
    limpio.length > PAGINADOR_TAIL_CHARS
      ? limpio.slice(-PAGINADOR_TAIL_CHARS)
      : limpio;
  for (const [variante, re] of PAGINADOR_VARIANTES) {
    const found = cola.match(re);
    if (found) return { activo: true, variante, marca: found[0] };
  }
  return { activo: false, variante: null, marca: null };
}

export function limpiarMarcasPaginador(texto: string): string {
  return String(texto ?? "")
    .replace(/-{2,}\s*\(\s*more\s*\)\s*-{2,}/gi, "")
    .replace(/-{2,}\s*more\s*-{2,}/gi, "")
    .replace(/-\s*more\s+-/gi, "")
    .replace(/\[\s*q\s*[|\s]\s*quit\s*\]/gi, "");
}

export function pendingInputReason(raw: string): string | null {
  const texto = String(raw ?? "");
  if (!texto) return null;
  const cola =
    texto.length > PENDING_TAIL_CHARS ? texto.slice(-PENDING_TAIL_CHARS) : texto;
  const found = cola.replace(ANSI_RE, "").match(PENDING_PROMPT_RE);
  return found ? found[0].trim() : null;
}

export type MotivoCorte =
  | "eco"
  | "sin_comando"
  | "sin_eco"
  | "eco_sin_salida"
  | "eco_solo_prompt";

export interface ResultadoCortePorEco {

  texto: string;

  recortado: boolean;

  motivo: MotivoCorte;
}

const ANSI_SECUENCIA_RE = new RegExp(ANSI_RE.source, "g");

const CARACTER_PALABRA_RE = /[A-Za-z0-9_./:-]/;

const PROMPT_MAX_CHARS_ECHO = 120;

const EMPIEZA_SALTO_RE = /^[\r\n]/;

const ESPACIO_EN_LINEA_RE = /[ \t]/;

export function colapsarEspacios(valor: string): string {
  return String(valor ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function finDeSecuenciaAnsi(texto: string, i: number): number {
  ANSI_SECUENCIA_RE.lastIndex = i;
  const hallada = ANSI_SECUENCIA_RE.exec(texto);
  if (hallada && hallada.index === i) return i + hallada[0].length;
  return i;
}

function sinAnsiConMapa(bruto: string): { limpio: string; mapa: number[] } {
  const caracteres: string[] = [];
  const mapa: number[] = [];
  let i = 0;
  while (i < bruto.length) {
    if (bruto[i] === "\x1b") {
      const fin = finDeSecuenciaAnsi(bruto, i);
      if (fin > i) {
        i = fin;
        continue;
      }
    }
    caracteres.push(bruto[i]);
    mapa.push(i);
    i += 1;
  }
  return { limpio: caracteres.join(""), mapa };
}

function colapsarConMapa(texto: string): { plano: string; indices: number[] } {
  let plano = "";
  const indices: number[] = [];
  let ultimoBlanco = false;
  for (let i = 0; i < texto.length; i += 1) {
    if (/\s/.test(texto[i])) {
      if (plano === "" || ultimoBlanco) continue;
      plano += " ";
      indices.push(i);
      ultimoBlanco = true;
      continue;
    }
    plano += texto[i];
    indices.push(i);
    ultimoBlanco = false;
  }
  return { plano, indices };
}

function soloPromptDetras(cola: string): boolean {
  const lineas = cola
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim())
    .filter(Boolean);
  if (lineas.length !== 1) return false;
  const linea = lineas[0];
  if (linea.length > PROMPT_MAX_CHARS_ECHO) return false;
  if (PENDING_PROMPT_RE.test(linea)) return false;
  if (/[#>\]$%]\s*$/.test(linea)) return true;
  if (/^\[[^\]\n]*\]\s*$/.test(linea)) return true;
  if (/^\[[^\]\n]*@[^\]\n]*\]\s*\/\S+/.test(linea)) return true;
  return false;
}

export function recortarPorEco(texto: string, comando: string): ResultadoCortePorEco {
  const bruto = String(texto ?? "");
  const ancla = colapsarEspacios(comando);
  if (!ancla) return { texto: bruto, recortado: false, motivo: "sin_comando" };
  if (!bruto) return { texto: bruto, recortado: false, motivo: "sin_eco" };

  const { limpio, mapa } = sinAnsiConMapa(bruto);
  const { plano, indices } = colapsarConMapa(limpio);

  let descartadoPorSoloPrompt = false;

  for (
    let pos = plano.lastIndexOf(ancla);
    pos >= 0;
    pos = pos === 0 ? -1 : plano.lastIndexOf(ancla, pos - 1)
  ) {

    if (pos > 0 && CARACTER_PALABRA_RE.test(plano[pos - 1])) continue;

    let finEnLimpio = indices[pos + ancla.length - 1] + 1;
    while (finEnLimpio < limpio.length && ESPACIO_EN_LINEA_RE.test(limpio[finEnLimpio])) {
      finEnLimpio += 1;
    }

    if (!EMPIEZA_SALTO_RE.test(limpio.slice(finEnLimpio))) continue;

    const desdeBruto = mapa[finEnLimpio];
    const cola = bruto
      .slice(desdeBruto ?? bruto.length)
      .replace(/^[\r\n]+/, "");

    if (!cola.trim()) {
      return { texto: bruto, recortado: false, motivo: "eco_sin_salida" };
    }

    if (soloPromptDetras(cola)) {
      descartadoPorSoloPrompt = true;
      continue;
    }
    return { texto: cola, recortado: true, motivo: "eco" };
  }

  return {
    texto: bruto,
    recortado: false,
    motivo: descartadoPorSoloPrompt ? "eco_solo_prompt" : "sin_eco",
  };
}

const ESPERA_COLA_CHARS = 400;

export const INVARIANTE_ARRANQUE_RE =
  /(?:press\s+(?:return|enter)\b)|(?:press\s+any\s+key)|(?:hit\s+(?:the\s+)?(?:return|enter)\b)|(?:user\s+interface\s+\S+\s+is\s+(?:now\s+)?available)|(?:user access verification)|(?:system bootstrap)|(?:please wait(?:ing)?\b)|(?:autoconfiguration)/i;

export const INVITACION_RESPUESTA_RE =
  /(?:\[\s*(?:y\/n|yes\/no|confirm|confirmar)\s*\])|(?:\[\s*yes\s*,\s*no\s*\])|(?:yes\s*,\s*no\s*\(\s*(?:no|yes)\s*\))|(?:\(\s*y\/n\s*\))|(?:user\s?name\s*:)|(?:\blogin\s*:)|(?:password\s*:)|(?:passphrase\s*:)|(?:continue\?)|(?:are you sure)/i;

export interface EsperaDeEntrada {

  invariante: boolean;

  pregunta: string | null;

  hayTexto: boolean;
}

export function clasificarEsperaDeEntrada(texto: string): EsperaDeEntrada {
  const bruto = String(texto ?? "");

  const cola = sinAnsi(
    bruto.length > ESPERA_COLA_CHARS ? bruto.slice(-ESPERA_COLA_CHARS) : bruto,
  );
  if (!cola.trim()) {
    return { invariante: false, pregunta: null, hayTexto: false };
  }
  return {
    invariante: INVARIANTE_ARRANQUE_RE.test(cola),
    pregunta: cola.match(INVITACION_RESPUESTA_RE)?.[0].trim() ?? null,
    hayTexto: true,
  };
}

function sinAnsi(texto: string): string {
  return texto.replace(ANSI_RE, "");
}

export type MotivoSinPrompt =

  | "login_pendiente"

  | "arrancando"

  | "dialogo_pendiente"

  | "sin_salida"

  | "sesion_caida"

  | "desconocido";

export const PEDIR_CREDENCIAL_RE =
  /\b(?:login|user\s?name|username|user|pass\s?word|password|passphrase)\s*:\s*$/im;

const DIAGNOSTICO_COLA_CHARS = 400;

export interface DiagnosticoSinPrompt {

  motivo: MotivoSinPrompt;

  pendiente: string | null;

  invariante: string | null;

  ultimaLinea: string;

  hayTexto: boolean;

  consejo: string;
}

export function diagnosticarSinPrompt(
  texto: string,
  opciones: { caida?: boolean } = {},
): DiagnosticoSinPrompt {
  const bruto = String(texto ?? "");
  const cola = colaDiagnostico(bruto);
  const lineas = cola
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\r/g, "").trim())
    .filter(Boolean);
  const ultimaLinea = lineas.length > 0 ? lineas[lineas.length - 1] : "";
  const hayTexto = Boolean(cola.trim());
  const credencial = cola.match(PEDIR_CREDENCIAL_RE)?.[0]?.trim() ?? null;
  const invariante = cola.match(INVARIANTE_ARRANQUE_RE)?.[0]?.trim() ?? null;
  const pregunta = cola.match(INVITACION_RESPUESTA_RE)?.[0]?.trim() ?? null;

  const veredicto = (
    motivo: MotivoSinPrompt,
    consejo: string,
  ): DiagnosticoSinPrompt => ({
    motivo,
    pendiente: credencial ?? pregunta,
    invariante,
    ultimaLinea,
    hayTexto,
    consejo,
  });

  if (opciones.caida === true) {
    return veredicto(
      "sesion_caida",
      "La sesión de terminal se cerró antes de tiempo: no hay consola contra la que trabajar. " +
        "Comprueba que siga conectada con get_terminal_status y, si hace falta, pide al usuario que la vuelva a abrir.",
    );
  }
  if (credencial) {
    return veredicto(
      "login_pendiente",
      `La consola está pidiendo autenticación ("${credencial}") y el agente NUNCA teclea credenciales por ti: ` +
        "autentícate tú en la terminal y vuelve a intentarlo. Reintentar sin más no va a funcionar: " +
        "esperar solo deja el login más viejo en pantalla.",
    );
  }
  if (pregunta) {
    return veredicto(
      "dialogo_pendiente",
      `El equipo tiene un diálogo abierto ("${pregunta}") y la respuesta es tuya: contéstale en la terminal ` +
        "y reintenta. El motor no contesta diálogos por su cuenta.",
    );
  }
  if (invariante) {
    return veredicto(
      "arrancando",
      `El equipo todavía está arrancando (dice "${invariante}"): espera a que termine de arrancar y reintenta. ` +
        "Si se repite en varios intentos, mira la consola con read_terminal antes de insistir.",
    );
  }
  if (!hayTexto) {
    return veredicto(
      "sin_salida",
      "La consola no ha escrito nada, así que no hay prompt: lo normal es que el equipo esté apagado o sin vida. " +
        "Enciéndolo con la herramienta de encendido que corresponda (setPower en un nodo emulado, " +
        "controlGns3NodePower en GNS3) y espera a que vuelva a responder antes de reintentar. " +
        "Por telnet no existe auto-encendido: si la herramienta no lo enciende, hay que encenderlo a mano.",
    );
  }
  return veredicto(
    "desconocido",
    "No se puede saber por qué el equipo no da prompt: la consola muestra texto pero ninguna invitación reconocible " +
      `("${ultimaLinea || "línea vacía"}"). No se afirma ninguna causa porque no hay ninguna prueba en la salida; ` +
      "mira la consola con read_terminal antes de reintentar.",
  );
}

function colaDiagnostico(bruto: string): string {
  const limpio = sinAnsi(bruto);
  return limpio.length > DIAGNOSTICO_COLA_CHARS
    ? limpio.slice(-DIAGNOSTICO_COLA_CHARS)
    : limpio;
}

export const DEFAULT_IDLE_MS = 700;

export const DEFAULT_MAX_MS = 20_000;

export const DEFAULT_POLL_MS = 50;

export type WaitEndReason =

  | "idle"

  | "maxMs"

  | "pending"

  | "dead"

  | "dialogo";

export interface WaitForOutputOptions {

  read: () => string;
  idleMs?: number;
  maxMs?: number;
  pollMs?: number;

  requireOutput?: boolean;

  abortOnPending?: boolean;

  isAlive?: () => boolean;
}

export interface WaitForOutputResult {
  output: string;
  reason: WaitEndReason;

  pending: string | null;
  elapsedMs: number;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

function aliveOrFalse(isAlive: (() => boolean) | undefined): boolean {
  if (!isAlive) return true;
  try {
    return isAlive();
  } catch {
    return false;
  }
}

export function waitForOutput(
  options: WaitForOutputOptions,
): Promise<WaitForOutputResult> {
  const idleMs = clamp(options.idleMs, DEFAULT_IDLE_MS, 1, DEFAULT_MAX_MS);
  const maxMs = clamp(options.maxMs, DEFAULT_MAX_MS, 1, DEFAULT_MAX_MS * 10);
  const pollMs = clamp(options.pollMs, DEFAULT_POLL_MS, 10, 1_000);
  const requireOutput = options.requireOutput !== false;
  const abortOnPending = options.abortOnPending === true;

  return new Promise<WaitForOutputResult>((resolve) => {
    const start = Date.now();
    let lastLength = options.read().length;
    let lastChange = start;

    const interval = setInterval(() => {
      const output = options.read();
      const length = output.length;
      if (length !== lastLength) {
        lastLength = length;
        lastChange = Date.now();
      }
      const now = Date.now();
      const elapsed = now - start;
      const idleFor = now - lastChange;

      const finish = (reason: WaitEndReason, pending: string | null = null) => {
        clearInterval(interval);
        resolve({ output, reason, pending, elapsedMs: elapsed });
      };

      if (abortOnPending) {
        const pending = pendingInputReason(output);
        if (pending) return finish("pending", pending);
      }
      if (options.isAlive && !aliveOrFalse(options.isAlive)) {
        return finish("dead");
      }
      if ((!requireOutput || length > 0) && idleFor >= idleMs) {
        return finish("idle");
      }
      if (elapsed >= maxMs) return finish("maxMs");
    }, pollMs);
  });
}

export interface CommandOutcome {

  output: string;

  executed: string[];

  removed: string[];

  removedReason?: string | null;

  elapsedMs?: number;
}

export const REMOVED_REASON =
  "se descartó porque cerraría la sesión interactiva del usuario (salir de la consola que está viendo)";

export function removedNotice(removed: string[]): string {
  return `[aviso] No se enviaron ${removed.length} comando(s) que cerrarían la sesión: ${removed.join(", ")}.`;
}

export function resolveCommandOutput(
  outcome: CommandOutcome,
  ctx: { destino: string; transporte: string },
): string {
  const ejecutados = outcome.executed ?? [];
  const descartados = outcome.removed ?? [];
  const salida = String(outcome.output ?? "");

  if (ejecutados.length === 0) {
    const motivo = descartados.length
      ? ` Se descartaron por seguridad: ${descartados.join(", ")}.`
      : " El lote estaba vacío o solo contenía líneas en blanco.";
    throw new Error(
      `No se ejecutó ningún comando en ${ctx.transporte} ${ctx.destino}.${motivo}`,
    );
  }

  if (!salida.trim()) {
    throw new Error(
      `Salida vacía: ${ctx.transporte} ${ctx.destino} no devolvió nada en ${outcome.elapsedMs ?? 0} ms tras [${ejecutados.join(", ")}]. No se puede confirmar que el comando se ejecutara.`,
    );
  }

  return descartados.length
    ? `${removedNotice(descartados)}\n${salida}`
    : salida;
}
