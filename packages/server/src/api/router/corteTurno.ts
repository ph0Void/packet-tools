import {
  AVISO_PRESUPUESTO,
  AVISO_TURNO_CANCELADO,
  AVISO_TURNO_ERROR,
} from "@/api/router/continuation";

export const AVISOS_DE_CORTE: readonly string[] = [
  AVISO_PRESUPUESTO,
  AVISO_TURNO_CANCELADO,
  AVISO_TURNO_ERROR,
];

export function contieneAvisoDeCorte(contenido: string | null | undefined): boolean {
  if (typeof contenido !== "string" || contenido.length === 0) return false;
  return AVISOS_DE_CORTE.some((aviso) => contenido.includes(aviso));
}
