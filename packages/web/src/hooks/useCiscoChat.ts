"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectarAvisoCorte,
  esErrorDeAbort,
  textoDeSegmentos,
  type MotivoCorte,
} from "@/component/chat/turnoCorte";
import type { LineasTailTerminal } from "@/store/terminal.store";

export type ChatRole = "user" | "assistant";
export type ChatAttachmentType = "IMAGE" | "DOCUMENT";

export interface ChatAttachment {
  id?: string;
  fileName: string;
  fileType: ChatAttachmentType;
  mimeType?: string | null;
  fileUrl?: string | null;
}

export interface ChatMessageRecord {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string | Date;
  attachments?: ChatAttachment[];
  toolCalls?: ToolExecution[];
  reasoning?: string;
  segments?: PersistedSegment[];

  turnoCorte?: MotivoCorte;
}

export interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;

  messages: ChatMessageRecord[];

  messageCount?: number;

  attachmentCount?: number;
}

export interface ToolExecution {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status:
    | "running"
    | "waiting_approval"
    | "completed"
    | "rejected"
    | "error";

  approvalId?: string;
}

export type StreamSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: ToolExecution }
  | { kind: "plan"; todos: PlanTodo[] };

export type PersistedSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: ToolExecution }
  | { kind: "plan"; todos: PlanTodo[] };

const VALID_TOOL_STATUS: ToolExecution["status"][] = [
  "running",
  "waiting_approval",
  "completed",
  "rejected",
  "error",
];

export interface NormalizarOptions {
  finalizado?: boolean;
}

function cerrarToolPendiente(tool: ToolExecution): ToolExecution {
  if (tool.status !== "running" && tool.status !== "waiting_approval") {
    return tool;
  }
  const esperabaAprobacion = tool.status === "waiting_approval";
  const tieneSalida =
    typeof tool.output === "string" && tool.output.trim().length > 0;
  return {
    ...tool,
    status: "error",
    output: tieneSalida
      ? tool.output
      : esperabaAprobacion
        ? "[APROBACION_CANCELADA] Sin respuesta de aprobación registrada."
        : "[TURNO_INTERRUMPIDO] Sin resultado registrado.",
  };
}

export function normalizarTodosPlan(raw: unknown): PlanTodo[] {
  if (!Array.isArray(raw)) return [];
  const todos: PlanTodo[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const t = item as Record<string, unknown>;
    const content =
      typeof t.content === "string"
        ? t.content
        : typeof t === "string"
          ? t
          : "";
    if (!content) return;
    const status =
      t.status === "in_progress" || t.status === "completed"
        ? (t.status as PlanTodoStatus)
        : "pending";
    todos.push({
      id: typeof t.id === "string" && t.id ? t.id : `todo-${index}`,
      content,
      status,
    });
  });
  return todos;
}

export function normalizarSegmentos(
  raw: unknown,
  { finalizado = false }: NormalizarOptions = {},
): PersistedSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const segments: PersistedSegment[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    if (s.kind === "text") {
      if (typeof s.text === "string") {
        segments.push({ kind: "text", text: s.text });
      }
      continue;
    }
    if (s.kind === "plan") {
      const todos = normalizarTodosPlan(s.todos);
      if (todos.length > 0) segments.push({ kind: "plan", todos });
      continue;
    }
    if (s.kind === "tool") {
      if (typeof s.id !== "string" || !s.id) continue;
      if (typeof s.name !== "string" || !s.name) continue;
      const tool: ToolExecution = {
        id: s.id,
        name: s.name,
        input:
          s.input && typeof s.input === "object"
            ? (s.input as Record<string, unknown>)
            : {},
        output:
          typeof s.output === "string"
            ? s.output
            : s.output != null
              ? JSON.stringify(s.output)
              : undefined,
        status:
          typeof s.status === "string" &&
          VALID_TOOL_STATUS.includes(s.status as ToolExecution["status"])
            ? (s.status as ToolExecution["status"])
            : "completed",
      };
      segments.push({
        kind: "tool",
        tool: finalizado ? cerrarToolPendiente(tool) : tool,
      });
    }
  }
  return segments.length > 0 ? segments : undefined;
}

