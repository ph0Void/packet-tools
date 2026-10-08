import type { Request, Response } from "express";
import { HumanMessage } from "@langchain/core/messages";
import { PDFParse } from "pdf-parse";
import { approvalBroker } from "@/agent/approval/ApprovalBroker";
import { terminalOpenBroker } from "@/agent/approval/TerminalOpenBroker";
import {
  APPROVAL_MESSAGE_PREFIXES,
  resetApprovalAttempts,
} from "@/agent/approval/ApprovalMiddleware";
import { createTurnStream } from "@/agent/deep/turn";
import { resolveHandoffTarget } from "@/agent/deep/handoff";
import {
  emitirTransparenciaAlIniciar,
  emitirTransparenciaAlTerminar,
  normalizarPlan,
} from "@/agent/deep/transparency";
import {
  MENSAJE_CANCELACION,
  anexarAvisoPresupuesto,
  anexarAvisoPresupuestoSegmento,
  anexarAvisoTurnoIncompleto,
  anexarAvisoTurnoIncompletoSegmento,
  codigoDeErrorStream,
  insertarSegmentoPlan,
  type MotivoTurnoIncompleto,
  type PasoPlan,
  type SegmentoPlan,
} from "@/api/router/continuation";
import type { ReservaTurno } from "@/api/router/turnoEnCurso";
import {
  cerrarTurno,
  estimarDesgloseTurno,
  estimarTokens,
  estimarTokensMensajes,
  nuevoTurno,
  registrarNodo,
  type DesgloseTurno,
} from "@/agent/deep/metrics";
import {
  observarEventoDeAgente,
  refrescarLogsDeAgente,
  registrarFinDeTurno,
  registrarInicioDeTurno,
  type ContextoLogAgente,
} from "@/agent/deep/agentLog";
import { BASE_SUPERVISOR_PROMPT, buildTurnContextPrompt } from "@/agent/deep/DeepSupervisor";
import {
  deepTurnContextSchema,
  toDeepConnection,
  type DeepTurnContext,
} from "@/agent/deep/context";
import { resolveMention } from "@/agent/terminal/MentionParser";
import { buildTerminalHeaderBlock } from "@/agent/terminal/SessionContext";
import {
  buildConnectionTarget,
  findDeviceByConnectionId,
  type ConnectionDevice,
  type ResolvedConnectionTarget,
} from "@/agent/terminal/ConnectionResolver";
import { searchKnowledgeBaseTool } from "@/agent/knowledge/Tool";
import { Prisma } from "@/prisma/generated/client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { terminalSessionHub } from "@/sockets/TerminalSessionHub";
import { Logger } from "@/utils/Logger";
import { sanitizarConsola } from "@/utils/TerminalSanitizer";
import { buildHistoryMessages, compactText } from "@/utils/MessageContext";
import { envConfig } from "@/config/EnvConfig";
import { requestContext } from "@/utils/RequestContext";
import {
  DIRECTORIO_ADJUNTOS,
  bytesCoincidenConMime,
  leerAdjuntoDeDisco,
} from "@/api/router/adjuntos";

export const SSE_EVENTOS = {
  userMessage: "user_message",
  textDelta: "text_delta",
  reasoning: "reasoning",
  toolCallStart: "tool_call_start",
  toolCallResult: "tool_call_result",
  toolApprovalRequired: "tool_approval_required",
  toolApprovalResolved: "tool_approval_resolved",
  terminalCommand: "terminal_command",
  handoff: "handoff",
  error: "error",
  complete: "complete",
} as const;

export type BloqueContenido =
  | { type: "text"; text: string }
  | { type: "image"; source_type: "base64"; mime_type: string; data: string };

export interface AdjuntoDeTurno {
  fileName: string;
  fileType: "IMAGE" | "DOCUMENT";
  mimeType?: string | null;

  storagePath?: string | null;

  fileUrl?: string | null;
}

const LIMITE_DOC_CHARS = 6000;

const LIMITE_RAG_CHARS = 6000;

const HISTORIAL_FETCH = Math.max(12, envConfig.AGENT_HISTORY_MESSAGES * 2);

const EXTENSIONES_TEXTO = ["txt", "md", "csv", "json"];

function truncarTexto(texto: string, max: number): string {
  const limpio = texto.trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}

async function extraerTextoDocumento(
  fileName: string,
  mimeType: string | undefined,
  bytes: Buffer,
): Promise<string> {
  const extension = (fileName.split(".").pop() ?? "").toLowerCase();
  try {
    if (extension === "pdf" || mimeType === "application/pdf") {
      const parser = new PDFParse({ data: bytes });
      const texto = (await parser.getText()).text;
      await parser.destroy();
      return truncarTexto(texto, LIMITE_DOC_CHARS);
    }
    if (EXTENSIONES_TEXTO.includes(extension)) {
      return truncarTexto(bytes.toString("utf8"), LIMITE_DOC_CHARS);
    }
    return "(no se pudo extraer el contenido del documento)";
  } catch (error: any) {
    Logger.warning({
      message: `[CHAT_ATTACH] No se pudo extraer el texto del documento: ${fileName}`,
      data: error?.message,
    });
    return "(no se pudo extraer el contenido del documento)";
  }
}

