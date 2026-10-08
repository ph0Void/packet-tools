import { SystemMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { duracionLegible } from "./turnPlazo";

export const CLAVE_DEADLINE = "turn_deadline_at";

export const CLAVE_PLAZO = "turn_plazo_ms";

export const MARCA_AVISO_TIEMPO = "[PLAZO_TURNO]";

export function textoAvisoTiempo(limiteMs: number): string {
  return (
    `${MARCA_AVISO_TIEMPO} Se ha agotado el tiempo de este turno (plazo: ` +
    `${duracionLegible(limiteMs)}). Esta debe ser tu ÚLTIMA respuesta: entrega (a) el ` +
    "resumen de lo ya hecho y (b) la lista numerada de los pasos pendientes, y no " +
    "llames a ninguna herramienta."
  );
}

export function plazoVencido(configurable: unknown): boolean {
  const deadline = (configurable as Record<string, unknown> | null | undefined)?.[CLAVE_DEADLINE];
  return typeof deadline === "number" && Number.isFinite(deadline) && Date.now() >= deadline;
}

export function turnPlazoMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "TurnDeadline",
    wrapModelCall: async (request, handler) => {
      const configurable = request.runtime?.configurable;
      if (!plazoVencido(configurable)) return handler(request);

      const base = request.systemMessage ?? new SystemMessage("");
      if (base.text.includes(MARCA_AVISO_TIEMPO)) return handler(request);

      const plazo = (configurable as Record<string, unknown>)[CLAVE_PLAZO];
      const limiteMs = typeof plazo === "number" && Number.isFinite(plazo) && plazo > 0 ? plazo : 0;
      return handler({
        ...request,
        systemMessage: base.concat("\n\n" + textoAvisoTiempo(limiteMs)),
      });
    },
  });
}
