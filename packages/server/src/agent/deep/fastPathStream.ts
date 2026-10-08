import { Logger } from "@/utils/Logger";
import { FAST_PATH_FALLBACK } from "./fastPath";
import { mensajeDeStream } from "./streamChunk";

export type ChunkStream = unknown;

export const MOTIVOS_FALLBACK = {
  marcador: "el especialista pidió devolver el turno",
  sinToolCalls: "el especialista no llamó a ninguna herramienta",
} as const;

export function chunkTraeToolCall(chunk: ChunkStream): boolean {
  const posible = mensajeDeStream(chunk) as {
    tool_calls?: unknown;
    tool_call_chunks?: unknown;
  } | null;
  if (!posible || typeof posible !== "object") return false;
  if (Array.isArray(posible.tool_calls) && posible.tool_calls.length > 0) return true;
  if (
    Array.isArray(posible.tool_call_chunks) &&
    posible.tool_call_chunks.some(
      (item) => item && typeof (item as { id?: unknown }).id === "string",
    )
  ) {
    return true;
  }
  return false;
}

export function textoDeChunk(chunk: ChunkStream): string {
  const posible = mensajeDeStream(chunk) as { content?: unknown; getType?: () => string } | null;
  if (!posible || typeof posible !== "object") return "";
  if (posible.getType && posible.getType() !== "ai") return "";
  if (typeof posible.content === "string") return posible.content;
  if (Array.isArray(posible.content)) {
    return posible.content
      .map((parte) =>
        parte && typeof parte === "object" && "text" in parte
          ? String((parte as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

export function contieneFallback(texto: string): boolean {
  return String(texto ?? "").includes(FAST_PATH_FALLBACK);
}

export interface Puerta {

  abierta: boolean;

  toolCalls: number;

  texto: string;

  fallback: boolean;
}

export type DecisionPuerta = "soltar" | "retener" | "fallback";

export function nuevaPuerta(): Puerta {
  return { abierta: false, toolCalls: 0, texto: "", fallback: false };
}

export function observarChunk(puerta: Puerta, chunk: ChunkStream): DecisionPuerta {
  if (puerta.abierta) return "soltar";
  if (chunkTraeToolCall(chunk)) {
    puerta.toolCalls += 1;
    puerta.abierta = true;
    return "soltar";
  }
  puerta.texto += textoDeChunk(chunk);
  if (contieneFallback(puerta.texto)) {
    puerta.fallback = true;
    return "fallback";
  }
  return "retener";
}

export type VeredictoFastPath =
  | { resuelto: true; toolCalls: number }
  | { resuelto: false; motivo: string };

export function verdictDeStream(
  chunks: readonly ChunkStream[],
): VeredictoFastPath {
  const puerta = nuevaPuerta();
  for (const chunk of chunks) observarChunk(puerta, chunk);
  return veredictoDePuerta(puerta);
}

export function motivoDeFallback(puerta: Puerta): string | null {
  if (puerta.fallback) return MOTIVOS_FALLBACK.marcador;
  if (puerta.toolCalls === 0) return MOTIVOS_FALLBACK.sinToolCalls;
  return null;
}

export function veredictoDePuerta(puerta: Puerta): VeredictoFastPath {
  const motivo = motivoDeFallback(puerta);
  return motivo
    ? { resuelto: false, motivo }
    : { resuelto: true, toolCalls: puerta.toolCalls };
}

export async function* fastPathStream(params: {
  especialista: AsyncIterable<ChunkStream>;
  supervisor: () => Promise<AsyncIterable<ChunkStream>>;
  etiqueta: string;
  onFallback?: (motivo: string) => void;
}): AsyncIterable<ChunkStream> {
  const puerta = nuevaPuerta();
  const retenido: ChunkStream[] = [];

  for await (const chunk of params.especialista) {
    const decision = observarChunk(puerta, chunk);
    if (decision === "soltar" && !retenido.length) {
      yield chunk;
      continue;
    }
    if (decision === "soltar") {

      for (const previo of retenido) yield previo;
      retenido.length = 0;
      yield chunk;
      continue;
    }
    if (decision === "fallback") break;
    retenido.push(chunk);
  }

  if (puerta.abierta) return;

  const motivo = motivoDeFallback(puerta) ?? MOTIVOS_FALLBACK.sinToolCalls;
  Logger.info({
    message: "[FAST_PATH] El especialista no resolvió; se repite con el supervisor",
    data: { especialista: params.etiqueta, motivo },
  });
  params.onFallback?.(motivo);
  const supervisor = await params.supervisor();
  for await (const chunk of supervisor) {
    yield chunk;
  }
}