function normalizeToolCalls(
  raw: unknown,
  { finalizado = false }: NormalizarOptions = {},
): ToolExecution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tools: ToolExecution[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.name !== "string" || !t.name) continue;
    const tool: ToolExecution = {
      id: typeof t.id === "string" && t.id ? t.id : `tool-${tools.length}`,
      name: t.name,
      input:
        t.input && typeof t.input === "object"
          ? (t.input as Record<string, unknown>)
          : {},
      output:
        typeof t.output === "string"
          ? t.output
          : t.output != null
            ? JSON.stringify(t.output)
            : undefined,
      status:
        typeof t.status === "string" &&
        VALID_TOOL_STATUS.includes(t.status as ToolExecution["status"])
          ? (t.status as ToolExecution["status"])
          : "completed",
    };
    tools.push(finalizado ? cerrarToolPendiente(tool) : tool);
  }
  return tools.length > 0 ? tools : undefined;
}

function motivoCorteDelMensaje(
  role: ChatRole,
  content: string,
  segments: PersistedSegment[] | undefined,
): MotivoCorte | null {
  if (role !== "assistant") return null;
  return (
    detectarAvisoCorte(content)?.motivo ??
    (segments ? detectarAvisoCorte(textoDeSegmentos(segments))?.motivo : null) ??
    null
  );
}

export function normalizeChatMessage(
  raw: unknown,
  options: NormalizarOptions = {},
): ChatMessageRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string") return null;
  const toolCalls = normalizeToolCalls(m.toolCalls, options);
  const reasoning =
    typeof m.reasoning === "string" && m.reasoning ? m.reasoning : undefined;
  const segments = normalizarSegmentos(m.segments, options);
  const role: ChatRole = m.role === "assistant" ? "assistant" : "user";
  const content = typeof m.content === "string" ? m.content : "";
  const turnoCorte = motivoCorteDelMensaje(role, content, segments);
  return {
    id: m.id,
    role,
    content,
    createdAt:
      typeof m.createdAt === "string" ? m.createdAt : new Date().toISOString(),
    attachments: Array.isArray(m.attachments)
      ? (m.attachments as ChatAttachment[])
      : [],
    ...(toolCalls ? { toolCalls } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(segments?.length ? { segments } : {}),
    ...(turnoCorte ? { turnoCorte } : {}),
  };
}

export function normalizeSessionMessages(
  raw: unknown,
  { finalizado = true }: NormalizarOptions = {},
): ChatMessageRecord[] {
  if (!Array.isArray(raw)) return [];
  const messages: ChatMessageRecord[] = [];
  for (const item of raw) {
    const message = normalizeChatMessage(item, { finalizado });
    if (message) messages.push(message);
  }
  return messages;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  modelName: string;
}

export type AgentProgressPhase =
  | "reading"
  | "sending"
  | "waiting_prompt"
  | "terminal_required"
  | "connected"
  | "disconnected"
  | "configuring"
  | "verifying"
  | "unknown";

export interface AgentProgressEvent {
  phase: AgentProgressPhase;

  phaseRaw?: string;
  detail?: string;
  toolCallId?: string;
  name?: string;
}

const VALID_AGENT_PROGRESS_PHASES: AgentProgressPhase[] = [
  "reading",
  "sending",
  "waiting_prompt",
  "terminal_required",
  "connected",
  "disconnected",
  "configuring",
  "verifying",
];

export function esFaseConocida(phase: string): phase is AgentProgressPhase {
  return (VALID_AGENT_PROGRESS_PHASES as string[]).includes(phase);
}

export interface ToolStartEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolEndEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  status: "completed" | "error" | "rejected";
}

export type ApprovalDecision = "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  approvalId: string;
  toolCallId: string;
  name: string;
  toolLabel: string;
  level: "config";

  risk?: "config" | "dangerous";
  commands: string[];
  deviceName: string | null;
  providerId: string | null;
  summary: string;
  expiresAt: string;
  status: "pending" | ApprovalDecision;
}

