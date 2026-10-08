import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { Logger } from "@/utils/Logger";
import { huellaDeTool } from "./retryGuardMiddleware";
import { clasificarToolMessage, resultadoEsFallo } from "../security/ToolErrorClassifier";

export const PREFIJO_LLAMADA_DUPLICADA = "[LLAMADA_DUPLICADA]";

function porDefectoActivada(): boolean {

  return process.env.AGENT_DUPLICATE_TOOL_GUARD !== "false";
}

export interface DuplicateGuardOptions {

  enabled?: boolean;
}

export interface ResultadoPrevio {
  contenido: unknown;
  status: string | null;
  toolCallId: string;
}

export function ultimoResultadoPorHuella(mensajes: BaseMessage[]): Map<string, ResultadoPrevio> {
  const argumentosPorId = new Map<string, { nombre: string; args: unknown }>();
  for (const mensaje of mensajes) {
    const llamadas = (mensaje as { tool_calls?: Array<{ id?: string; name?: string; args?: unknown }> })
      .tool_calls;
    if (!Array.isArray(llamadas)) continue;
    for (const llamada of llamadas) {
      if (!llamada?.id) continue;
      argumentosPorId.set(llamada.id, {
        nombre: String(llamada.name ?? ""),
        args: llamada.args,
      });
    }
  }

  const ultimo = new Map<string, ResultadoPrevio>();
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice];
    if (!ToolMessage.isInstance(mensaje)) continue;
    const tool = mensaje as ToolMessage;
    const origen = argumentosPorId.get(String(tool.tool_call_id ?? ""));
    if (!origen?.nombre) continue;
    const clave = huellaDeTool(origen.nombre, origen.args);
    if (ultimo.has(clave)) continue;
    ultimo.set(clave, {
      contenido: tool.content,
      status: tool.status ?? null,
      toolCallId: String(tool.tool_call_id ?? ""),
    });
  }
  return ultimo;
}

export function indicaFallo(previo: ResultadoPrevio, nombre: string): boolean {
  if (resultadoEsFallo({ texto: previo.contenido, status: previo.status })) {
    return true;
  }
  return clasificarToolMessage({ content: previo.contenido, status: previo.status, name: nombre })
    .clase !== "unknown";
}

export function mensajeDeLlamadaDuplicada(nombre: string, clave: string): string {
  return (
    `${PREFIJO_LLAMADA_DUPLICADA} La tool '${nombre}' ya se ejecutó en este turno con ` +
    `los MISMOS argumentos (${clave}) y terminó bien: su resultado es el que tienes ` +
    "encima. No la repitas: usa ese resultado o cambia los argumentos (otro equipo, " +
    "otro comando, otro objetivo)."
  );
}

function bloqueo(
  nombre: string,
  clave: string,
  toolCallId: string | undefined,
  contenido: string,
): ToolMessage {
  return new ToolMessage({
    content: contenido,
    tool_call_id: toolCallId ?? "",
    name: nombre,
    status: "error",
  });
}

export function duplicateGuardMiddleware(
  options: DuplicateGuardOptions = {},
): AgentMiddleware {
  const enabled = options.enabled ?? porDefectoActivada();

  return createMiddleware({
    name: "DuplicateToolGuard",
    wrapToolCall: async (request, handler) => {
      if (!enabled) return handler(request);

      const nombre = request.toolCall.name;
      const clave = huellaDeTool(nombre, request.toolCall.args ?? {});
      const previos = ultimoResultadoPorHuella((request.state?.messages ?? []) as BaseMessage[]);
      const previo = previos.get(clave);
      if (!previo) return handler(request);

      const contenidoPrevio =
        typeof previo.contenido === "string"
          ? previo.contenido
          : JSON.stringify(previo.contenido ?? "");

      if (contenidoPrevio.startsWith(PREFIJO_LLAMADA_DUPLICADA)) {
        Logger.info({
          message: "[DUPLICATE_GUARD] Repetición de una llamada ya bloqueada",
          data: { tool: nombre, clave },
        });
        return bloqueo(nombre, clave, request.toolCall.id, contenidoPrevio);
      }

      if (indicaFallo(previo, nombre)) return handler(request);

      Logger.info({
        message: "[DUPLICATE_GUARD] Tool repetida con los mismos argumentos: bloqueada",
        data: { tool: nombre, clave, resultadoPrevio: previo.toolCallId },
      });
      return bloqueo(
        nombre,
        clave,
        request.toolCall.id,
        mensajeDeLlamadaDuplicada(nombre, clave),
      );
    },
  });
}
