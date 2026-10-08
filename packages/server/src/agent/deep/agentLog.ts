import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { extraerFuentesRag, normalizarPlan } from "@/agent/deep/transparency";

export const NIVEL_AGENTE = {
  TURNO: "AGENT_TURN",
  PLAN: "AGENT_PLAN",
  DELEGACION: "AGENT_DELEGATION",
  TOOL: "AGENT_TOOL",
  SKILL: "AGENT_SKILL",
  RAG: "AGENT_RAG",
  APROBACION: "AGENT_APPROVAL",
  ERROR: "ERROR",
} as const;

export const NIVELES_AGENTE_CANONICOS: string[] = [
  NIVEL_AGENTE.TURNO,
  NIVEL_AGENTE.PLAN,
  NIVEL_AGENTE.DELEGACION,
  NIVEL_AGENTE.TOOL,
  NIVEL_AGENTE.SKILL,
  NIVEL_AGENTE.RAG,
  NIVEL_AGENTE.APROBACION,
];

export const NIVELES_LOG_PREEXISTENTES: string[] = [
  "CREATE",
  "LINK",
  "MODULE",
  "CONFIGURE",
  "DELETE",
  "INFO",
  "CRON_EXECUTION",
  "ADMIN_ACTION",
  NIVEL_AGENTE.ERROR,
];

export const NIVELES_LOG_CANONICOS: string[] = Array.from(
  new Set([...NIVELES_AGENTE_CANONICOS, ...NIVELES_LOG_PREEXISTENTES]),
);

export interface ContextoLogAgente {
  userId?: string | null;
  chatId?: string | null;
  threadId?: string;
  actor?: { username?: string | null; role?: string | null };
  modelo?: string | null;

