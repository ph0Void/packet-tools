import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { envConfig } from "@/config/EnvConfig";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function messageText(message: BaseMessage): string {
  const content = message.content as unknown;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return String(part.text ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function messageTokens(message: BaseMessage): number {
  return estimateTokens(messageText(message)) + 8;
}

export function estimateMessagesTokens(messages: BaseMessage[]): number {
  return messages.reduce((total, message) => total + messageTokens(message), 0);
}

export function compactText(
  text: string,
  maxChars: number,
  etiqueta = "output",
): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  const cabeza = Math.ceil(maxChars * 0.6);
  const cola = Math.max(0, maxChars - cabeza);
  const omitidos = text.length - cabeza - cola;
  return (
    `${text.slice(0, cabeza)}\n` +
    `…[${etiqueta}: ${omitidos} chars omitted of ${text.length}]…\n` +
    `${cola > 0 ? text.slice(-cola) : ""}`
  );
}

export interface TrimOptions {

  maxMessages?: number;

  maxTokens?: number;

  maxToolChars?: number;

  maxContentChars?: number;

  keepTaskAnchor?: boolean;

  dropEmpty?: boolean;
}

const TOOL_CHARS_ANTIGUOS = 1200;

const MARCA_IMAGEN_ANTIGUA = "[imagen adjunta omitida del historial]";

function resolveLimits(options: TrimOptions = {}) {
  return {
    maxMessages: options.maxMessages ?? envConfig.AGENT_HISTORY_MESSAGES,
    maxTokens: options.maxTokens ?? envConfig.AGENT_CONTEXT_TOKENS,
    maxToolChars: options.maxToolChars ?? envConfig.AGENT_TOOL_OUTPUT_CHARS,
    maxContentChars: options.maxContentChars ?? envConfig.AGENT_CONTENT_CHARS,
    keepTaskAnchor: options.keepTaskAnchor ?? true,
    dropEmpty: options.dropEmpty ?? true,
  };
}

function esUtil(message: BaseMessage): boolean {
  if (AIMessage.isInstance(message)) {
    if (messageText(message).trim().length > 0) return true;
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  }
  return messageText(message).trim().length > 0;
}

function repararInicio(ventana: BaseMessage[], inicio: number): number {
  let indice = inicio;
  while (indice > 0 && ToolMessage.isInstance(ventana[indice])) indice -= 1;
  return indice;
}

function sanearPares(ventana: BaseMessage[]): BaseMessage[] {
  const idsConResultado = new Set<string>();
  for (const message of ventana) {
    if (ToolMessage.isInstance(message)) idsConResultado.add(message.tool_call_id);
  }

  const resultado: BaseMessage[] = [];
  const idsValidos = new Set<string>();

  for (const message of ventana) {
    if (
      AIMessage.isInstance(message) &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0
    ) {
      const llamadas = message.tool_calls.filter(
        (call) => !!call.id && idsConResultado.has(call.id),
      );
      if (llamadas.length === 0) {

        if (messageText(message).trim().length === 0) continue;
        resultado.push(new AIMessage({ content: message.content, id: message.id }));
        continue;
      }
      resultado.push(
        llamadas.length === message.tool_calls.length
          ? message
          : new AIMessage({ ...(message as any), tool_calls: llamadas }),
      );
      for (const llamada of llamadas) if (llamada.id) idsValidos.add(llamada.id);
      continue;
    }

    if (ToolMessage.isInstance(message)) {
      if (idsValidos.has(message.tool_call_id)) resultado.push(message);
      continue;
    }

    resultado.push(message);
  }

  return resultado;
}

function compactarMensaje(
  message: BaseMessage,
  indice: number,
  ventana: BaseMessage[],
  limites: ReturnType<typeof resolveLimits>,
): BaseMessage {
  const esHerramienta = ToolMessage.isInstance(message);
  const toolRestantes = ventana
    .slice(indice + 1)
    .filter((m) => ToolMessage.isInstance(m)).length;
  const limite = esHerramienta
    ? toolRestantes <= 1
      ? limites.maxToolChars
      : Math.min(limites.maxToolChars, TOOL_CHARS_ANTIGUOS)
    : limites.maxContentChars;
  const etiqueta = esHerramienta ? "tool output truncated" : "truncated";

  const reciente = indice >= ventana.length - 2;
  const content = message.content as unknown;

  if (typeof content === "string") {
    const recortado = compactText(content, limite, etiqueta);
    if (recortado === content) return message;
    return new (message.constructor as any)({
      ...(message as any),
      content: recortado,
    });
  }

  if (Array.isArray(content)) {
    const partes = content.map((part: any) => {
      if (typeof part === "string") return { type: "text", text: part };
      if (part?.type === "text") {
        return { ...part, text: compactText(String(part.text ?? ""), limite, etiqueta) };
      }
      return reciente ? part : { type: "text", text: MARCA_IMAGEN_ANTIGUA };
    });
    return new (message.constructor as any)({
      ...(message as any),
      content: partes,
    });
  }

  return message;
}

export function trimMessageContext(
  messages: BaseMessage[],
  options: TrimOptions = {},
): BaseMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const limites = resolveLimits(options);
  const utiles = limites.dropEmpty ? messages.filter(esUtil) : [...messages];
  if (utiles.length === 0) return [];

  let inicio = utiles.length;
  let tokens = 0;
  let contados = 0;
  for (let i = utiles.length - 1; i >= 0; i--) {
    if (contados >= limites.maxMessages) break;
    const estimados = messageTokens(utiles[i]);
    if (contados > 0 && tokens + estimados > limites.maxTokens) break;
    tokens += estimados;
    contados += 1;
    inicio = i;
  }

  inicio = repararInicio(utiles, inicio);
  let ventana = sanearPares(utiles.slice(inicio));

  if (limites.keepTaskAnchor) {
    const ancla = utiles.find((message) => HumanMessage.isInstance(message));
    if (ancla && !ventana.includes(ancla)) {
      ventana = [
        new (ancla.constructor as any)({
          ...(ancla as any),
          content: compactText(messageText(ancla), limites.maxContentChars, "task"),
        }),
        ...ventana,
      ];
    }
  }

  return ventana.map((message, indice) =>
    compactarMensaje(message, indice, ventana, limites),
  );
}

export interface HistoryRow {
  role: string;
  content: string;
}

export function buildHistoryMessages(
  rows: HistoryRow[],
  options: TrimOptions = {},
): BaseMessage[] {
  const mensajes: BaseMessage[] = [];
  for (const row of rows) {
    if (!row?.content) continue;
    if (row.role === "user") mensajes.push(new HumanMessage(row.content));
    else if (row.role === "assistant") mensajes.push(new AIMessage(row.content));
    else if (row.role === "system") mensajes.push(new SystemMessage(row.content));
  }
  return trimMessageContext(mensajes, options);
}
