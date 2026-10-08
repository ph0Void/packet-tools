import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import {
  clasificarToolMessage,
  type ToolErrorVerdict,
} from "../security/ToolErrorClassifier";
import { Logger } from "@/utils/Logger";

export const PREFIJO_REINTENTO_BLOQUEADO = "[REINTENTO_BLOQUEADO]";

const MAX_CORTES_POR_HUELLA = 2;

export interface RetryGuardOptions {

  maxIntentos?: number;
}

function canonico(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`);
  return `{${entradas.join(",")}}`;
}

export function huellaDeTool(nombre: string, args: unknown): string {
  return `${nombre}::${canonico(args ?? {})}`;
}

interface ResultadoPrevio {
  clave: string;
  veredicto: ToolErrorVerdict;
}

export function resultadosPorHuella(mensajes: BaseMessage[]): Map<string, ResultadoPrevio> {
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
    const id = String((mensaje as ToolMessage).tool_call_id ?? "");
    const origen = argumentosPorId.get(id);
    if (!origen?.nombre) continue;
    const clave = huellaDeTool(origen.nombre, origen.args);
    if (ultimo.has(clave)) continue;
    ultimo.set(clave, {
      clave,
      veredicto: clasificarToolMessage({
        content: (mensaje as ToolMessage).content,
        status: (mensaje as ToolMessage).status ?? null,
        name: origen.nombre,
      }),
    });
  }
  return ultimo;
}

function cortesPrevios(mensajes: BaseMessage[], clave: string): number {
  let total = 0;
  for (const mensaje of mensajes) {
    if (!ToolMessage.isInstance(mensaje)) continue;
    const contenido = (mensaje as ToolMessage).content;
    if (typeof contenido !== "string") continue;
    if (!contenido.startsWith(PREFIJO_REINTENTO_BLOQUEADO)) continue;
    if (contenido.includes(clave)) total += 1;
  }
  return total;
}

export function mensajeDeReintentoBloqueado(
  veredicto: ToolErrorVerdict,
  clave: string,
  cortes: number,
): string {
  const base = `${PREFIJO_REINTENTO_BLOQUEADO} ${veredicto.etiqueta}: ${veredicto.motivo}.`;
  if (cortes >= MAX_CORTES_POR_HUELLA) {
    return `${base} Esta llamada identica ya se ha cortado ${cortes} veces en este turno: no la repitas mas. Explica al usuario el bloqueo y proposes el siguiente paso.`;
  }
  return `${base} No repitas esta llamada identica (${clave}): cambia la accion (sintaxis, objetivo o plan) o informa del bloqueo.`;
}

export function retryGuardMiddleware(
  options: RetryGuardOptions = {},
): AgentMiddleware {
  const maxIntentos = Math.max(0, options.maxIntentos ?? 0);

  return createMiddleware({
    name: "RetryGuard",
    wrapToolCall: async (request, handler) => {
      const nombre = request.toolCall.name;
      const argumentos = (request.toolCall.args ?? {}) as Record<string, unknown>;
      const clave = huellaDeTool(nombre, argumentos);
      const mensajes = (request.state?.messages ?? []) as BaseMessage[];

      const previos = resultadosPorHuella(mensajes);
      const previo = previos.get(clave);
      if (!previo || previo.veredicto.clase !== "definitive") {
        return handler(request);
      }

      const cortes = cortesPrevios(mensajes, clave);
      if (cortes < maxIntentos) return handler(request);

      Logger.info({
        message: "[RETRY_GUARD] Reintento identico bloqueado (error definitivo)",
        data: { tool: nombre, clave, motivo: previo.veredicto.motivo, cortes },
      });
      return new ToolMessage({
        content: mensajeDeReintentoBloqueado(previo.veredicto, clave, cortes),
        tool_call_id: request.toolCall.id ?? "",
        name: nombre,
        status: "error",
      });
    },
  });
}