  origen?: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheInterruptor {
  valor: boolean;
  cargadoAt: number;
}

let cacheInterruptor: CacheInterruptor | null = null;

let avisadoFalloLectura = false;

export function logsDeAgenteActivos(): boolean {
  if (!cacheInterruptor) return true;
  return cacheInterruptor.valor;
}

export function cacheDeLogsDeAgenteVencido(): boolean {
  if (!cacheInterruptor) return true;
  return Date.now() - cacheInterruptor.cargadoAt >= CACHE_TTL_MS;
}

export async function refrescarLogsDeAgente(forzar = false): Promise<boolean> {
  if (!forzar && cacheInterruptor && !cacheDeLogsDeAgenteVencido()) {
    return cacheInterruptor.valor;
  }
  try {
    const config = await prismaClient.configuration.findFirst({
      select: { agentLogsEnabled: true },
    });
    const valor = config?.agentLogsEnabled ?? true;
    cacheInterruptor = { valor, cargadoAt: Date.now() };
    return valor;
  } catch (error) {

    cacheInterruptor = { valor: true, cargadoAt: Date.now() };
    if (!avisadoFalloLectura) {
      avisadoFalloLectura = true;
      Logger.warning({
        message:
          "[AGENT_LOG] No se pudo leer Configuration.agentLogsEnabled; se mantiene la traza del agente activa (fail-open)",
        data: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
}

export function invalidarCacheLogsDeAgente(): void {
  cacheInterruptor = null;
}

export function establecerCacheLogsDeAgente(valor: boolean): void {
  cacheInterruptor = { valor, cargadoAt: Date.now() };
}

const MAX_PENDIENTES = 200;

const LOTE = 10;

const MAX_INTENTOS = 1;

interface EntradaPendiente {
  level: string;
  title: string;
  content: string;
  userId: string | null;
  chatId: string | null;

  intentos: number;
}

const pendientes: EntradaPendiente[] = [];

let volcando = false;

let avisadoDesborde = false;

function recortar(texto: unknown, max: number): string {
  const limpio = typeof texto === "string" ? texto.trim() : texto === null || texto === undefined ? "" : String(texto);
  if (limpio.length <= max) return limpio;
  return `${limpio.slice(0, max)}…`;
}

const MAX_CONTENT_CHARS = 2000;

const MAX_TITLE_CHARS = 200;

function encolar(entrada: EntradaPendiente): void {
  if (pendientes.length >= MAX_PENDIENTES) {
    pendientes.shift();
    if (!avisadoDesborde) {
      avisadoDesborde = true;
      Logger.warning({
        message: `[AGENT_LOG] Cola de traza desbordada (>${MAX_PENDIENTES}); se descartan las entradas más antiguas`,
      });
    }
  }
  pendientes.push(entrada);
  programarVolcado();
}

function programarVolcado(): void {
  if (volcando) return;
  volcando = true;
  setImmediate(() => {
    void volcarCola();
  });
}

async function volcarCola(): Promise<void> {
  try {
    while (pendientes.length > 0) {
      const lote = pendientes.splice(0, LOTE);
      const fallidos: EntradaPendiente[] = [];
      for (const entrada of lote) {
        try {
          await prismaClient.log.create({
            data: {
              level: entrada.level,
              title: entrada.title,
              content: entrada.content,
              userId: entrada.userId,
              chatId: entrada.chatId,
            },
          });
        } catch (error) {
          Logger.error({
            message: `[AGENT_LOG] No se pudo escribir la traza del agente (${entrada.level}/${entrada.title})`,
            data: error instanceof Error ? error.message : String(error),
          });
          if (entrada.intentos < MAX_INTENTOS) {
            fallidos.push({ ...entrada, intentos: entrada.intentos + 1 });
          }
        }
      }

      if (fallidos.length > 0) pendientes.unshift(...fallidos);
    }
  } finally {
    volcando = false;
  }
}

export async function vaciarColaDeLogs(): Promise<void> {
  if (pendientes.length === 0 && !volcando) return;
  await volcarCola();
}

export function pendientesDeLog(): number {
  return pendientes.length;
}

function lineaDeContexto(ctx: ContextoLogAgente, extra?: string): string {
  const partes: string[] = [];
  if (ctx.threadId) partes.push(`hilo=${ctx.threadId}`);
  if (ctx.modelo) partes.push(`modelo=${ctx.modelo}`);
  if (ctx.origen) partes.push(`origen=${ctx.origen}`);
  const username = ctx.actor?.username;
  const role = ctx.actor?.role;
  if (username || role) partes.push(`actor=${username ?? "?"} (${role ?? "?"})`);
  if (extra) partes.push(extra);
  return partes.join(" ");
}

function componerContent(ctx: ContextoLogAgente, detalle: string, extra?: string): string {
  const cabecera = lineaDeContexto(ctx, extra);
  const cuerpo = detalle.trim();
  return recortar(cuerpo ? `${cabecera}\n${cuerpo}` : cabecera, MAX_CONTENT_CHARS);
}

function registrar(
  ctx: ContextoLogAgente,
  level: string,
  title: string,
  detalle: string,
  extra?: string,
): void {
  if (!logsDeAgenteActivos()) return;
  encolar({
    level,
    title: recortar(title, MAX_TITLE_CHARS),
    content: componerContent(ctx, detalle, extra),
    userId: ctx.userId ?? null,
    chatId: ctx.chatId ?? null,
    intentos: 0,
  });
}

function datos(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function texto(valor: unknown, max = 400): string {
  if (valor === undefined || valor === null) return "";
  if (typeof valor === "string") return recortar(valor, max);
  try {
    return recortar(JSON.stringify(valor), max);
  } catch {
    return "";
  }
}

function textoO(valor: unknown, alterno: string, max = 400): string {
  const limpio = texto(valor, max);
  return limpio || alterno;
}

const DECISION_APROBACION: Record<string, string> = {
  approved: "aprobada",
  rejected: "rechazada",
  expired: "expirada",
  cancelled: "cancelada",
  auto: "automática",
};

const MARCA_PASO: Record<string, string> = {
  pending: "pendiente",
  in_progress: "en curso",
  completed: "completado",
};

export function registrarInicioDeTurno(
  ctx: ContextoLogAgente,
  datos: {
    prompt: string;
    modelo?: string | null;
    ruta?: "supervisor" | "fast_path";
  },
): void {
  const extra = datos.ruta ? `ruta=${datos.ruta}` : undefined;
  const modelo = datos.modelo ?? ctx.modelo;
  const contexto: ContextoLogAgente = { ...ctx, modelo };
  registrar(
    contexto,
    NIVEL_AGENTE.TURNO,
    "Turno iniciado",
    textoO(datos.prompt, "(prompt vacío)"),
    extra,
  );
}

const FIN_DE_TURNO: Record<
  "completo" | "cancelado" | "presupuesto" | "error",
  { title: string; nivel: string }
> = {
  completo: { title: "Turno completado", nivel: NIVEL_AGENTE.TURNO },
  cancelado: { title: "Turno cancelado", nivel: NIVEL_AGENTE.TURNO },
  presupuesto: { title: "Turno cortado por presupuesto", nivel: NIVEL_AGENTE.TURNO },

  error: { title: "Turno fallido", nivel: NIVEL_AGENTE.ERROR },
};

export function registrarFinDeTurno(
  ctx: ContextoLogAgente,
  datos: {
    resultado: "completo" | "cancelado" | "presupuesto" | "error";
    duracionMs: number;
    toolCalls: number;
    tokensEntrada?: number;
    tokensSalida?: number;
    pasosPendientes?: number;
    respuesta?: string;
    error?: string;
  },
): void {
  const { title, nivel } = FIN_DE_TURNO[datos.resultado];
  const lineas: string[] = [
    `duracionMs=${datos.duracionMs} toolCalls=${datos.toolCalls}`,
  ];
  if (typeof datos.tokensEntrada === "number") {
    lineas.push(`tokensEntrada=${datos.tokensEntrada}`);
  }
  if (typeof datos.tokensSalida === "number") {
    lineas.push(`tokensSalida=${datos.tokensSalida}`);
  }
  if (typeof datos.pasosPendientes === "number") {
    lineas.push(`pasosPendientes=${datos.pasosPendientes}`);
  }
  const detalle: string[] = [lineas.join(" ")];
  if (datos.respuesta) detalle.push(`respuesta=${recortar(datos.respuesta, 600)}`);
  if (datos.error) detalle.push(`error=${recortar(datos.error, 600)}`);
  registrar(ctx, nivel, title, detalle.join("\n"), `resultado=${datos.resultado}`);
}

export function observarEventoDeAgente(
  ctx: ContextoLogAgente,
  event: string,
  data: unknown,
): void {
  if (!logsDeAgenteActivos()) return;
  const d = datos(data);

  switch (event) {
    case "plan_update": {
      const plan = normalizarPlan(d);
      if (plan.length === 0) return;
      const detalle = plan
        .map(
          (paso, indice) =>
            `${indice + 1}. [${MARCA_PASO[paso.status] ?? paso.status}] ${paso.content}`,
        )
        .join("\n");
      registrar(ctx, NIVEL_AGENTE.PLAN, `Plan actualizado (${plan.length} pasos)`, detalle);
      return;
    }

    case "subagent_started": {
      const nombre = textoO(d.name, "general-purpose", 120);
      registrar(
        ctx,
        NIVEL_AGENTE.DELEGACION,
        `Delegación → ${nombre}`,
        textoO(d.task, "(sin tarea delegada)", 600),
      );
      return;
    }

    case "subagent_completed": {
      const nombre = textoO(d.name, "general-purpose", 120);
      const estado = estadoDeSubagente(d);
      registrar(
        ctx,
        NIVEL_AGENTE.DELEGACION,
        `Delegación finalizada → ${nombre}`,
        textoO(d.summary, "(sin resumen)"),
        `estado=${estado}`,
      );
      return;
    }

    case "skill_loading":
    case "skill_loaded": {
      const cargando = event === "skill_loading";
      const nombre = textoO(d.skillName ?? d.name ?? d.title, "(desconocida)", 120);
      const descripcion = texto(d.description, 300);
      registrar(
        ctx,
        NIVEL_AGENTE.SKILL,
        `Skill ${cargando ? "cargando" : "cargada"} → ${nombre}`,
        descripcion ? `descripcion=${descripcion}` : "",
      );
      return;
    }

    case "skill_created": {
      const titulo = textoO(d.title ?? d.skillName, "(sin título)", 150);
      registrar(ctx, NIVEL_AGENTE.SKILL, `Skill creada → ${titulo}`, texto(d.skillId, 120));
      return;
    }

    case "rag_retrieved": {
      const fuentes = fuentesDeRag(d);
      const usadas = typeof d.chunksUsed === "number" ? d.chunksUsed : fuentes.length;
      registrar(
        ctx,
        NIVEL_AGENTE.RAG,
        `RAG: ${usadas} fuentes`,
        fuentes.join("\n"),
        fuentes.length > 0 ? undefined : "sin-titulos",
      );
      return;
    }

    case "tool_call_start": {
      const nombre = textoO(d.name, "(tool sin nombre)", 150);
      registrar(
        ctx,
        NIVEL_AGENTE.TOOL,
        `Tool → ${nombre}`,

        textoO(d.input, "(argumentos aún no disponibles)", 600),
      );
      return;
    }

    case "tool_call_result": {
      const nombre = textoO(d.name, "(tool sin nombre)", 150);
      const status = textoO(d.status, "completed", 40);
      const entrada = texto(d.input, 300);
      const salida = texto(d.output, 900);
      const detalle = [
        entrada ? `input=${entrada}` : "input=(argumentos aún no disponibles)",
        `output=${salida || "(sin salida)"}`,
      ].join("\n");
      registrar(ctx, NIVEL_AGENTE.TOOL, `Tool ${nombre} → ${status}`, detalle);
      return;
    }

    case "tool_approval_required": {
      const objetivo = textoO(d.toolLabel ?? d.name, "(tool sin nombre)", 150);
      const resumen = texto(d.summary, 300);
      const comandos = Array.isArray(d.commands) ? d.commands.join(" ; ") : "";
      registrar(
        ctx,
        NIVEL_AGENTE.APROBACION,
        `Aprobación requerida → ${objetivo}`,
        [resumen, comandos ? `comandos=${texto(comandos, 300)}` : ""]
          .filter(Boolean)
          .join("\n"),
        texto(d.risk, 40) ? `riesgo=${texto(d.risk, 40)}` : undefined,
      );
      return;
    }

    case "tool_approval_resolved": {
      const decisionBruta = textoO(d.decision, "desconocida", 40).toLowerCase();
      const decision = DECISION_APROBACION[decisionBruta] ?? decisionBruta;
      registrar(
        ctx,
        NIVEL_AGENTE.APROBACION,
        `Aprobación ${decision} → ${textoO(d.toolCallId ?? d.name, "(tool)", 150)}`,
        "",
        `decision=${decisionBruta}`,
      );
      return;
    }

    case "terminal_command": {
      const comandos = Array.isArray(d.commands) ? d.commands.join(" ; ") : texto(d.commands, 400);
      const dispositivo = texto(d.deviceName, 120);
      registrar(
        ctx,
        NIVEL_AGENTE.TOOL,
        "Comando enviado a la consola",
        `${comandos || "(sin comandos)"}${dispositivo ? ` (${dispositivo})` : ""}`,
        texto(d.name, 120) ? `tool=${texto(d.name, 120)}` : undefined,
      );
      return;
    }

    default:

      return;
  }
}

function estadoDeSubagente(d: Record<string, unknown>): string {
  const explicito = textoO(d.estado ?? d.status, "", 40).toLowerCase();
  if (explicito === "completed" || explicito === "error" || explicito === "rejected") {
    return explicito;
  }
  const resumen = texto(d.summary, 200).toLowerCase();
  if (resumen.includes("cancelad")) return "rejected";
  if (resumen.includes("error")) return "error";
  return "completed";
}

function fuentesDeRag(d: Record<string, unknown>): string[] {
  if (Array.isArray(d.sources)) {
    return d.sources
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => recortar(s, 120));
  }
  if (typeof d.output === "string") {
    return extraerFuentesRag(d.output).map((s) => recortar(s, 120));
  }
  return [];
}
