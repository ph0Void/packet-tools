export interface PasoPlan {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SegmentoPlan {
  kind: "plan";
  todos: PasoPlan[];
}

export type CodigoErrorStream = "budget_exhausted" | "cancelled" | "agent_error";

const PROFUNDIDAD_CAUSA = 5;

export function esPresupuestoAgotado(error: unknown): boolean {
  let actual: unknown = error;
  for (let nivel = 0; actual != null && nivel < PROFUNDIDAD_CAUSA; nivel += 1) {
    if (typeof actual === "string") {
      if (actual.toLowerCase().includes("recursion limit")) return true;
      break;
    }
    if (typeof actual !== "object") break;
    const objeto = actual as { lc_error_code?: unknown; message?: unknown; cause?: unknown };
    if (objeto.lc_error_code === "GRAPH_RECURSION_LIMIT") return true;
    if (typeof objeto.message === "string" && objeto.message.toLowerCase().includes("recursion limit")) {
      return true;
    }
    actual = objeto.cause;
  }
  return false;
}

const MENSAJES_ABORTO_EXACTOS = new Set([
  "abort",
  "aborted",
  "canceled",
  "cancelled",
  "this operation was aborted",
  "the operation was aborted",
]);

const FRASES_ABORTO = [
  "operation was aborted",
  "aborted by the user",
  "user aborted",
  "request aborted",
  "aborted by signal",
];

const CODIGOS_ABORTO = new Set(["ABORT_ERR", "ERR_ABORTED"]);

function esMensajeDeAborto(mensaje: string): boolean {
  const limpio = mensaje.trim().toLowerCase();
  if (MENSAJES_ABORTO_EXACTOS.has(limpio)) return true;
  return FRASES_ABORTO.some((frase) => limpio.includes(frase));
}

function esMarcaDeAborto(valor: unknown): boolean {
  if (typeof valor === "string") return esMensajeDeAborto(valor);
  if (typeof valor !== "object" || valor === null) return false;
  const objeto = valor as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof objeto.name === "string" && /abort/i.test(objeto.name)) return true;
  if (typeof objeto.code === "string" && CODIGOS_ABORTO.has(objeto.code)) return true;

  if (objeto.code === 20) return true;
  return typeof objeto.message === "string" && esMensajeDeAborto(objeto.message);
}

function esBubbleUpDeGrafo(error: unknown): boolean {
  let actual: unknown = error;
  for (let nivel = 0; actual != null && nivel < PROFUNDIDAD_CAUSA; nivel += 1) {
    if (typeof actual !== "object") break;
    const objeto = actual as { is_bubble_up?: unknown; name?: unknown };
    if (objeto.is_bubble_up === true || objeto.name === "GraphBubbleUp") return true;
    actual = (objeto as { cause?: unknown }).cause;
  }
  return false;
}

export function esCancelacionDelCliente(error: unknown, signal?: AbortSignal | null): boolean {
  const abortado = signal?.aborted === true;
  if (error == null) return abortado;
  let actual: unknown = error;
  for (let nivel = 0; actual != null && nivel < PROFUNDIDAD_CAUSA; nivel += 1) {
    if (esMarcaDeAborto(actual)) return true;
    if (typeof actual !== "object") break;
    actual = (actual as { cause?: unknown }).cause;
  }
  return abortado && esBubbleUpDeGrafo(error);
}

export function codigoDeErrorStream(error: unknown, signal?: AbortSignal | null): CodigoErrorStream {
  if (esPresupuestoAgotado(error)) return "budget_exhausted";
  if (esCancelacionDelCliente(error, signal)) return "cancelled";
  return "agent_error";
}

export const MENSAJE_CANCELACION =
  "Turno cancelado: se cortó la generación. Lo generado hasta aquí se ha guardado; puedes reintentarlo cuando quieras.";

export const AVISO_PRESUPUESTO =
  '> Presupuesto de pasos del turno agotado. El trabajo queda guardado aquí; pulsa "Continuar tarea" para seguir desde donde se quedó.';

export const AVISO_TURNO_CANCELADO =
  '> Turno cancelado: la respuesta quedó incompleta. Pulsa "Reintentar" para volver a lanzar tu petición.';

export const AVISO_TURNO_ERROR =
  '> El turno terminó con un error: la respuesta quedó incompleta. Pulsa "Reintentar" para volver a lanzar tu petición.';