export interface ToolApprovalResolvedEvent {
  approvalId: string;
  toolCallId: string;
  decision: ApprovalDecision;
}

export interface TerminalCommandEvent {
  toolCallId: string;
  name: string;
  deviceName: string | null;
  protocol: string | null;
  commands: string[];
  routed: boolean;
}

export type TerminalOpenPayload = {
  providerId?: string;
  type?: "SSH" | "TELNET" | "SERIAL";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  serialPort?: string;
  baudRate?: number;
  deviceName?: string;
};

export type TerminalOpenRequest = {
  requestId: string;
  toolCallId?: string;
  toolName: string;
  summary: string;
  autoOpen: boolean;
  payload: TerminalOpenPayload;
};

export type TerminalOpenResolved = {
  requestId: string;
  accepted: boolean;
  sessionId?: string;
  error?: string;
};

function parseTerminalOpenPayload(raw: unknown): TerminalOpenPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  return {
    ...(typeof p.providerId === "string" ? { providerId: p.providerId } : {}),
    ...(p.type === "SSH" || p.type === "TELNET" || p.type === "SERIAL"
      ? { type: p.type }
      : {}),
    ...(typeof p.host === "string" ? { host: p.host } : {}),
    ...(typeof p.port === "number" ? { port: p.port } : {}),
    ...(typeof p.username === "string" ? { username: p.username } : {}),
    ...(typeof p.password === "string" ? { password: p.password } : {}),
    ...(typeof p.serialPort === "string" ? { serialPort: p.serialPort } : {}),
    ...(typeof p.baudRate === "number" ? { baudRate: p.baudRate } : {}),
    ...(typeof p.deviceName === "string" ? { deviceName: p.deviceName } : {}),
  };
}

export interface ReasoningEvent {
  content: string;
}

export interface HandoffEvent {
  from: string;
  to: string;
}

export type CodigoErrorStream = "budget_exhausted" | "cancelled" | "agent_error";

const VALID_CODIGOS_ERROR: CodigoErrorStream[] = [
  "budget_exhausted",
  "cancelled",
  "agent_error",
];

export function codigoErrorStream(code: string): CodigoErrorStream | undefined {
  return VALID_CODIGOS_ERROR.find((valido) => valido === code);
}

export type PlanTodoStatus = "pending" | "in_progress" | "completed";

export interface PlanTodo {
  id: string;
  content: string;
  status: PlanTodoStatus;
}

export interface PlanUpdateEvent {
  todos: PlanTodo[];
}

export interface SkillLoadingEvent {
  skillName: string;
  description?: string;
}

export interface SkillLoadedEvent {
  skillName: string;
}

export interface SkillCreatedEvent {
  skillId: string;
  title: string;
}

export interface SubagentEvent {
  name: string;

  task?: string;
  summary?: string;
}

export interface RagRetrievedEvent {
  sources: string[];
  chunksUsed: number;
}

export interface AdminActionEvent {
  action: string;
  target: string;
  result: "ok" | "error";
}

export interface StreamChatPayload {
  content: string;
  provider?: string;

  clientMessageId?: string;

  connectionId?: string;
  modelProviderId?: string;

  autonomousMode?: boolean;

  terminalSessionId?: string;

  terminalContextLines?: LineasTailTerminal;

  terminalTail?: string;

  origin?: "terminal" | "chat";
  attachments?: Array<{
    fileName: string;
    fileType: ChatAttachmentType;
    mimeType?: string;
    fileUrl?: string;
  }>;
}

export interface StreamChatHandlers {
  onUserMessage?(m: unknown): void;
  onToken(t: string): void;
  onToolStart?(t: ToolStartEvent): void;
  onToolEnd?(t: ToolEndEvent): void;
  onToolApprovalRequired?(t: ApprovalRequest): void;
  onToolApprovalResolved?(t: ToolApprovalResolvedEvent): void;
  onTerminalCommand?(t: TerminalCommandEvent): void;
  onTerminalOpenRequested?(t: TerminalOpenRequest): void;
  onTerminalOpenResolved?(t: TerminalOpenResolved): void;
  onAgentProgress?(e: AgentProgressEvent): void;
  onReasoning?(t: ReasoningEvent): void;
  onHandoff?(t: HandoffEvent): void;