async function bytesDeAdjunto(adjunto: AdjuntoDeTurno): Promise<Buffer | null> {
  if (adjunto.storagePath) {
    const bytes = await leerAdjuntoDeDisco(DIRECTORIO_ADJUNTOS, adjunto.storagePath);
    if (bytes) return bytes;
    Logger.warning({
      message: `[CHAT_ATTACH] No se encontró el archivo del adjunto: ${adjunto.fileName}`,
      data: { storagePath: adjunto.storagePath },
    });
    return null;
  }
  if (typeof adjunto.fileUrl === "string" && adjunto.fileUrl.startsWith("data:")) {
    const coincidencia = adjunto.fileUrl.match(/^data:([^;,]*);base64,(.*)$/s);
    if (!coincidencia) return null;
    return Buffer.from(coincidencia[2], "base64");
  }
  return null;
}

export async function construirContenidoMultimodal(
  content: string,
  attachments: AdjuntoDeTurno[],
): Promise<string | BloqueContenido[]> {
  const prepared: Array<{ adjunto: AdjuntoDeTurno; bytes: Buffer; mime: string }> = [];
  for (const adjunto of attachments) {
    const bytes = await bytesDeAdjunto(adjunto);
    if (!bytes) continue;
    const mime = adjunto.mimeType ?? "application/octet-stream";

    if (!bytesCoincidenConMime(bytes, mime)) {
      Logger.warning({
        message: `[CHAT_ATTACH] Adjunto ignorado (el contenido no coincide con el tipo ${mime}): ${adjunto.fileName}`,
      });
      continue;
    }
    prepared.push({ adjunto, bytes, mime });
  }
  if (prepared.length === 0) return content;

  const bloques: BloqueContenido[] = [{ type: "text", text: content }];
  for (const { adjunto, bytes, mime } of prepared) {
    if (adjunto.fileType === "IMAGE") {
      bloques.push({
        type: "image",
        source_type: "base64",
        mime_type: mime,
        data: bytes.toString("base64"),
      });
      continue;
    }
    const texto = await extraerTextoDocumento(adjunto.fileName, mime, bytes);
    bloques.push({
      type: "text",
      text: `📄 Documento adjunto "${adjunto.fileName}":\n${texto}`,
    });
  }
  return bloques;
}

const RAG_ENCABEZADO = "## Contexto de la base de conocimiento (solicitado con @rag)";
const RAG_FALLBACK = "No se pudo consultar la base de conocimiento en este momento.";

