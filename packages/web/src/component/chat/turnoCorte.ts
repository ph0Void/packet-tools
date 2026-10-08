export type FinalTurno = "completo" | "cancelado" | "erroreado";

export type MotivoCorte = "cancelado" | "error" | "presupuesto" | "incompleto";

export interface AvisoCorte {

  motivo: MotivoCorte;

  aviso: string;
}

export const AVISO_PRESUPUESTO =
  '> Presupuesto de pasos del turno agotado. El trabajo queda guardado aquí; pulsa "Continuar tarea" para seguir desde donde se quedó.';

export const AVISO_TURNO_CANCELADO =
  '> Turno cancelado: la respuesta quedó incompleta. Pulsa "Reintentar" para volver a lanzar tu petición.';

export const AVISO_TURNO_ERROR =
  '> El turno terminó con un error: la respuesta quedó incompleta. Pulsa "Reintentar" para volver a lanzar tu petición.';

export const AVISOS_DE_CORTE: readonly string[] = [
  AVISO_PRESUPUESTO,
  AVISO_TURNO_CANCELADO,
  AVISO_TURNO_ERROR,
];

export function avisoDeCorte(motivo: MotivoCorte): string {
  if (motivo === "presupuesto") return AVISO_PRESUPUESTO;
  if (motivo === "cancelado") return AVISO_TURNO_CANCELADO;
  return AVISO_TURNO_ERROR;
}

const MARCA_PRESUPUESTO = "presupuesto de pasos";
const MARCAS_INCOMPLETO = ["quedo incompleta", "quedo interrumpid"];
const MARCA_CANCELACION = "cancel";
const MARCA_FALLO = /error|fallo|falla/;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inicioBloqueCita(lineas: readonly string[]): number {
  let fin = lineas.length;
  while (fin > 0 && !lineas[fin - 1].trim()) fin -= 1;
  let inicio = fin;
  while (inicio > 0 && lineas[inicio - 1].trim().startsWith(">")) inicio -= 1;
  return inicio === fin ? -1 : inicio;
}

export function detectarAvisoCorte(contenido: string): AvisoCorte | null {
  if (typeof contenido !== "string" || !contenido) return null;
  const lineas = contenido.split("\n");
  const inicio = inicioBloqueCita(lineas);
  if (inicio === -1) return null;
  const aviso = lineas
    .slice(inicio)
    .map((linea) => linea.trim())
    .join("\n");
  const plano = normalizar(
    lineas
      .slice(inicio)
      .map((linea) => linea.trim().replace(/^>+/, ""))
      .join(" "),
  );
  if (plano.includes(MARCA_PRESUPUESTO)) {
    return { motivo: "presupuesto", aviso };
  }
  if (!MARCAS_INCOMPLETO.some((marca) => plano.includes(marca))) return null;
  const motivo: MotivoCorte = plano.includes(MARCA_CANCELACION)
    ? "cancelado"
    : MARCA_FALLO.test(plano)
      ? "error"
      : "incompleto";
  return { motivo, aviso };
}

export function quitarAvisoCorte(contenido: string): string {
  if (typeof contenido !== "string" || !contenido) return "";
  if (!detectarAvisoCorte(contenido)) return contenido;
  const lineas = contenido.split("\n");
  const inicio = inicioBloqueCita(lineas);
  if (inicio === -1) return contenido;
  return lineas.slice(0, inicio).join("\n").replace(/\s+$/, "");
}

export interface SegmentoConTexto {
  kind: string;
  text?: string;
}

export function yaHayAvisoDeCorte(texto: string): boolean {
  if (typeof texto !== "string" || !texto) return false;
  return (
    detectarAvisoCorte(texto) !== null ||
    AVISOS_DE_CORTE.some((aviso) => texto.includes(aviso))
  );
}

export function anexarAvisoCorte(
  contenido: string,
  motivo: MotivoCorte,
): string {
  const original = typeof contenido === "string" ? contenido : "";
  if (yaHayAvisoDeCorte(original)) return original;
  const base = original.replace(/\s+$/, "");
  const aviso = avisoDeCorte(motivo);
  return base ? `${base}\n\n${aviso}` : aviso;
}

export function anexarAvisoCorteSegmento(
  segmentos: SegmentoConTexto[],
  motivo: MotivoCorte,
): void {
  if (!Array.isArray(segmentos)) return;
  const ultimo = segmentos[segmentos.length - 1];
  if (ultimo && ultimo.kind === "text" && typeof ultimo.text === "string") {
    ultimo.text = anexarAvisoCorte(ultimo.text, motivo);
    return;
  }
  if (
    segmentos.some(
      (segmento) =>
        segmento.kind === "text" && yaHayAvisoDeCorte(segmento.text ?? ""),
    )
  ) {
    return;
  }
  segmentos.push({ kind: "text", text: avisoDeCorte(motivo) });
}