export type MotivoTurnoIncompleto = "cancelado" | "error";

export function avisoDeTurnoIncompleto(motivo: MotivoTurnoIncompleto): string {
  return motivo === "cancelado" ? AVISO_TURNO_CANCELADO : AVISO_TURNO_ERROR;
}

const AVISOS_DE_CORTE: readonly string[] = [
  AVISO_PRESUPUESTO,
  AVISO_TURNO_CANCELADO,
  AVISO_TURNO_ERROR,
];

export function anexarAviso(contenido: string, aviso: string): string {
  const base = typeof contenido === "string" ? contenido : "";
  if (base.includes(aviso)) return base;
  return `${base.replace(/\s+$/, "")}\n\n${aviso}`;
}

export function anexarAvisoPresupuesto(contenido: string): string {
  return anexarAviso(contenido, AVISO_PRESUPUESTO);
}

export function anexarAvisoTurnoIncompleto(
  contenido: string,
  motivo: MotivoTurnoIncompleto,
): string {
  const base = typeof contenido === "string" ? contenido : "";
  if (AVISOS_DE_CORTE.some((aviso) => base.includes(aviso))) return base;
  return anexarAviso(base, avisoDeTurnoIncompleto(motivo));
}

export function anexarAvisoSegmento(
  segmentos: Array<{ kind: string; text?: string }>,
  aviso: string,
  yaPresentes: readonly string[] = [aviso],
): void {
  if (!Array.isArray(segmentos)) return;
  const contiene = (texto: string | undefined): boolean =>
    typeof texto === "string" && yaPresentes.some((marcador) => texto.includes(marcador));
  const ultimo = segmentos[segmentos.length - 1];
  if (ultimo && ultimo.kind === "text" && typeof ultimo.text === "string") {
    if (contiene(ultimo.text)) return;
    ultimo.text = anexarAviso(ultimo.text, aviso);
    return;
  }
  if (segmentos.some((segmento) => segmento.kind === "text" && contiene(segmento.text))) {
    return;
  }
  const nuevo: { kind: string; text: string } = { kind: "text", text: aviso };
  segmentos.push(nuevo);
}

export function anexarAvisoPresupuestoSegmento(
  segmentos: Array<{ kind: string; text?: string }>,
): void {
  anexarAvisoSegmento(segmentos, AVISO_PRESUPUESTO);
}

export function anexarAvisoTurnoIncompletoSegmento(
  segmentos: Array<{ kind: string; text?: string }>,
  motivo: MotivoTurnoIncompleto,
): void {
  anexarAvisoSegmento(segmentos, avisoDeTurnoIncompleto(motivo), AVISOS_DE_CORTE);
}

export function insertarSegmentoPlan(
  segmentos: Array<{ kind: string }>,
  plan: readonly PasoPlan[],
): void {
  if (!Array.isArray(segmentos) || plan.length === 0) return;
  const todos: PasoPlan[] = plan.map((paso) => ({ ...paso }));
  const existente = segmentos.find((segmento) => segmento.kind === "plan");
  if (existente) {
    (existente as SegmentoPlan).todos = todos;
    return;
  }
  const nuevo: SegmentoPlan = { kind: "plan", todos };
  segmentos.push(nuevo);
}

export const LIMITE_RESUMEN_CONTINUACION = 600;

export interface PendienteContinuacion {

  resumen?: string | null;

  pendientes?: readonly string[];
}

export function construirMensajeContinuacion(pendiente: PendienteContinuacion): string {
  const partes: string[] = ["Continua la tarea anterior."];

  const resumen = truncarResumen(pendiente.resumen ?? "");
  if (resumen) partes.push(`Ya hecho:\n- ${resumen}`);

  const pendientes = (pendiente.pendientes ?? [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (pendientes.length > 0) {
    partes.push(`Pendiente:\n${pendientes.map((item) => `- ${item}`).join("\n")}`);
  }

  return partes.join("\n\n");
}

function truncarResumen(resumen: string): string {
  const limpio = resumen.trim();
  if (limpio.length <= LIMITE_RESUMEN_CONTINUACION) return limpio;
  return `${limpio.slice(0, LIMITE_RESUMEN_CONTINUACION)}…`;
}