function parsearJsonSeguro(texto: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(texto);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function esResultadoConError(resultado: unknown): boolean {
  const objeto =
    typeof resultado === "string" ? parsearJsonSeguro(resultado) : (resultado as Record<string, any>);
  return Boolean(objeto && typeof objeto === "object" && objeto.error);
}

function esBusquedaTextual(resultado: unknown): boolean {
  let objeto = resultado as Record<string, any> | null;
  if (typeof resultado === "string") objeto = parsearJsonSeguro(resultado);
  if (!objeto || typeof objeto !== "object") return false;
  if (objeto.mode === "textual" || objeto.metadata?.mode === "textual") return true;
  const metadatas = Array.isArray(objeto.metadatas) ? objeto.metadatas : [];
  return metadatas.some((meta: any) => meta?.mode === "textual");
}

function extraerFuentesRag(resultado: unknown): string[] {
  let objeto = resultado as Record<string, any> | null;
  if (typeof resultado === "string") objeto = parsearJsonSeguro(resultado);
  if (!objeto || typeof objeto !== "object") return [];
  if (Array.isArray(objeto.sources)) {
    return objeto.sources.filter((s: unknown): s is string => typeof s === "string");
  }
  const metadatas = Array.isArray(objeto.metadatas) ? objeto.metadatas : [];
  return metadatas
    .map((meta: any) => (typeof meta?.title === "string" ? meta.title : null))
    .filter((t: string | null): t is string => Boolean(t));
}

async function construirContextoRag(
  query: string,
  emit?: (event: string, data: unknown) => void,
): Promise<string> {
  try {
    const resultado = await searchKnowledgeBaseTool.invoke({ query });
    if (esResultadoConError(resultado)) {
      Logger.warning({
        message: "[CHAT_RAG] La búsqueda en la base de conocimiento devolvió un error",
        data: typeof resultado === "string" ? resultado : JSON.stringify(resultado),
      });
      return `${RAG_ENCABEZADO}\n${RAG_FALLBACK}`;
    }
    const fuentes = extraerFuentesRag(resultado);
    if (emit && fuentes.length > 0) {
      emit("rag_retrieved", { sources: fuentes, chunksUsed: fuentes.length });
    }
    const texto = compactText(
      typeof resultado === "string" ? resultado : JSON.stringify(resultado),
      LIMITE_RAG_CHARS,
      "rag context",
    );
    const nota = esBusquedaTextual(resultado)
      ? "\n(Nota: resultados de búsqueda textual; no hay embeddings disponibles.)"
      : "";
    return `${RAG_ENCABEZADO}${nota}\n${texto}`;
  } catch (error: any) {
    Logger.warning({ message: "[CHAT_RAG] La búsqueda en la base de conocimiento falló", data: error?.message });
    return `${RAG_ENCABEZADO}\n${RAG_FALLBACK}`;
  }
}

export function anexarContextoRag(
  contenido: string | BloqueContenido[],
  contexto: string,
): string | BloqueContenido[] {
  if (typeof contenido === "string") return `${contexto}\n\n${contenido}`;
  return [{ type: "text", text: contexto }, ...contenido];
}

const MARCADOR_TAIL_TERMINAL = "--- Última salida de terminal ---";

const PREFIJO_MARCADOR_TAIL = "--- Última salida de terminal";

export function construirBloqueTailTerminal(
  terminalContextLines: number,
  terminalTail: string | undefined,
): string {
  if (!(terminalContextLines > 0)) return "";
  const saneado = sanitizarConsola(terminalTail ?? "", {
    maxLineas: terminalContextLines,
    maxChars: envConfig.TERMINAL_SNIPPET_MAX_CHARS,
  });
  if (!saneado) return "";
  return `\n\n${MARCADOR_TAIL_TERMINAL}\n${saneado}`;
}

export function anexarBloqueTexto(
  contenido: string | BloqueContenido[],
  texto: string,
): string | BloqueContenido[] {
  if (!texto) return contenido;
  if (typeof contenido === "string") return `${contenido}${texto}`;
  return [...contenido, { type: "text" as const, text: texto }];
}

export function avisarTailEnContent(contenido: string, chatId: string): void {
  if (!contenido.includes(PREFIJO_MARCADOR_TAIL)) return;
  Logger.warning({
    message:
      "[CHAT_TERMINAL] El cliente envía la salida de terminal dentro de `content` (vía antigua, sin sanear): usa `terminalTail` + `terminalContextLines`",
    data: { chatId },
  });
}

async function estimarPromptDinamico(contexto: Record<string, unknown>): Promise<string> {
  try {
    return await buildTurnContextPrompt(
      deepTurnContextSchema.parse(contexto) as DeepTurnContext,
    );
  } catch {
    return "";
  }
}

export function truncarContenidoTurno(
  contenido: string | BloqueContenido[],
  maxChars: number,
): string | BloqueContenido[] {
  if (typeof contenido === "string") {
    return compactText(contenido, maxChars, "user message");
  }
  return contenido.map((bloque) =>
    bloque.type === "text"
      ? { ...bloque, text: compactText(bloque.text, maxChars, "user message") }
      : bloque,
  );
}

export type EstadoTool = "running" | "waiting_approval" | "completed" | "rejected" | "error";

export type SegmentoStream =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: string;
      status: EstadoTool;
    }

  | SegmentoPlan;

interface PendingToolCall {
  name: string;
  args: string;
  started: boolean;
}

export interface ToolExecution {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  status: EstadoTool;
}

function isToolMessageChunk(chunk: any): boolean {
  return chunk?.getType?.() === "tool";
}

function extractVisibleText(chunk: any): string {
  const content = chunk?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("");
  }
  return "";
}

function extractReasoning(chunk: any): string {
  let result = "";
  const reasoningContent = chunk?.additional_kwargs?.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent) {
    result += reasoningContent;
  }
  if (Array.isArray(chunk?.content)) {
    for (const part of chunk.content) {
      if (
        (part?.type === "thinking" || part?.type === "reasoning") &&
        typeof part.text === "string"
      ) {
        result += part.text;
      }
    }
  }
  return result;
}

