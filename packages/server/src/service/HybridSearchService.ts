import { prismaClient } from "@/prisma/lib/PrismaClient";
import { vectorStoreService } from "./VectorStoreService";
import type { TypeDataBase } from "@/prisma/generated/enums";
import { Logger } from "@/utils/Logger";

export interface RagChunk {
  content: string;

  source: string;

  score: number;

  mode: string;
  docId: string;
}

export interface HybridSearchOptions {

  k?: number;

  pool?: number;

  type?: TypeDataBase;
}

export interface HybridSearchResult {
  chunks: RagChunk[];

  sources: string[];
  mode: "hybrid" | "semantic" | "textual" | "none";
}

const RRF_K = 60;

const MAX_CHUNKS_POR_DOC = 2;

class HybridSearchService {

  async search(
    query: string,
    options: HybridSearchOptions = {},
  ): Promise<HybridSearchResult> {
    const limpia = String(query ?? "").trim();
    if (!limpia) return { chunks: [], sources: [], mode: "none" };

    const k = options.k ?? 4;
    const pool = options.pool ?? 20;

    const [semanticos, textuales] = await Promise.all([
      this.buscarSemanticos(limpia, pool),
      this.buscarTextuales(limpia, pool, options.type),
    ]);

    const semanticosFiltrados = options.type
      ? await this.filtrarPorTipo(semanticos, options.type)
      : semanticos;

    const fusionados = this.fusionarRrf(semanticosFiltrados, textuales);
    if (fusionados.length === 0) {
      return { chunks: [], sources: [], mode: "none" };
    }

    const finales = this.diversificar(fusionados, k);
    const sources = [...new Set(finales.map((c) => c.source))];
    const usaAmbos = semanticosFiltrados.length > 0 && textuales.length > 0;
    return {
      chunks: finales,
      sources,
      mode: usaAmbos
        ? "hybrid"
        : semanticosFiltrados.length > 0
          ? "semantic"
          : "textual",
    };
  }

  private async buscarSemanticos(
    query: string,
    pool: number,
  ): Promise<RagChunk[]> {
    try {
      const docs = await vectorStoreService.searchDocuments(query, pool);
      return docs.map((doc) => ({
        content: String(doc.content ?? ""),
        source: String(doc.metadata?.title ?? "Sin título"),
        score: 0,
        mode: "semantic",
        docId: String(doc.metadata?.docId ?? ""),
      }));
    } catch (error) {
      Logger.warning({
        message: "[RAG_HYBRID] Búsqueda semántica no disponible",
        data: { query, motivo: error instanceof Error ? error.message : String(error) },
      });
      return [];
    }
  }

  private async buscarTextuales(
    query: string,
    pool: number,
    type?: TypeDataBase,
  ): Promise<RagChunk[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const items = await prismaClient.knowledgeBase.findMany({
      where: type ? { type } : undefined,
      select: { id: true, title: true, content: true },
    });
    if (items.length === 0) return [];

    const longitudes = items.map((i) => `${i.title ?? ""}\n${i.content ?? ""}`.length);
    const longMedia = longitudes.reduce((a, b) => a + b, 0) / longitudes.length || 1;

    const puntuados = items.map((item) => {
      const titulo = (item.title ?? "").toLowerCase();
      const cuerpo = (item.content ?? "").toLowerCase();
      const largo = titulo.length + cuerpo.length || 1;
      const norm = 1 - 0.75 + 0.75 * (largo / longMedia);

      let score = 0;
      for (const term of terms) {
        const enTitulo = countOcurrencias(titulo, term);
        const enCuerpo = countOcurrencias(cuerpo, term);

        score += (enTitulo * 3 + enCuerpo) / norm;
      }
      return { item, score };
    });

    return puntuados
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, pool)
      .map(({ item, score }) => ({
        content: snippet(item.content ?? "", terms),
        source: item.title ?? "Sin título",
        score,
        mode: "textual",
        docId: item.id,
      }));
  }

  private async filtrarPorTipo(
    chunks: RagChunk[],
    type: TypeDataBase,
  ): Promise<RagChunk[]> {
    const atribuidos = chunks.filter((c) => c.docId.length > 0);
    const ids = [...new Set(atribuidos.map((c) => c.docId))];
    if (ids.length === 0) return [];
    const permitidos = await prismaClient.knowledgeBase.findMany({
      where: { id: { in: ids }, type },
      select: { id: true },
    });
    const set = new Set(permitidos.map((p) => p.id));
    return atribuidos.filter((c) => set.has(c.docId));
  }

  private fusionarRrf(
    ...listas: Array<Array<{ docId: string; content: string; source: string; mode: string }>>
  ): RagChunk[] {
    const acumulado = new Map<
      string,
      RagChunk & { ranks: number[]; modos: Set<string> }
    >();

    listas.forEach((lista, indiceLista) => {
      lista.forEach((item, rank) => {
        const clave = `${item.docId}::${item.content.slice(0, 80)}`;
        const previo = acumulado.get(clave);
        const aporteRrf = 1 / (RRF_K + rank + 1);
        if (previo) {
          previo.score += aporteRrf;
          previo.ranks.push(rank);
          previo.modos.add(item.mode);
        } else {
          acumulado.set(clave, {
            docId: item.docId,
            content: item.content,
            source: item.source,
            score: aporteRrf,
            ranks: [rank],
            modos: new Set([item.mode]),
            mode: item.mode,
          });
        }
      });
    });

    return [...acumulado.values()]
      .sort((a, b) => b.score - a.score)
      .map(({ ranks, modos, ...chunk }) => ({
        ...chunk,

        score: Number((chunk.score * 1000).toFixed(4)),
        mode: modos.size > 1 ? "hybrid" : [...modos][0],
        ranks: ranks.length,
      }));
  }

  private diversificar(chunks: RagChunk[], k: number): RagChunk[] {
    const porDoc = new Map<string, number>();
    const finales: RagChunk[] = [];
    for (const chunk of chunks) {
      if (finales.length >= k) break;
      const vistos = porDoc.get(chunk.docId) ?? 0;
      if (vistos >= MAX_CHUNKS_POR_DOC) continue;
      porDoc.set(chunk.docId, vistos + 1);
      finales.push(chunk);
    }

    if (finales.length < k) {
      for (const chunk of chunks) {
        if (finales.length >= k) break;
        if (!finales.includes(chunk)) finales.push(chunk);
      }
    }
    return finales;
  }
}

const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","como","para","pero","del","las",
  "los","que","una","uno","sus","por","con","son","the","how","what","when",
  "que","como","hacer","hacer","para","sobre","entre","este","esta","esto",
]);

function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}._/-]+/u)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ].slice(0, 12);
}

function countOcurrencias(texto: string, term: string): number {
  return texto.split(term).length - 1;
}

function snippet(content: string, terms: string[]): string {
  const max = 1200;
  if (content.length <= max) return content;
  const lower = content.toLowerCase();
  let indice = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (indice === -1 || i < indice)) indice = i;
  }
  if (indice === -1) return content.slice(0, max);
  const inicio = Math.max(0, indice - Math.floor(max / 3));
  return content.slice(inicio, inicio + max);
}

export const hybridSearchService = new HybridSearchService();
