import { AIMessage } from "@langchain/core/messages";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import {
  consumirResultadosDeDelegacion,
  limpiarResultadosDeDelegacion,
} from "./delegacionStream";
import { mensajeDeStream } from "./streamChunk";

export const MARCA_TURNO_SIN_TIEMPO = "[TIEMPO_TURNO_AGOTADO]";

export const LC_ERROR_CODE_PLAZO_CUMPLIDO = "GRAPH_RECURSION_LIMIT";

const LIMITE_PARCIAL = 600;

export function duracionLegible(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "sin límite";
  if (ms >= 60_000) {
    const minutos = ms / 60_000;
    const redondeado = Number.isInteger(minutos) ? minutos : Math.round(minutos * 10) / 10;
    return `${redondeado} min`;
  }
  return `${Math.round(ms / 1000)} s`;
}

export class TurnoSinTiempoError extends Error {
  readonly lc_error_code = LC_ERROR_CODE_PLAZO_CUMPLIDO;

  constructor(limiteMs: number) {
    super(
      `Turno detenido: superó el límite de tiempo de ${duracionLegible(limiteMs)} (${Math.round(
        limiteMs,
      )} ms). Se ha cerrado la generación y lo alcanzado hasta aquí queda guardado; ` +
        'pulsa "Continuar tarea" para retomarlo.',
    );
    this.name = "TurnoSinTiempoError";
  }
}

export function mensajeDeCierrePorTiempo(limiteMs: number, parcial?: string | null): string {
  const cabecera =
    `${MARCA_TURNO_SIN_TIEMPO} El turno superó el límite de tiempo de ` +
    `${duracionLegible(limiteMs)} (${Math.round(limiteMs)} ms) y se ha cerrado: ya no se ` +
    "ejecutarán más herramientas. Se entrega lo hecho y los pasos pendientes para que " +
    "el usuario decida si continuar en otro turno.";
  const limpio = (parcial ?? "").trim();
  if (!limpio) return cabecera;
  const recortado =
    limpio.length > LIMITE_PARCIAL ? `${limpio.slice(0, LIMITE_PARCIAL)}…` : limpio;
  return `${cabecera}\n\nÚltima respuesta antes del corte:\n${recortado}`;
}

export interface RelojDeTurno {

  readonly limiteMs: number;

  readonly deadlineAt: number;

  readonly signal: AbortSignal;

  excedido(): boolean;

  readonly esperaCorte: Promise<void>;

  detener(): void;
}

export function plazoDeTurno(limiteMs?: number | null): number {
  const candidato = limiteMs ?? envConfig.AGENT_TURN_TIMEOUT_MS;
  return typeof candidato === "number" && Number.isFinite(candidato) && candidato > 0
    ? candidato
    : envConfig.AGENT_TURN_TIMEOUT_MS;
}

export function crearRelojDeTurno(params: { limiteMs?: number | null; signal?: AbortSignal } = {}): RelojDeTurno {
  const limiteMs = plazoDeTurno(params.limiteMs);
  const controller = new AbortController();
  const externo = params.signal;
  let excedido = false;
  let resolverCorte: () => void = () => undefined;
  const esperaCorte = new Promise<void>((resolve) => {
    resolverCorte = resolve;
  });

  const abortar = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (externo) {
    if (externo.aborted) abortar();
    else externo.addEventListener("abort", abortar, { once: true });
  }

  const temporizador = setTimeout(() => {
    if (controller.signal.aborted) return;
    excedido = true;
    Logger.warning({
      message: "[TURN_PLAZO] El turno superó el límite de tiempo: se corta el grafo",
      data: { limiteMs },
    });
    abortar();
    resolverCorte();
  }, limiteMs);

  (temporizador as unknown as { unref?: () => void }).unref?.();

  return {
    limiteMs,
    deadlineAt: Date.now() + limiteMs,
    signal: controller.signal,
    excedido: () => excedido,
    esperaCorte,
    detener: () => {
      clearTimeout(temporizador);
      externo?.removeEventListener?.("abort", abortar);
    },
  };
}

export { mensajeDeStream as chunkDeStream } from "./streamChunk";

function textoVisibleDe(chunk: unknown): string {
  const posible = chunk as { content?: unknown; getType?: () => string } | null;
  if (!posible || posible.getType?.() !== "ai") return "";
  if (typeof posible.content === "string") return posible.content;
  if (Array.isArray(posible.content)) {
    return posible.content
      .map((bloque: any) =>
        bloque && typeof bloque === "object" && bloque.type === "text" && typeof bloque.text === "string"
          ? bloque.text
          : "",
      )
      .join("");
  }
  return "";
}

async function cerrarIteradorSilencioso(iterador: AsyncIterator<unknown>): Promise<void> {
  try {
    await iterador.return?.();
  } catch {

  }
}

export async function* streamConPlazo(params: {
  stream: AsyncIterable<unknown>;
  reloj: RelojDeTurno;
  threadId: string;

  etiqueta: string;
}): AsyncGenerator<unknown, void, unknown> {
  const iterador = params.stream[Symbol.asyncIterator]();
  const emitidos = new Set<string>();
  let parcial = "";
  let cortado = false;

  try {
    for (;;) {
      const siguiente = iterador.next();

      siguiente.catch(() => undefined);
      const carrera: Promise<
        { clase: "chunk"; valor: IteratorResult<unknown> } | { clase: "corte" }
      > = Promise.race([
        siguiente.then((valor) => ({ clase: "chunk" as const, valor })),
        params.reloj.esperaCorte.then(() => ({ clase: "corte" as const })),
      ]);
      carrera.catch(() => undefined);
      const resultado = await carrera;

      if (resultado.clase === "corte") {
        cortado = true;
        break;
      }
      if (resultado.valor.done) break;

      const chunk = mensajeDeStream(resultado.valor.value);
      if (chunk && typeof chunk === "object" && chunk.getType?.() === "tool") {
        emitidos.add(String(chunk.tool_call_id ?? ""));
      }
      const texto = textoVisibleDe(chunk);
      if (texto) parcial = `${parcial}${texto}`.slice(-LIMITE_PARCIAL);
      yield resultado.valor.value;
    }

    for (const pendiente of consumirResultadosDeDelegacion(params.threadId, emitidos)) {
      yield pendiente;
    }

    if (cortado) {
      Logger.warning({
        message: "[TURN_PLAZO] Corte por plazo: se cierra el turno con respuesta final",
        data: {
          etiqueta: params.etiqueta,
          threadId: params.threadId,
          limiteMs: params.reloj.limiteMs,
        },
      });
      yield new AIMessage(mensajeDeCierrePorTiempo(params.reloj.limiteMs, parcial));
      throw new TurnoSinTiempoError(params.reloj.limiteMs);
    }
  } finally {
    params.reloj.detener();
    void cerrarIteradorSilencioso(iterador);
    limpiarResultadosDeDelegacion(params.threadId);
  }
}