function parseToolArgs(args: string): Record<string, unknown> {
  if (!args.trim()) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function describirFormaStream(item: unknown, profundidad = 0): string {
  if (profundidad > 3) return "…";
  if (Array.isArray(item)) {
    return `[${item.map((parte) => describirFormaStream(parte, profundidad + 1)).join(", ")}]`;
  }
  if (item && typeof item === "object") {
    const tipo = (item as { getType?: () => string }).getType?.();
    if (tipo) return `<${tipo}>`;
    const claves = Object.keys(item as object).slice(0, 6);
    return `{${claves.join(",")}}`;
  }
  return typeof item;
}

function extractStreamChunk(item: any): any {
  if (!Array.isArray(item)) return item;

  if (Array.isArray(item[1])) return extractStreamChunk(item[1]);

  const message = item.find(
    (part: any) => part && typeof part === "object" && typeof part.getType === "function",
  );
  return message ?? item[0];
}

function anexarTextoSegmento(segmentos: SegmentoStream[], delta: string): void {
  const ultimo = segmentos[segmentos.length - 1];
  if (ultimo && ultimo.kind === "text") {
    ultimo.text += delta;
  } else {
    segmentos.push({ kind: "text", text: delta });
  }
}

function iniciarSegmentoTool(
  segmentos: SegmentoStream[],
  id: string,
  name: string,
  input: Record<string, unknown>,
): void {
  const existente = segmentos.find((s) => s.kind === "tool" && s.id === id);
  if (!existente) {
    segmentos.push({ kind: "tool", id, name, input, status: "running" });
  }
}

function buscarSegmentoTool(
  segmentos: SegmentoStream[],
  id: string,
  name: string,
): Extract<SegmentoStream, { kind: "tool" }> | undefined {
  const porId = segmentos.find(
    (segmento): segmento is Extract<SegmentoStream, { kind: "tool" }> =>
      segmento.kind === "tool" && segmento.id === id,
  );
  if (porId) return porId;
  for (let i = segmentos.length - 1; i >= 0; i -= 1) {
    const segmento = segmentos[i];
    if (
      segmento.kind === "tool" &&
      segmento.name === name &&
      (segmento.status === "running" || segmento.status === "waiting_approval")
    ) {
      return segmento;
    }
  }
  return undefined;
}

function cerrarSegmentoTool(
  segmentos: SegmentoStream[],
  id: string,
  name: string,
  input: Record<string, unknown>,
  output: string,
  status: EstadoTool,
): void {
  const existente = buscarSegmentoTool(segmentos, id, name);
  if (existente) {
    existente.input = input;
    existente.output = output;
    existente.status = status;
  } else {
    segmentos.push({ kind: "tool", id, name, input, output, status });
  }
}

export type MotivoBarridoTurno = "fin_turno" | "cancelacion" | "error";

export const MARCADORES_FIN_DE_TURNO = {
  finTurno: "[TURNO_INTERRUMPIDO]",
  cancelacion: "[TURNO_CANCELADO]",
  error: "[TURNO_FALLIDO]",
  aprobacionCancelada: "[APROBACION_CANCELADA]",
} as const;

export type EstadoFinalTool = Extract<EstadoTool, "completed" | "rejected" | "error">;

export type MarcadorFinDeTurno = (typeof MARCADORES_FIN_DE_TURNO)[keyof typeof MARCADORES_FIN_DE_TURNO];

const ESTADO_POR_MARCADOR: Record<MarcadorFinDeTurno, EstadoFinalTool> = {
  [MARCADORES_FIN_DE_TURNO.finTurno]: "error",
  [MARCADORES_FIN_DE_TURNO.cancelacion]: "error",
  [MARCADORES_FIN_DE_TURNO.error]: "error",
  [MARCADORES_FIN_DE_TURNO.aprobacionCancelada]: "rejected",
};

export function detectarMarcadorFinDeTurno(
  texto: string | null | undefined,
): MarcadorFinDeTurno | null {
  if (typeof texto !== "string" || texto.length === 0) return null;
  for (const marcador of Object.values(MARCADORES_FIN_DE_TURNO)) {
    if (texto.includes(marcador)) return marcador;
  }
  return null;
}

export function clasificarEstadoToolResult(
  output: string,
  statusToolMessage?: string,
): EstadoFinalTool {
  const marcador = detectarMarcadorFinDeTurno(output);
  if (marcador) return ESTADO_POR_MARCADOR[marcador];
  const bloqueada =
    output.startsWith(APPROVAL_MESSAGE_PREFIXES.rejected) ||
    output.startsWith(APPROVAL_MESSAGE_PREFIXES.expired) ||
    output.startsWith(APPROVAL_MESSAGE_PREFIXES.roleBlocked) ||

    output.startsWith(APPROVAL_MESSAGE_PREFIXES.sessionProtected);
  if (bloqueada) return "rejected";
  return statusToolMessage === "error" ? "error" : "completed";
}

const CIERRE_TOOL_INTERRUMPIDA: Record<MotivoBarridoTurno, string> = {
  fin_turno: `${MARCADORES_FIN_DE_TURNO.finTurno} La herramienta no reportó resultado antes de finalizar el turno.`,
  cancelacion: `${MARCADORES_FIN_DE_TURNO.cancelacion} El turno se canceló mientras la herramienta estaba en curso; puede que no llegara a aplicarse.`,
  error: `${MARCADORES_FIN_DE_TURNO.error} El turno falló mientras la herramienta estaba en curso; revisa el estado del dispositivo antes de reintentar.`,
};

const CIERRE_APROBACION_PENDIENTE: Record<MotivoBarridoTurno, string> = {
  fin_turno: `${MARCADORES_FIN_DE_TURNO.aprobacionCancelada} El turno finalizó sin respuesta de aprobación.`,
  cancelacion: `${MARCADORES_FIN_DE_TURNO.aprobacionCancelada} El turno se canceló sin respuesta a la aprobación.`,
  error: `${MARCADORES_FIN_DE_TURNO.aprobacionCancelada} El turno terminó sin respuesta a la aprobación.`,
};

export const CIERRE_DELEGACION_FIN_TURNO =
  "Delegación completada: el sub-agente entregó su resultado al supervisor (su texto forma parte de la respuesta del turno).";

function esDelegacion(segmento: SegmentoStream): boolean {
  return segmento.kind === "tool" && segmento.name === "task";
}

export function cerrarSegmentosPendientes(
  streamSegments: SegmentoStream[],
  send: (event: string, data: unknown) => void,
  toolExecutions: ToolExecution[],
  motivo: MotivoBarridoTurno = "fin_turno",
): void {
  const cerrados = new Set<string>();
  for (const segmento of streamSegments) {
    if (segmento.kind !== "tool") continue;
    if (segmento.status !== "running" && segmento.status !== "waiting_approval") continue;
    if (cerrados.has(segmento.id)) continue;
    cerrados.add(segmento.id);
    const delegacionCompletada = motivo === "fin_turno" && esDelegacion(segmento);
    const esperandoAprobacion = segmento.status === "waiting_approval" && !delegacionCompletada;
    const output = delegacionCompletada
      ? CIERRE_DELEGACION_FIN_TURNO
      : esperandoAprobacion
        ? CIERRE_APROBACION_PENDIENTE[motivo]
        : CIERRE_TOOL_INTERRUMPIDA[motivo];
    const status = delegacionCompletada
      ? "completed"
      : clasificarEstadoToolResult(output);
    segmento.status = status;
    segmento.output = output;
    send(SSE_EVENTOS.toolCallResult, {
      id: segmento.id,
      name: segmento.name,
      input: segmento.input,
      output,
      status,
    });
    if (!toolExecutions.some((ejecucion) => ejecucion.id === segmento.id)) {
      toolExecutions.push({
        id: segmento.id,
        name: segmento.name,
        input: segmento.input,
        output,
        status,
      });
    }
  }
}

export function mapLlmError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("user not found")) {
    return `Proveedor LLM: autenticación fallida (User not found). Verifica tu API Key en /dashboard/configuration. Detalle: ${message}`;
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("authorization failed")) {
    return `Proveedor LLM rechazó la petición (403 Forbidden). Verifica API Key y baseUrl del modelo en /dashboard/configuration. Detalle: ${message}`;
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("incorrect api key")) {
    return `API Key inválida o expirada (401). Revisa la API Key del proveedor en /dashboard/configuration. Detalle: ${message}`;
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist"))) {
    return `Modelo no encontrado en el proveedor. Verifica el "modelName" en /dashboard/configuration. Detalle: ${message}`;
  }
  if (lower.includes("api key") && (lower.includes("missing") || lower.includes("faltante"))) {
    return message; // ya viene con mensaje amigable desde Model.ts
  }
  if (lower.includes("no hay ningún proveedor")) {
    return message;
  }
  if (lower.includes("recursion limit")) {
    return `El agente excedió el límite de pasos internos. Se han aplicado límites de seguridad; intenta una tarea más acotada. Detalle: ${message}`;
  }
  if (lower.includes("empty response") && lower.includes("chat model call")) {
    return "El proveedor de IA devolvió una respuesta vacía (no emitió ningún token). Verifica que el modelo esté cargado y disponible en el proveedor configurado e inténtalo de nuevo.";
  }
  return message;
}