  onPlanUpdate?(e: PlanUpdateEvent): void;
  onSkillLoading?(e: SkillLoadingEvent): void;
  onSkillLoaded?(e: SkillLoadedEvent): void;
  onSkillCreated?(e: SkillCreatedEvent): void;
  onSubagentStarted?(e: SubagentEvent): void;
  onSubagentCompleted?(e: SubagentEvent): void;
  onRagRetrieved?(e: RagRetrievedEvent): void;
  onAdminAction?(e: AdminActionEvent): void;

  onError(msg: string, code?: string): void;
  onComplete(m: unknown): void;
}

export interface StreamChatOptions {
  signal?: AbortSignal;

  retry?: { mensajeUsuarioId: string };
}

interface CuerpoRechazo {
  message?: string;
  code?: string;
  data?: Record<string, unknown> | null;
}

function leerRechazo(body: CuerpoRechazo | null): {
  message: string;
  code: CodigoRechazoEnvio;
  data: Record<string, unknown> | null;
} | null {
  const code = body?.code;
  if (
    code !== "DUPLICADO" &&
    code !== "TURNO_EN_CURSO" &&
    code !== "YA_REINTENTADO"
  ) {
    return null;
  }
  return {
    message: body?.message ?? "El backend rechazó el envío",
    code,
    data: body?.data ?? null,
  };
}

interface SseBlock {
  event: string;
  data: string;
}

function parseSseBlock(block: string): SseBlock | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const raw of block.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractString(data: unknown, key: string): string {
  if (typeof data === "object" && data !== null && key in data) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return "";
}

export type CodigoRechazoEnvio =
  | "DUPLICADO"
  | "TURNO_EN_CURSO"
  | "YA_REINTENTADO";

export function nuevoClientMessageId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) return uuid;
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class ErrorEnvioRechazado extends Error {

  readonly code: CodigoRechazoEnvio;

  readonly messageId: string | null;

  readonly mensajeExistente: unknown;

  readonly assistantMessageId: string | null;

  constructor(
    message: string,
    datos: {
      code: CodigoRechazoEnvio;
      messageId?: string | null;
      mensajeExistente?: unknown;
      assistantMessageId?: string | null;
    },
  ) {
    super(message);
    this.name = "ErrorEnvioRechazado";
    this.code = datos.code;
    this.messageId = datos.messageId ?? null;
    this.mensajeExistente = datos.mensajeExistente;
    this.assistantMessageId = datos.assistantMessageId ?? null;
  }
}

export class ErrorReintentoNoResoluble extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorReintentoNoResoluble";
  }
}

