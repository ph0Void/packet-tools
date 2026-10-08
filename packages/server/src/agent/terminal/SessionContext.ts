import { terminalSessionHub } from "@/sockets/TerminalSessionHub";
import { envConfig } from "@/config/EnvConfig";
import { requestContext } from "@/utils/RequestContext";
import { sanitizarConsola } from "@/utils/TerminalSanitizer";

const BLOQUE_SIN_CONSOLA = [
  "## Terminal activa",
  "- No hay ninguna consola conectada. Si el usuario pide operar sobre un equipo, indícalo y espera a que conecte la consola; no abras conexiones propias.",
].join("\n");

const BLOQUE_CONEXION_SIN_CONSOLA = [
  "## Conexión seleccionada sin consola",
  "- El usuario seleccionó un dispositivo como conexión objetivo, pero no hay una consola abierta para él.",
  "- NO abras conexiones directas ni operes sobre otra consola: pide al usuario que conecte la consola del dispositivo y espera.",
].join("\n");

const FENCE = "```";

type SnapshotTerminal = {
  sessionId: string;
  deviceName: string | null;
  protocol: string | null;
  alive: boolean;
  prompt: string | null;
  lastLines: string[];
  vendor?: string | null;
};

function terminalContextLinesDesdeStore(): number {
  const ctx = requestContext.getStore() as
    | (Record<string, unknown> & { terminalContextLines?: unknown })
    | undefined;
  const valor = ctx?.terminalContextLines;
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? Math.floor(valor)
    : 0;
}

function resolveSnapshot() {
  const ctx = requestContext.getStore();
  if (!ctx) return null;

  const providerId = ctx.connectionProviderId ?? null;
  const conConexion = !!providerId;

  let snapshot = ctx.terminalSessionId
    ? terminalSessionHub.getSnapshotForUser(ctx.id, ctx.terminalSessionId)
    : null;

  if (!snapshot && providerId) {
    const match = terminalSessionHub.findMatch(
      ctx.id,
      providerId,
      ctx.connectionFingerprint ?? null,
    );
    if (match) {
      snapshot = terminalSessionHub.getSnapshotForUser(ctx.id, match.socketId);
    }
  }

  if (!snapshot && !conConexion && ctx.terminalSessionId) {
    snapshot = terminalSessionHub.getActiveSnapshot(ctx.id);
  }

  return snapshot;
}

function buildEstadoTerminal(
  snapshot: SnapshotTerminal,
  conHerramientasTerminal: boolean,
): string {
  const maxLineas = terminalContextLinesDesdeStore();
  const reglaLectura = conHerramientasTerminal
    ? "- Antes de enviar comandos usa 'get_terminal_status' o 'read_terminal' para leer el estado/prompt."
    : "- Tu toolset NO incluye las tools de terminal ('get_terminal_status', 'read_terminal', 'send_command'): no las llames; el snapshot de arriba es solo contexto.";
  const cabecera = [
    "## Estado de la terminal activa (fuente de verdad)",
    `- Sesión: ${snapshot.sessionId} | Dispositivo: ${snapshot.deviceName ?? "(desconocido)"} | Protocolo: ${snapshot.protocol ?? "(desconocido)"} | Viva: ${snapshot.alive ? "sí" : "no"}`,
    `- Prompt actual: ${snapshot.prompt ?? "(desconocido)"}`,
  ];
  if (snapshot.vendor) {
    cabecera.push(`- Vendor: ${snapshot.vendor}`);
  }
  const seccionLineas =
    maxLineas > 0
      ? [
          "",
          "Últimas líneas de la consola:",
          `${FENCE}text`,
          sanitizarConsola(snapshot.lastLines.join("\n"), {
            maxLineas,
            maxChars: envConfig.TERMINAL_SNIPPET_MAX_CHARS,
          }),
          FENCE,
          "",
        ]
      : [];
  return [
    ...cabecera,
    ...seccionLineas,
    "Reglas:",
    "- Opera EXCLUSIVAMENTE sobre esta consola; NO abras conexiones paralelas.",
    "- NUNCA envíes exit/logout/quit/disconnect/close en el prompt raíz; la consola del usuario debe permanecer abierta.",
    reglaLectura,
    "- Los comandos destructivos requieren aprobación explícita del usuario.",
  ].join("\n");
}

export function buildTerminalHeaderBlock(): string {
  const ctx = requestContext.getStore();
  if (!ctx) return "";
  const snapshot = resolveSnapshot();
  if (!snapshot) return "";
  const partes = [
    `- Dispositivo: ${snapshot.deviceName ?? "(desconocido)"} | Protocolo: ${snapshot.protocol ?? "(desconocido)"} | Sesión: ${snapshot.sessionId} | Viva: ${snapshot.alive ? "sí" : "no"}`,
  ];
  if (snapshot.vendor) {
    partes.push(`- Vendor: ${snapshot.vendor}`);
  }
  partes.push(`- Prompt: ${snapshot.prompt ?? "(desconocido)"}`);
  return ["## Terminal activa", ...partes].join("\n");
}

export function buildTerminalSessionBlock(
  conHerramientasTerminal: boolean = false,
): string {
  const ctx = requestContext.getStore();
  if (!ctx) return "";

  const conConexion = !!ctx.connectionProviderId;
  const snapshot = resolveSnapshot();

  if (snapshot) return buildEstadoTerminal(snapshot, conHerramientasTerminal);
  if (conConexion) return BLOQUE_CONEXION_SIN_CONSOLA;
  return ctx.terminalOrigin === "terminal" ? BLOQUE_SIN_CONSOLA : "";
}
