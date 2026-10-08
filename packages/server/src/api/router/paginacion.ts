export const LIMIT_MAXIMO = 200;

export const LIMIT_POR_DEFECTO = 50;

const PAGINA_MINIMA = 1;

export interface Paginacion {

  limit: number | null;

  cursor: string | null;

  skip: number;

  paginado: boolean;
}

export class ErrorPaginacion extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorPaginacion";
  }
}

export type ValorQuery = string | string[] | undefined;

export type QueryPaginacion = Record<string, ValorQuery>;

function primerValor(valor: ValorQuery): string | undefined {
  if (Array.isArray(valor)) return valor[0];
  return typeof valor === "string" ? valor : undefined;
}

function enteroEnRango(
  bruto: string | undefined,
  nombre: string,
  minimo: number,
  maximo: number,
): number | null {
  if (bruto === undefined) return null;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || String(valor) !== bruto.trim()) {
    throw new ErrorPaginacion(`\`${nombre}\` debe ser un número entero.`);
  }
  if (valor < minimo || valor > maximo) {
    throw new ErrorPaginacion(`\`${nombre}\` debe estar entre ${minimo} y ${maximo}.`);
  }
  return valor;
}

export function parsearPaginacion(query: QueryPaginacion): Paginacion {
  const limitBruto = primerValor(query.limit);
  const cursorBruto = primerValor(query.cursor);
  const pageBruto = primerValor(query.page);

  const limit = enteroEnRango(limitBruto, "limit", 1, LIMIT_MAXIMO);
  const pagina = enteroEnRango(pageBruto, "page", PAGINA_MINIMA, 100_000);

  const cursor = cursorBruto && cursorBruto.trim() !== "" ? cursorBruto.trim() : null;
  if (cursor && pagina !== null) {
    throw new ErrorPaginacion(
      "No se pueden combinar `cursor` y `page`: usa uno u otro para paginar.",
    );
  }

  const paginado = limit !== null || pagina !== null;
  const efectivo = limit ?? (paginado ? LIMIT_POR_DEFECTO : null);
  return {
    limit: efectivo,
    cursor,
    skip: pagina !== null && efectivo !== null ? (pagina - 1) * efectivo : 0,
    paginado,
  };
}

export interface MarcaKeyset {
  createdAt?: Date;
  updatedAt?: Date;
}

export type ColumnaKeyset = "createdAt" | "updatedAt";

export type OrdenKeyset = "asc" | "desc";

export interface DefinicionOrden {
  columna: ColumnaKeyset;
  sentido: OrdenKeyset;
}

export const ORDEN_CHATS: DefinicionOrden = { columna: "updatedAt", sentido: "desc" };
export const ORDEN_MENSAJES: DefinicionOrden = { columna: "createdAt", sentido: "asc" };

export function takeDePaginacion(paginacion: Paginacion): number | undefined {
  if (paginacion.limit === null) return undefined;
  return paginacion.limit + 1;
}

export function whereDeCursor(
  orden: DefinicionOrden,
  cursor: string | null,
  marca: MarcaKeyset | null,
  alcance: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!cursor || !marca) return undefined;
  const fecha = orden.columna === "createdAt" ? marca.createdAt : marca.updatedAt;
  if (!fecha) return undefined;

  const operador = orden.sentido === "asc" ? { gt: fecha } : { lt: fecha };
  const operadorId = orden.sentido === "asc" ? { gt: cursor } : { lt: cursor };
  return {
    AND: [
      alcance,
      {
        OR: [
          { [orden.columna]: operador },
          { [orden.columna]: fecha, id: operadorId },
        ],
      },
    ],
  };
}

export interface MetaPaginacion {

  limit: number | null;

  nextCursor: string | null;

  hasMore: boolean;

  count: number;
}

export function construirMetaPaginacion<T extends { id: string }>(
  filas: T[],
  paginacion: Paginacion,
): { filas: T[]; meta: MetaPaginacion } {
  const meta: MetaPaginacion = {
    limit: paginacion.limit,
    nextCursor: null,
    hasMore: false,
    count: filas.length,
  };
  if (paginacion.limit === null) return { filas, meta };
  if (filas.length <= paginacion.limit) return { filas, meta };
  const pagina = filas.slice(0, paginacion.limit);
  meta.nextCursor = pagina[pagina.length - 1].id;
  meta.hasMore = true;
  meta.count = pagina.length;
  return { filas: pagina, meta };
}