export type LineasTerminal = 0 | 10 | 25 | 50 | 100;

export interface SeleccionTurno {
  modelProviderId?: string;
  connectionType?: string;

  provider?: string;
  gns3ProjectId?: string | null;

  connectionId?: string;

  terminalSessionId?: string;
  terminalContextLines: LineasTerminal;

  terminalTail?: string;
  origin: "terminal" | "chat";
  autonomousMode: boolean;
}

export interface UsuarioTurno {
  id: string;
  username: string;
  role: string;
}

export interface ChatTurno {
  id: string;
  userId: string;
  modelProviderId: string | null;
  connectionId: string | null;
  gns3ProjectId: string | null;
}

export interface MensajeTurno {
  id: string;
  content: string;
  attachments: AdjuntoDeTurno[];
}

export interface ArgumentosTurno {
  req: Request;
  res: Response;
  chat: ChatTurno;
  usuario: UsuarioTurno;

  mensaje: MensajeTurno;
  seleccion: SeleccionTurno;

  reserva: ReservaTurno | null;

  emitirUserMessage?: boolean;
}

export async function ejecutarTurnoEnStream(
  args: ArgumentosTurno,
): Promise<{ assistant: unknown | null }> {
  const { req, res, chat, usuario, mensaje, seleccion, reserva } = args;
  const emitirUserMessage = args.emitirUserMessage ?? true;

  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const turnAbort = new AbortController();

  const mention = await resolveMention(mensaje.content, usuario.id);
  let connectionDevice: ConnectionDevice | null = null;
  let connectionTarget: ResolvedConnectionTarget | null = null;
  let resolvedSessionId: string | undefined;

  if (mention.providerId || mention.sessionId) {
    resolvedSessionId = mention.sessionId ?? undefined;
    if (mention.providerId) connectionDevice = await findDeviceByConnectionId(mention.providerId);
  } else if (seleccion.connectionId) {
    connectionDevice = await findDeviceByConnectionId(seleccion.connectionId);
  } else {
    const explicitSession = seleccion.terminalSessionId
      ? terminalSessionHub.getSnapshotForUser(usuario.id, seleccion.terminalSessionId)
      : null;
    const autoSession =
      seleccion.origin === "terminal"
        ? terminalSessionHub.getActiveSnapshot(usuario.id)
        : null;
    resolvedSessionId = explicitSession?.sessionId ?? autoSession?.sessionId ?? undefined;
  }

  if (connectionDevice) {
    connectionTarget = await buildConnectionTarget(usuario.id, connectionDevice);
    if (!resolvedSessionId) resolvedSessionId = connectionTarget.sessionId ?? undefined;
  }

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const contextoLog: ContextoLogAgente = {
    userId: usuario.id,
    chatId: chat.id,
    threadId: `${chat.id}:${mensaje.id}`,
    actor: { username: usuario.username, role: usuario.role },
    modelo: seleccion.modelProviderId ?? seleccion.provider ?? "default",
    origen: seleccion.origin,
  };

  let ultimoPlan: PasoPlan[] | null = null;
  const send = (event: string, data: unknown) => {
    if (event === "plan_update") {
      const plan = normalizarPlan(data);
      if (plan.length > 0) ultimoPlan = plan;
    }

    observarEventoDeAgente(contextoLog, event, data);
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
  }, 20000);

  res.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);

    reserva?.liberar();

    turnAbort.abort();
    if (!res.writableEnded) approvalBroker.cancelChat(chat.id, "client_abort");
  });

  if (emitirUserMessage) send(SSE_EVENTOS.userMessage, mensaje);

  let answer = "";
  let reasoningText = "";
  let streamError: string | null = null;

  let presupuestoAgotado = false;

  let turnoCancelado = false;

  let turnoIncompleto = false;
  const toolExecutions: ToolExecution[] = [];

  const streamSegments: SegmentoStream[] = [];

  const telemetriaActiva = envConfig.AGENT_TOKEN_LOGGING === true;
  const inicioTurno = Date.now();
  let turnoMetricas = telemetriaActiva
    ? nuevoTurno({ chatId: chat.id, threadId: "", role: usuario.role, deep: true })
    : null;

  let mensajesTurno: unknown[] = [];

  const bloqueTailTerminal = construirBloqueTailTerminal(
    seleccion.terminalContextLines,
    seleccion.terminalTail,
  );

  let desgloseTurno: DesgloseTurno | undefined;

  try {

    resetApprovalAttempts(chat.id);

    await refrescarLogsDeAgente();
    await requestContext.run(
      {
        id: usuario.id,
        username: usuario.username,
        role: usuario.role,
        autonomous: seleccion.autonomousMode && (usuario.role === "ADMIN" || usuario.role === "STAFF"),
        approvalChannel: { emit: send, chatId: chat.id },
        terminalSessionId: resolvedSessionId,
        terminalContextLines: seleccion.terminalContextLines,
        terminalOrigin: seleccion.origin,
        mentionedProviderId: mention.providerId,
        connectionProviderId: connectionDevice?.id ?? null,
        connectionName: connectionDevice?.name ?? mention.deviceName ?? null,
        connectionProtocol: connectionDevice?.protocol ?? null,
        connectionFingerprint: connectionTarget?.fingerprint ?? null,
        gns3ProjectId:
          (seleccion.gns3ProjectId !== undefined ? seleccion.gns3ProjectId : chat.gns3ProjectId) ??
          null,
        abortSignal: turnAbort.signal,
      },
      async () => {

        const recent = await prismaClient.message.findMany({
          where: {
            chatId: chat.id,
            role: { in: ["user", "assistant"] },
            id: { not: mensaje.id },
          },
          orderBy: { createdAt: "desc" },
          take: HISTORIAL_FETCH,
        });
        const historyMessages = buildHistoryMessages(
          recent
            .reverse()
            .map((item) => ({ role: item.role, content: item.content })),
        );

        const contenidoBase = await construirContenidoMultimodal(
          mensaje.content,
          mensaje.attachments,
        );
        const contenidoRecortado = truncarContenidoTurno(
          mention.rag
            ? anexarContextoRag(contenidoBase, await construirContextoRag(mensaje.content, send))
            : contenidoBase,
          envConfig.AGENT_USER_MESSAGE_CHARS,
        );

        const contenidoActual = anexarBloqueTexto(contenidoRecortado, bloqueTailTerminal);

        const mensajes = [...historyMessages, new HumanMessage(contenidoActual)];
        mensajesTurno = mensajes;

        registrarInicioDeTurno(contextoLog, {
          prompt: mensaje.content,
          modelo: contextoLog.modelo,

        });

        if (telemetriaActiva) {
          const cabeceraTerminal = buildTerminalHeaderBlock();
          desgloseTurno = estimarDesgloseTurno({
            promptBase: BASE_SUPERVISOR_PROMPT,
            bloquesDinamicos: await estimarPromptDinamico({
              role: usuario.role,
              provider: connectionTarget?.graphProvider ?? seleccion.provider ?? "default",
              connection: toDeepConnection(connectionTarget?.connection),
              ragPrefetched: mention.rag === true,
              webRequired: mention.web === true,
              skillRequested: mention.skill ?? null,
              chatId: chat.id,
              origin: seleccion.origin,
            }),
            terminal: `${cabeceraTerminal}${bloqueTailTerminal}`,

            historial: [...historyMessages, { content: contenidoRecortado }],
          });
        }

        const { stream, deep } = await createTurnStream({
          messages: mensajes,
          chatId: chat.id,
          messageId: mensaje.id,
          role: usuario.role,
          modelProviderId: seleccion.modelProviderId,
          provider: connectionTarget?.graphProvider ?? seleccion.provider ?? "default",
          connectionType: seleccion.connectionType,
          connection: connectionTarget?.connection ?? null,

          ragPrefetched: mention.rag === true,
          webRequired: mention.web === true,

          skillRequested: mention.skill ?? null,
          origin: seleccion.origin,
          emit: send,
          signal: turnAbort.signal,
        });

        const pendingToolCalls = new Map<string, PendingToolCall>();

        for await (const item of stream) {
          if (process.env.AGENT_DEBUG_STREAM === "true") {
            Logger.info({ message: `[STREAM_DEBUG] item=${describirFormaStream(item)}` });
          }
          const chunk = extractStreamChunk(item);
          if (!chunk) continue;

          if (isToolMessageChunk(chunk)) {
            const toolId = String(chunk.tool_call_id ?? "");
            const toolName = String(chunk.name ?? "");
            const pending = pendingToolCalls.get(toolId);
            const inputResultado = parseToolArgs(pending?.args ?? "");
            if (deep) {

              const target = resolveHandoffTarget(toolName, inputResultado);
              if (target) send(SSE_EVENTOS.handoff, { from: "general", to: target });
            }
            if (pending && !pending.started) {
              pending.started = true;
              send(SSE_EVENTOS.toolCallStart, { id: toolId, name: toolName, input: inputResultado });
              iniciarSegmentoTool(streamSegments, toolId, toolName, inputResultado);
              if (deep) emitirTransparenciaAlIniciar(send, toolName, inputResultado);
            }
            const output = String(chunk.content ?? "").slice(0, 2000);

            const status = clasificarEstadoToolResult(output, chunk.status);
            send(SSE_EVENTOS.toolCallResult, { id: toolId, name: toolName, input: inputResultado, output, status });
            if (deep) emitirTransparenciaAlTerminar(send, toolName, inputResultado, output, status);
            cerrarSegmentoTool(streamSegments, toolId, toolName, inputResultado, output, status);
            toolExecutions.push({
              id: toolId,
              name: toolName,
              input: inputResultado,
              output,
              status,
            });
            pendingToolCalls.delete(toolId);
            continue;
          }

          const chunkType = chunk?.getType?.();

          if (chunkType === "ai") {
            const reasoningDelta = extractReasoning(chunk);
            if (reasoningDelta) {
              reasoningText += reasoningDelta;
              send(SSE_EVENTOS.reasoning, { content: reasoningDelta });
            }

            const text = extractVisibleText(chunk);
            if (text) {
              answer += text;
              send(SSE_EVENTOS.textDelta, { content: text });
              anexarTextoSegmento(streamSegments, text);
            }

            const toolCallChunks = chunk.tool_call_chunks;
            if (Array.isArray(toolCallChunks)) {
              for (const callChunk of toolCallChunks) {

                const callId = callChunk?.id;
                if (!callId) continue;
                let pending = pendingToolCalls.get(callId);
                if (!pending) {
                  pending = { name: "", args: "", started: false };
                  pendingToolCalls.set(callId, pending);
                }
                if (callChunk?.name && !pending.name) pending.name = callChunk.name;
                pending.args += callChunk?.args ?? "";
                if (pending.name && !pending.started) {
                  pending.started = true;
                  send(SSE_EVENTOS.toolCallStart, { id: callId, name: pending.name, input: {} });
                  iniciarSegmentoTool(streamSegments, callId, pending.name, {});
                }
              }
            }

            if (Array.isArray(chunk.tool_calls)) {
              for (const call of chunk.tool_calls) {
                const callId = call?.id;
                const callName = call?.name;
                if (!callId || !callName) continue;
                let pending = pendingToolCalls.get(callId);
                if (!pending) {
                  pending = { name: callName, args: "", started: false };
                  pendingToolCalls.set(callId, pending);
                }
                if (!pending.name) pending.name = callName;
                const argsCompletos = typeof call.args === "string" ? call.args : JSON.stringify(call.args ?? {});
                pending.args = argsCompletos;
                if (!pending.started) {
                  pending.started = true;
                  const input = parseToolArgs(pending.args);
                  send(SSE_EVENTOS.toolCallStart, { id: callId, name: callName, input });
                  iniciarSegmentoTool(streamSegments, callId, callName, input);
                  if (deep) emitirTransparenciaAlIniciar(send, callName, input);
                }
              }
            }
          }
        }
      },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Error ejecutando el agente";
    const mapped = mapLlmError(raw);

    const code = codigoDeErrorStream(error, turnAbort.signal);
    presupuestoAgotado = code === "budget_exhausted";
    turnoCancelado = code === "cancelled";
    turnoIncompleto = !presupuestoAgotado;

    streamError = turnoCancelado ? MENSAJE_CANCELACION : mapped;
    Logger.error({
      message: "[CHAT_STREAM] Error en streaming del agente",
      data: { chatId: chat.id, modelProviderId: seleccion.modelProviderId, code, raw },
    });

    send(SSE_EVENTOS.error, { message: streamError, code });
  }

  if (!streamError && !presupuestoAgotado && turnAbort.signal.aborted) {
    turnoCancelado = true;
    turnoIncompleto = true;
    streamError = MENSAJE_CANCELACION;
    Logger.info({ message: "[CHAT_STREAM] Turno cortado por el cliente sin excepción", data: { chatId: chat.id } });
    if (!res.writableEnded && !res.destroyed) {
      send(SSE_EVENTOS.error, { message: streamError, code: "cancelled" });
    }
  }

  cerrarSegmentosPendientes(
    streamSegments,
    send,
    toolExecutions,
    turnoCancelado ? "cancelacion" : streamError ? "error" : "fin_turno",
  );

  if (turnoMetricas) {
    registrarNodo(turnoMetricas, {
      node: "deep_supervisor",
      tokensEntrada: estimarTokensMensajes(mensajesTurno),
      tokensSalida: estimarTokens(answer),
      duracionMs: Date.now() - inicioTurno,
      toolCalls: toolExecutions.length,
      ...(desgloseTurno ?? {
        tokensSystemEstimado: 0,
        tokensToolsEstimado: 0,
        tokensTerminalEstimado: 0,
        tokensHistorialEstimado: estimarTokensMensajes(mensajesTurno),
      }),
    });
    turnoMetricas.turnos += 1;
    cerrarTurno(turnoMetricas);
  }

  const planFinal = ultimoPlan as PasoPlan[] | null;

  registrarFinDeTurno(contextoLog, {
    resultado: streamError
      ? turnoCancelado
        ? "cancelado"
        : presupuestoAgotado
          ? "presupuesto"
          : "error"
      : "completo",
    duracionMs: Date.now() - inicioTurno,
    toolCalls: toolExecutions.length,

    tokensEntrada: estimarTokensMensajes(mensajesTurno),
    tokensSalida: estimarTokens(answer),
    pasosPendientes: planFinal
      ? planFinal.filter((paso) => paso.status !== "completed").length
      : undefined,
    ...(answer ? { respuesta: answer } : {}),
    ...(streamError ? { error: streamError } : {}),
  });

  let assistant: unknown | null = null;
  if (answer || streamSegments.length > 0) {

    const textoSegmentos = streamSegments
      .filter((segmento): segmento is Extract<SegmentoStream, { kind: "text" }> => segmento.kind === "text")
      .map((segmento) => segmento.text)
      .join("");
    let contenidoFinal =
      answer || textoSegmentos || "El agente ejecutó herramientas sin generar una respuesta final.";

    if (ultimoPlan) insertarSegmentoPlan(streamSegments, ultimoPlan);

    if (presupuestoAgotado) {
      contenidoFinal = anexarAvisoPresupuesto(contenidoFinal);
      anexarAvisoPresupuestoSegmento(streamSegments);
    } else if (turnoIncompleto) {
      const motivo: MotivoTurnoIncompleto = turnoCancelado ? "cancelado" : "error";
      contenidoFinal = anexarAvisoTurnoIncompleto(contenidoFinal, motivo);
      anexarAvisoTurnoIncompletoSegmento(streamSegments, motivo);
    }
    assistant = await prismaClient.message.create({
      data: {
        chatId: chat.id,
        role: "assistant",
        content: contenidoFinal,
        toolCalls:
          toolExecutions.length > 0
            ? (toolExecutions as unknown as Prisma.InputJsonValue)
            : undefined,
        reasoning: reasoningText.trim() || undefined,

        segments:
          streamSegments.length > 0
            ? (streamSegments as unknown as Prisma.InputJsonValue)
            : undefined,
      },
    });
    await prismaClient.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
    send(SSE_EVENTOS.complete, assistant);
  } else if (streamError) {

    assistant = await prismaClient.message.create({
      data: { chatId: chat.id, role: "assistant", content: streamError },
    });
    await prismaClient.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
    send(SSE_EVENTOS.complete, assistant);
  } else {
    assistant = await prismaClient.message.create({
      data: {
        chatId: chat.id,
        role: "assistant",
        content: "El agente no devolvió contenido. Verifica que el proveedor de IA esté configurado correctamente.",
      },
    });
    await prismaClient.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
    send(SSE_EVENTOS.complete, assistant);
  }

  if (heartbeat) clearInterval(heartbeat);

  reserva?.liberar();
  res.end();
  return { assistant };
}