export function textoDeSegmentos(
  segmentos: readonly SegmentoConTexto[],
): string {
  if (!Array.isArray(segmentos)) return "";
  return segmentos
    .filter((segmento) => segmento.kind === "text" && segmento.text)
    .map((segmento) => segmento.text as string)
    .join("\n\n")
    .trim();
}

export function finalDesdeMotivo(motivo: MotivoCorte | null): FinalTurno {
  if (motivo === null) return "completo";
  return motivo === "cancelado" ? "cancelado" : "erroreado";
}

export function esReintentable(motivo: MotivoCorte | null): boolean {
  return motivo === "cancelado" || motivo === "error" || motivo === "incompleto";
}

export interface MensajeMarcable {
  id: string;
  role: string;
  turnoCorte?: MotivoCorte;
}

export function marcarCorteEnCola<T extends MensajeMarcable>(
  mensajes: readonly T[],
  motivo: MotivoCorte,
): T[] {
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo || ultimo.role !== "assistant") return mensajes as T[];
  if (ultimo.turnoCorte === motivo) return mensajes as T[];
  const copia = [...mensajes];
  copia[copia.length - 1] = { ...ultimo, turnoCorte: motivo };
  return copia;
}

export function hayCorteEnCola(
  mensajes: readonly MensajeMarcable[],
): boolean {
  return !!mensajes[mensajes.length - 1]?.turnoCorte;
}

export function resolverParcialTrasRefresco<T extends MensajeMarcable>(
  mensajes: readonly T[],
  parcial: T | null,
  motivo: MotivoCorte,
): T[] {
  const marcados = marcarCorteEnCola(mensajes, motivo);
  if (marcados[marcados.length - 1]?.role === "assistant") return marcados;
  return parcial ? [...marcados, { ...parcial, turnoCorte: motivo }] : marcados;
}

export function ultimoMensajeUsuario<
  T extends { role: string; content: string },
>(mensajes: readonly T[]): T | null {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    if (mensajes[i].role === "user") return mensajes[i];
  }
  return null;
}

export function peticionPrecedente<
  T extends { id: string; role: string; content: string },
>(mensajes: readonly T[], mensajeId: string): T | null {
  const indice = mensajes.findIndex((mensaje) => mensaje.id === mensajeId);
  if (indice === -1) return null;
  for (let i = indice - 1; i >= 0; i -= 1) {
    if (mensajes[i].role === "user") return mensajes[i];
  }
  return null;
}

export const TEXTO_CORTE: Record<MotivoCorte, string> = {
  cancelado: "Cancelaste este turno: la respuesta quedó incompleta.",
  error: "El turno falló antes de terminar: la respuesta quedó incompleta.",
  presupuesto:
    "El turno agotó el presupuesto de pasos: la respuesta quedó incompleta.",
  incompleto:
    "El turno se interrumpió antes de terminar: la respuesta quedó incompleta.",
};

const PREFIJO_ID_LOCAL = "local-";

export function esIdDeMensajePersistido(id: unknown): id is string {
  return (
    typeof id === "string" && id.length > 0 && !id.startsWith(PREFIJO_ID_LOCAL)
  );
}

export function mensajeUsuarioReintentable<
  T extends { id: string; role: string; content: string },
>(mensajes: readonly T[], mensajeId: string): T | null {
  const peticion = peticionPrecedente(mensajes, mensajeId);
  if (!peticion) return null;
  return esIdDeMensajePersistido(peticion.id) ? peticion : null;
}

export interface ReconciliacionReintento<T> {

  mensajes: T[];

  yaEsta: boolean;

  cambio: boolean;
}

export function conciliarReintento<T extends MensajeMarcable>(
  mensajes: readonly T[],
  assistantMessageId: string | null,
): ReconciliacionReintento<T> {
  const yaEsta = assistantMessageId
    ? mensajes.some((mensaje) => mensaje.id === assistantMessageId)
    : false;
  const sinLocales = mensajes.filter((mensaje) =>
    esIdDeMensajePersistido(mensaje.id),
  );

  const cambio = sinLocales.length !== mensajes.length;
  return {
    mensajes: cambio ? (sinLocales as T[]) : (mensajes as T[]),
    yaEsta,
    cambio,
  };
}

export function esErrorDeAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const valor = error as { name?: unknown; code?: unknown };
  if (typeof valor.name === "string" && valor.name.toLowerCase().includes("abort")) {
    return true;
  }

  return valor.code === "ABORT_ERR" || valor.code === "ERR_ABORTED" || valor.code === 20;
}
