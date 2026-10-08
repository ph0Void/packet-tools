import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { Logger } from "@/utils/Logger";

export const TASK_TOOL = "task";

const resultadosPorHilo = new Map<string, Map<string, ToolMessage>>();

const MAX_HILOS = 256;

export function toolMessageDeDelegacion(resultado: unknown): ToolMessage | null {
  const update = (resultado as { update?: { messages?: unknown } } | null | undefined)?.update;
  const mensajes = Array.isArray(update?.messages) ? update.messages : [];
  const encontrado = mensajes.find(
    (mensaje: unknown) =>
      mensaje instanceof ToolMessage ||
      (typeof (mensaje as { getType?: unknown })?.getType === "function" &&
        (mensaje as { getType: () => string }).getType() === "tool"),
  );
  return (encontrado as ToolMessage | undefined) ?? null;
}

export function taskResultMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "TaskResultCapture",
    wrapToolCall: async (request, handler) => {
      const resultado = await handler(request);
      if (request.toolCall.name !== TASK_TOOL) return resultado;
      const threadId = request.runtime?.configurable?.thread_id;
      const mensaje = toolMessageDeDelegacion(resultado);
      if (!threadId || !mensaje?.tool_call_id) return resultado;

      let porDelegacion = resultadosPorHilo.get(threadId);
      if (!porDelegacion) {
        while (resultadosPorHilo.size >= MAX_HILOS) {
          const masAntiguo = resultadosPorHilo.keys().next().value;
          if (masAntiguo === undefined) break;
          resultadosPorHilo.delete(masAntiguo);
        }
        porDelegacion = new Map<string, ToolMessage>();
        resultadosPorHilo.set(threadId, porDelegacion);
      }
      porDelegacion.set(mensaje.tool_call_id, mensaje);
      Logger.info({
        message: "[DELEGACION] Resultado de `task` capturado para reemitirlo",
        data: { threadId, toolCallId: mensaje.tool_call_id },
      });
      return resultado;
    },
  });
}

export function consumirResultadosDeDelegacion(
  threadId: string,
  yaEmitidos: ReadonlySet<string>,
): ToolMessage[] {
  const porDelegacion = resultadosPorHilo.get(threadId);
  if (!porDelegacion) return [];
  resultadosPorHilo.delete(threadId);
  return Array.from(porDelegacion.values()).filter(
    (mensaje) => !yaEmitidos.has(String(mensaje.tool_call_id ?? "")),
  );
}

export function limpiarResultadosDeDelegacion(threadId: string): void {
  resultadosPorHilo.delete(threadId);
}

export function resetDelegaciones(): void {
  resultadosPorHilo.clear();
}