export async function streamChatMessage(
  chatId: string,
  payload: StreamChatPayload,
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {

  const apiBase = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");
  const mensajeUsuarioId = options.retry?.mensajeUsuarioId;
  const ruta = mensajeUsuarioId
    ? `${apiBase}/api/chats/${chatId}/messages/${encodeURIComponent(mensajeUsuarioId)}/retry`
    : `${apiBase}/api/chats/${chatId}/messages`;
  let res: Response;
  try {
    res = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...payload, stream: true }),
      signal: options.signal,
    });
  } catch (error) {

    if (esErrorDeAbort(error)) return;
    throw error;
  }

  if (!res.ok) {
    let message = `Error ${res.status} al enviar el mensaje`;
    let cuerpo: CuerpoRechazo | null = null;
    try {
      cuerpo = (await res.json()) as CuerpoRechazo;
      if (cuerpo?.message) message = cuerpo.message;
    } catch {

    }

    const rechazo = res.status === 409 ? leerRechazo(cuerpo) : null;
    if (rechazo) {
      const data = rechazo.data;
      const messageId =
        typeof data?.messageId === "string" ? data.messageId : null;
      const assistantMessageId =
        typeof data?.assistantMessageId === "string"
          ? data.assistantMessageId
          : null;
      throw new ErrorEnvioRechazado(rechazo.message, {
        code: rechazo.code,
        messageId,
        mensajeExistente: data?.message,
        assistantMessageId,
      });
    }

    if (mensajeUsuarioId && res.status === 404) {
      throw new ErrorReintentoNoResoluble(message);
    }
    throw new Error(message);
  }

  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBlock = (block: string): boolean => {
    const parsed = parseSseBlock(block);
    if (!parsed) return false;

    const data = safeJsonParse(parsed.data);

    switch (parsed.event) {
      case "user_message":
        handlers.onUserMessage?.(data);
        break;
      case "text_delta": {
        const content = extractString(data, "content");
        if (content) handlers.onToken(content);
        break;
      }
      case "reasoning": {
        const content = extractString(data, "content");
        if (content) handlers.onReasoning?.({ content });
        break;
      }
      case "tool_call_start": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        handlers.onToolStart?.({
          id: typeof d.id === "string" ? d.id : `tool-${Date.now()}`,
          name: typeof d.name === "string" ? d.name : "herramienta",
          input:
            d.input && typeof d.input === "object"
              ? (d.input as Record<string, unknown>)
              : {},
        });
        break;
      }
      case "tool_call_result": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        handlers.onToolEnd?.({
          id: typeof d.id === "string" ? d.id : "",
          name: typeof d.name === "string" ? d.name : "herramienta",
          input:
            d.input && typeof d.input === "object"
              ? (d.input as Record<string, unknown>)
              : {},
          output: typeof d.output === "string" ? d.output : "",
          status:
            d.status === "rejected"
              ? "rejected"
              : d.status === "error"
                ? "error"
                : "completed",
        });
        break;
      }
      case "tool_approval_required": {

        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.approvalId !== "string" || !d.approvalId) break;
        if (typeof d.toolCallId !== "string" || !d.toolCallId) break;
        const commands = Array.isArray(d.commands)
          ? d.commands.filter((c): c is string => typeof c === "string")
          : [];
        handlers.onToolApprovalRequired?.({
          approvalId: d.approvalId,
          toolCallId: d.toolCallId,
          name: typeof d.name === "string" ? d.name : "herramienta",
          toolLabel:
            typeof d.toolLabel === "string" ? d.toolLabel : "Configuración",
          level: "config",
          ...(d.risk === "config" || d.risk === "dangerous"
            ? { risk: d.risk }
            : {}),
          commands,
          deviceName: typeof d.deviceName === "string" ? d.deviceName : null,
          providerId: typeof d.providerId === "string" ? d.providerId : null,
          summary: typeof d.summary === "string" ? d.summary : "",
          expiresAt: typeof d.expiresAt === "string" ? d.expiresAt : "",
          status: "pending",
        });
        break;
      }
      case "tool_approval_resolved": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.approvalId !== "string" || !d.approvalId) break;
        if (typeof d.toolCallId !== "string" || !d.toolCallId) break;
        const decision = d.decision;
        if (
          decision !== "approved" &&
          decision !== "rejected" &&
          decision !== "expired"
        ) {
          break;
        }
        handlers.onToolApprovalResolved?.({
          approvalId: d.approvalId,
          toolCallId: d.toolCallId,
          decision,
        });
        break;
      }
      case "terminal_command": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.toolCallId !== "string" || !d.toolCallId) break;
        const commands = Array.isArray(d.commands)
          ? d.commands.filter((c): c is string => typeof c === "string")
          : [];
        handlers.onTerminalCommand?.({
          toolCallId: d.toolCallId,
          name: typeof d.name === "string" ? d.name : "herramienta",
          deviceName: typeof d.deviceName === "string" ? d.deviceName : null,
          protocol: typeof d.protocol === "string" ? d.protocol : null,
          commands,
          routed: d.routed === true,
        });
        break;
      }
      case "terminal_open_requested": {

        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.requestId !== "string" || !d.requestId) break;
        const payload = parseTerminalOpenPayload(d.payload);
        if (!payload) break;
        handlers.onTerminalOpenRequested?.({
          requestId: d.requestId,
          ...(typeof d.toolCallId === "string" && d.toolCallId
            ? { toolCallId: d.toolCallId }
            : {}),
          toolName:
            typeof d.toolName === "string" && d.toolName
              ? d.toolName
              : "open_terminal_console",
          summary: typeof d.summary === "string" ? d.summary : "",
          autoOpen: d.autoOpen === true,
          payload,
        });
        break;
      }
      case "terminal_open_resolved": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.requestId !== "string" || !d.requestId) break;
        handlers.onTerminalOpenResolved?.({
          requestId: d.requestId,
          accepted: d.accepted === true,
          ...(typeof d.sessionId === "string" ? { sessionId: d.sessionId } : {}),
          ...(typeof d.error === "string" ? { error: d.error } : {}),
        });
        break;
      }
      case "agent_progress": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        const bruto = typeof d.phase === "string" ? d.phase.trim() : "";
        if (!bruto) break;

        const conocida = esFaseConocida(bruto);
        if (!conocida && process.env.NODE_ENV === "development") {
          console.warn(
            "[agent_progress] Fase no reconocida por este cliente:",
            bruto,
            "→ se muestra como fase genérica.",
          );
        }
        handlers.onAgentProgress?.({
          phase: conocida ? bruto : "unknown",
          ...(conocida ? {} : { phaseRaw: bruto }),
          ...(typeof d.detail === "string" ? { detail: d.detail } : {}),
          ...(typeof d.toolCallId === "string" ? { toolCallId: d.toolCallId } : {}),
          ...(typeof d.name === "string" ? { name: d.name } : {}),
        });
        break;
      }
      case "handoff": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.to === "string" && d.to) {
          handlers.onHandoff?.({
            from: typeof d.from === "string" ? d.from : "general",
            to: d.to,
          });
        }
        break;
      }

      case "plan_update": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        const todos = normalizarTodosPlan(d.todos);
        if (todos.length > 0) handlers.onPlanUpdate?.({ todos });
        break;
      }
      case "skill_loading": {
        const d = (data ?? {}) as Record<string, unknown>;
        const skillName =
          typeof d.skillName === "string" ? d.skillName : extractString(data, "name");
        if (!skillName) break;
        handlers.onSkillLoading?.({
          skillName,
          ...(typeof d.description === "string"
            ? { description: d.description }
            : {}),
        });
        break;
      }
      case "skill_loaded": {
        const d = (data ?? {}) as Record<string, unknown>;
        const skillName =
          typeof d.skillName === "string" ? d.skillName : extractString(data, "name");
        if (!skillName) break;
        handlers.onSkillLoaded?.({ skillName });
        break;
      }
      case "skill_created": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.skillId !== "string" || typeof d.title !== "string") break;
        handlers.onSkillCreated?.({ skillId: d.skillId, title: d.title });
        break;
      }
      case "subagent_started": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.name !== "string" || !d.name) break;
        handlers.onSubagentStarted?.({
          name: d.name,
          ...(typeof d.task === "string" ? { task: d.task } : {}),
        });
        break;
      }
      case "subagent_completed": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.name !== "string" || !d.name) break;
        handlers.onSubagentCompleted?.({
          name: d.name,
          ...(typeof d.summary === "string" ? { summary: d.summary } : {}),
        });
        break;
      }
      case "rag_retrieved": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        const sources = Array.isArray(d.sources)
          ? d.sources.filter((s): s is string => typeof s === "string")
          : [];
        handlers.onRagRetrieved?.({
          sources,
          chunksUsed:
            typeof d.chunksUsed === "number" && Number.isFinite(d.chunksUsed)
              ? d.chunksUsed
              : sources.length,
        });
        break;
      }
      case "admin_action": {
        if (typeof data !== "object" || data === null) break;
        const d = data as Record<string, unknown>;
        if (typeof d.action !== "string") break;
        handlers.onAdminAction?.({
          action: d.action,
          target: typeof d.target === "string" ? d.target : "",
          result: d.result === "error" ? "error" : "ok",
        });
        break;
      }
      case "error": {
        const mensaje =
          extractString(data, "message") || "Error ejecutando el agente";

        const codigo = extractString(data, "code");
        handlers.onError(mensaje, codigoErrorStream(codigo));
        break;
      }
      case "complete":
        handlers.onComplete(data);
        return true;
      default:
        break;
    }
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        let finished = false;
        if (block.trim()) finished = processBlock(block);
        if (finished) {
          await reader.cancel().catch(() => undefined);
          return;
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer);
  } catch (error) {
    if (esErrorDeAbort(error)) {
      return;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export interface ResultadoTurno {

  texto: string;

  cancelado: boolean;
}

export function useAgentChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const canceladoRef = useRef(false);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;

    canceladoRef.current = true;
    controller.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(
    async (
      chatId: string,
      payload: StreamChatPayload,
      handlers: Partial<StreamChatHandlers> = {},
      options: StreamChatOptions = {},
    ): Promise<ResultadoTurno> => {
      stop();
      canceladoRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStreamingText("");

      let accumulated = "";

      try {
        await streamChatMessage(
          chatId,
          payload,
          {
            onUserMessage: (m) => handlers.onUserMessage?.(m),
            onToken: (t) => {
              accumulated += t;
              setStreamingText(accumulated);
              handlers.onToken?.(t);
            },
            onToolStart: (t) => handlers.onToolStart?.(t),
            onToolEnd: (t) => handlers.onToolEnd?.(t),
            onToolApprovalRequired: (t) =>
              handlers.onToolApprovalRequired?.(t),
            onToolApprovalResolved: (t) =>
              handlers.onToolApprovalResolved?.(t),
            onTerminalCommand: (t) => handlers.onTerminalCommand?.(t),
            onTerminalOpenRequested: (t) =>
              handlers.onTerminalOpenRequested?.(t),
            onTerminalOpenResolved: (t) =>
              handlers.onTerminalOpenResolved?.(t),
            onAgentProgress: (e) => handlers.onAgentProgress?.(e),
            onReasoning: (t) => handlers.onReasoning?.(t),
            onHandoff: (t) => handlers.onHandoff?.(t),
            onPlanUpdate: (e) => handlers.onPlanUpdate?.(e),
            onSkillLoading: (e) => handlers.onSkillLoading?.(e),
            onSkillLoaded: (e) => handlers.onSkillLoaded?.(e),
            onSkillCreated: (e) => handlers.onSkillCreated?.(e),
            onSubagentStarted: (e) => handlers.onSubagentStarted?.(e),
            onSubagentCompleted: (e) => handlers.onSubagentCompleted?.(e),
            onRagRetrieved: (e) => handlers.onRagRetrieved?.(e),
            onAdminAction: (e) => handlers.onAdminAction?.(e),
            onError: (msg, code) => handlers.onError?.(msg, code),
            onComplete: (m) => handlers.onComplete?.(m),
          },

          { ...options, signal: controller.signal },
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsStreaming(false);
      }

      return { texto: accumulated, cancelado: canceladoRef.current };
    },
    [stop],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  return { isStreaming, streamingText, send, stop };
}

export async function sendApprovalDecision(
  approvalId: string,
  decision: "approve" | "reject",
): Promise<{ success: boolean; message: string; decision?: ApprovalDecision }> {
  try {

    const apiBase = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");
    const res = await fetch(`${apiBase}/api/chats/approvals/${approvalId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ decision }),
    });

    const body = (await res.json().catch(() => null)) as {
      message?: string;
      data?: { decision?: unknown } | null;
    } | null;

    if (!res.ok) {
      return {
        success: false,
        message:
          body?.message || `Error ${res.status} al registrar la decisión`,
      };
    }

    const decisionRaw = body?.data?.decision;
    const decisionBackend =
      decisionRaw === "approved" ||
      decisionRaw === "rejected" ||
      decisionRaw === "expired"
        ? decisionRaw
        : undefined;

    return {
      success: true,
      message: body?.message ?? "Decisión registrada",
      ...(decisionBackend ? { decision: decisionBackend } : {}),
    };
  } catch {
    return {
      success: false,
      message: "No se pudo contactar con el servidor",
    };
  }
}
