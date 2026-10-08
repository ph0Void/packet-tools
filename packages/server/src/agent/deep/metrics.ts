import { Logger } from "@/utils/Logger";
import { envConfig } from "@/config/EnvConfig";

const CHARS_PER_TOKEN = 4;

const TOKENS_POR_TOOL = 120;

export const TOOLS_SUPERVISOR = 12;

export interface NodeMetric {
  node: string;
  tokensEntrada: number;
  tokensSalida: number;
  duracionMs: number;
  toolCalls: number;

  tokensSystemEstimado?: number;

  tokensToolsEstimado?: number;

  tokensTerminalEstimado?: number;

  tokensHistorialEstimado?: number;
}

export interface DesgloseTurno {
  tokensSystemEstimado: number;
  tokensToolsEstimado: number;
  tokensTerminalEstimado: number;
  tokensHistorialEstimado: number;
}

export interface TurnMetric {
  chatId: string;
  threadId: string;
  role: string;
  deep: boolean;
  nodes: NodeMetric[];
  tokensEntradaTotal: number;
  tokensSalidaTotal: number;
  duracionTotalMs: number;
  toolCallsTotal: number;
  turnos: number;

  tokensSystemEstimado: number;
  tokensToolsEstimado: number;
  tokensTerminalEstimado: number;
  tokensHistorialEstimado: number;
}

export function estimarTokens(texto: string): number {
  if (!texto) return 0;
  return Math.ceil(String(texto).length / CHARS_PER_TOKEN);
}

export function estimarTokensMensajes(mensajes: unknown[]): number {
  let total = 0;
  for (const mensaje of mensajes) {
    if (!mensaje) continue;
    const m = mensaje as { content?: unknown; tool_calls?: unknown };
    if (typeof m.content === "string") {
      total += estimarTokens(m.content);
    } else if (m.content) {
      total += estimarTokens(JSON.stringify(m.content));
    }
    if (Array.isArray(m.tool_calls)) {
      total += estimarTokens(JSON.stringify(m.tool_calls));
    }
  }
  return total;
}

export function estimarDesgloseTurno(params: {

  promptBase?: string;

  bloquesDinamicos?: string;

  terminal?: string;

  historial?: unknown[];

  tools?: number;
}): DesgloseTurno {
  const tools = typeof params.tools === "number" ? params.tools : TOOLS_SUPERVISOR;
  return {
    tokensSystemEstimado:
      estimarTokens(params.promptBase ?? "") +
      estimarTokens(params.bloquesDinamicos ?? ""),
    tokensToolsEstimado: Math.max(0, Math.floor(tools)) * TOKENS_POR_TOOL,
    tokensTerminalEstimado: estimarTokens(params.terminal ?? ""),
    tokensHistorialEstimado: estimarTokensMensajes(params.historial ?? []),
  };
}

const MAX_TURNOS = 500;
const turnos: TurnMetric[] = [];

export function registrarNodo(turno: TurnMetric, node: NodeMetric): void {
  turno.nodes.push(node);
  turno.tokensEntradaTotal += node.tokensEntrada;
  turno.tokensSalidaTotal += node.tokensSalida;
  turno.duracionTotalMs = Math.max(turno.duracionTotalMs, node.duracionMs);
  turno.toolCallsTotal += node.toolCalls;
  turno.tokensSystemEstimado += node.tokensSystemEstimado ?? 0;
  turno.tokensToolsEstimado += node.tokensToolsEstimado ?? 0;
  turno.tokensTerminalEstimado += node.tokensTerminalEstimado ?? 0;
  turno.tokensHistorialEstimado += node.tokensHistorialEstimado ?? 0;
}

export function cerrarTurno(turno: TurnMetric): TurnMetric {
  turnos.push(turno);
  if (turnos.length > MAX_TURNOS) turnos.shift();

  if (envConfig.AGENT_TOKEN_LOGGING) {
    Logger.info({
      message: "[AGENT_METRICS] turno",
      data: {
        chatId: turno.chatId,
        deep: turno.deep,
        tokensEntrada: turno.tokensEntradaTotal,
        tokensSalida: turno.tokensSalidaTotal,
        duracionMs: turno.duracionTotalMs,
        toolCalls: turno.toolCallsTotal,

        componentes: {
          system: turno.tokensSystemEstimado,
          tools: turno.tokensToolsEstimado,
          terminal: turno.tokensTerminalEstimado,
          historial: turno.tokensHistorialEstimado,
        },
        nodos: turno.nodes.map((n) => `${n.node}:${n.tokensEntrada}`),
      },
    });
  }
  return turno;
}

export function nuevoTurno(params: {
  chatId: string;
  threadId: string;
  role: string;
  deep: boolean;
}): TurnMetric {
  return {
    chatId: params.chatId,
    threadId: params.threadId,
    role: params.role,
    deep: params.deep,
    nodes: [],
    tokensEntradaTotal: 0,
    tokensSalidaTotal: 0,
    duracionTotalMs: 0,
    toolCallsTotal: 0,
    turnos: 0,
    tokensSystemEstimado: 0,
    tokensToolsEstimado: 0,
    tokensTerminalEstimado: 0,
    tokensHistorialEstimado: 0,
  };
}

export function resumenRendimiento(deep?: boolean) {
  const muestra = deep === undefined ? turnos : turnos.filter((t) => t.deep === deep);
  if (muestra.length === 0) {
    return { turnos: 0, tokensMedios: 0, duracionMediaMs: 0, duracionP95Ms: 0 };
  }
  const tokens = muestra.map((t) => t.tokensEntradaTotal);
  const duraciones = muestra.map((t) => t.duracionTotalMs).sort((a, b) => a - b);
  const p95 = duraciones[Math.min(duraciones.length - 1, Math.floor(duraciones.length * 0.95))];
  return {
    turnos: muestra.length,
    tokensMedios: Math.round(tokens.reduce((a, b) => a + b, 0) / muestra.length),
    duracionMediaMs: Math.round(
      duraciones.reduce((a, b) => a + b, 0) / muestra.length,
    ),
    duracionP95Ms: p95,
  };
}

export function limpiarMetricas(): void {
  turnos.length = 0;
}
