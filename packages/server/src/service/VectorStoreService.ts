import { getModelEmbeddingProvider } from "@/config/ModelProviderConfig";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Document } from "@langchain/core/documents";
import { Logger } from "@/utils/Logger";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

class VectorStoreService {
  private vectorStore: MemoryVectorStore | null = null;

  private async getVectorStore(): Promise<MemoryVectorStore> {
    if (this.vectorStore) {
      return this.vectorStore;
    }

    const provider = await prismaClient.modelProvider.findFirst({ where: { typeModel: "EMBEDDING", isActive: true }, orderBy: { updatedAt: "desc" } });
    if (!provider) throw new Error("No existe un ModelProvider EMBEDDING activo para el índice RAG.");

    const embeddingProvider = getModelEmbeddingProvider({ provider: provider.provider, model: provider.modelName, apiKey: provider.apiKey ?? undefined, baseUrl: provider.baseUrl ?? undefined });

    this.vectorStore = new MemoryVectorStore(embeddingProvider);

    await this.rehydrateFromDatabase();

    return this.vectorStore;
  }

  public async rehydrateFromDatabase(): Promise<void> {
    try {
      const kbItems = await prismaClient.knowledgeBase.findMany();
      if (!kbItems || kbItems.length === 0) return;

      const docsToEmbed = kbItems.map((item) => ({
        id: String(item.id),
        title: item.title,
        content: item.content,
      }));

      await this.addDocumentsToStore(docsToEmbed);
    } catch (error: any) {
      Logger.error({
        message: `[VECTOR_STORE_SERVICE] Error al rehidratar memoria`,
        data: error,
      });
      const motivo = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo indexar la base de conocimientos: ${motivo}`);
    }
  }

  private async addDocumentsToStore(
    documents: { title: string; content: string; id: string }[],
  ): Promise<void> {
    if (!this.vectorStore || documents.length === 0) return;

    const existingDocIds = new Set<string>(
      ((this.vectorStore as any).memoryVectors ?? []).map((vector: any) =>
        String(vector?.metadata?.docId ?? ""),
      ),
    );

    const chunkSize = 1000;
    const langchainDocs: Document[] = [];

    for (const doc of documents) {
      if (existingDocIds.has(String(doc.id))) continue;

      for (let i = 0; i * chunkSize < doc.content.length; i++) {
        const chunk = doc.content.slice(i * chunkSize, (i + 1) * chunkSize);
        langchainDocs.push(
          new Document({
            pageContent: chunk,
            metadata: { title: doc.title, docId: doc.id, chunkIndex: i },
          }),
        );
      }
    }

    if (langchainDocs.length > 0) {
      await this.vectorStore.addDocuments(langchainDocs);
    }
  }

  async indexDocuments(
    documents: { title: string; content: string; id: string }[],
  ): Promise<void> {
    if (documents.length === 0) return;
    await this.getVectorStore();
    await this.addDocumentsToStore(documents);
  }

  async searchDocuments(
    query: string,
    k: number = 4,
  ): Promise<{ content: string; metadata: Record<string, any> }[]> {
    if (!query || query.trim() === "") {
      throw new Error("La consulta no puede estar vacía.");
    }

    try {
      const store = await this.getVectorStore();
      const results = await store.similaritySearch(query, k);

      return results.map((doc: any) => ({
        content: doc.pageContent,
        metadata: { ...doc.metadata, mode: "semantic" },
      }));
    } catch (error: any) {
      const motivo = error instanceof Error ? error.message : String(error);
      Logger.warning({
        message:
          "[VECTOR_STORE_SERVICE] Búsqueda semántica no disponible; se degrada a búsqueda textual.",
        data: { query, motivo },
      });
      return this.searchTextually(query, k);
    }
  }

  private async searchTextually(
    query: string,
    k: number,
  ): Promise<{ content: string; metadata: Record<string, any> }[]> {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3)
      .slice(0, 8);

    if (terms.length === 0) return [];

    const items = await prismaClient.knowledgeBase.findMany();
    const scored = items
      .map((item) => {
        const haystack = `${item.title ?? ""}\n${item.content ?? ""}`.toLowerCase();
        const score = terms.reduce(
          (total, term) => total + this.countOccurrences(haystack, term),
          0,
        );
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored.map(({ item, score }) => ({
      content: this.buildTextSnippet(item.content ?? "", terms),
      metadata: {
        title: item.title,
        docId: item.id,
        mode: "textual",
        score,
      },
    }));
  }

  private countOccurrences(haystack: string, term: string): number {
    return haystack.split(term).length - 1;
  }

  private buildTextSnippet(content: string, terms: string[]): string {
    const snippetLength = 1000;
    if (content.length <= snippetLength) return content;

    const lower = content.toLowerCase();
    let matchIndex = -1;
    for (const term of terms) {
      const index = lower.indexOf(term);
      if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
        matchIndex = index;
      }
    }
    if (matchIndex === -1) return content.slice(0, snippetLength);

    const start = Math.max(0, matchIndex - Math.floor(snippetLength / 3));
    return content.slice(start, start + snippetLength);
  }

  public async deleteDocument(docId: string): Promise<void> {
    this.resetMemoryStore();
    try {
      await this.getVectorStore();
    } catch (error: any) {
      Logger.warning({
        message:
          "[VECTOR_STORE_SERVICE] Documento eliminado sin reconstruir el índice vectorial.",
        data: { docId, motivo: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  public resetMemoryStore(): void {
    this.vectorStore = null;
  }
}

export const vectorStoreService = new VectorStoreService();
