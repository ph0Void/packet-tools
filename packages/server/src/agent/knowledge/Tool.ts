import { vectorStoreService } from "@/service/VectorStoreService";
import { hybridSearchService } from "@/service/HybridSearchService";
import {
  searchWeb,
  WebSearchNetworkError,
  type WebSearchResult,
} from "@/service/WebSearchService";
import { webCacheService } from "@/service/WebCacheService";
import { tool } from "@langchain/core/tools";
import z from "zod";
import { Logger } from "@/utils/Logger";

export const searchWebTool = tool(
  async ({ query }) => {
    try {
      Logger.info({
        message: "[search_web_tool] Ejecutando la busqueda: ",
        data: query,
      });

      const results = await webCacheService.search(query, 5);

      if (results.length === 0) {
        return "No se encontraron resultados para la búsqueda.";
      }

      Logger.info({
        message: "[search_web_tool] Busqueda ejecutada correctamente.",
        data: { resultados: results.length },
      });

      return results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}\nDescripción: ${r.snippet}\n`,
        )
        .join("\n");
    } catch (error: any) {
      Logger.error({
        message: "[search_web_tool] Ocurrio un error al ejecutar la busqueda: ",
        data: {
          query: query,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      if (error instanceof WebSearchNetworkError) {
        throw new Error(error.message);
      }

      throw new Error(
        `Ocurrió un error al buscar en internet: ${error?.message ?? String(error)}`,
      );
    }
  },
  {
    name: "search_web_tool",
    description:
      "Search the public web (DuckDuckGo lite) for up-to-date information; cite the returned URLs in the answer. Results are cached for 1h and deduplicated by domain.",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  },
);

export const fetchWebPageTool = tool(
  async ({ url }) => {
    try {
      const pagina = await webCacheService.fetchPage(url);
      return JSON.stringify({
        url: pagina.url,
        title: pagina.title,
        text: pagina.text,
        ...(pagina.degraded
          ? { note: "Extracción parcial: la página usa HTML complejo; el texto puede estar incompleto." }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error({
        message: "[fetch_web_page_tool] Error descargando la página",
        data: { url, error: message },
      });

      throw new Error(`No se pudo descargar la página: ${message}`);
    }
  },
  {
    name: "fetch_web_page_tool",
    description:
      "Fetch a specific web page and return its readable text (scripts, styles and navigation are stripped). Use it only for pages that matter to the answer: it is much more expensive in context than a search result.",
    schema: z.object({
      url: z.string().url().describe("Absolute http(s) URL to read"),
    }),
  },
);

export const searchKnowledgeBaseTool = tool(
  async ({ query, limit = 4, type }) => {
    try {
      Logger.info({
        message:
          "[search_knowledge_base_tool] Ejecutando la busqueda en la base de conocimientos: ",
        data: { query, limit, type: type ?? "DATA" },
      });

      const resultado = await hybridSearchService.search(query, {
        k: limit,
        type: type ?? "DATA",
      });

      if (resultado.chunks.length === 0) {
        return JSON.stringify({
          message:
            "No se encontró información relevante en la base de conocimiento.",
          sources: [],
        });
      }

      Logger.info({
        message:
          "[search_knowledge_base_tool] Busqueda ejecutada correctamente.",
        data: { count: resultado.chunks.length, mode: resultado.mode },
      });

      return JSON.stringify({
        documents: resultado.chunks.map((c) => c.content),
        metadatas: resultado.chunks.map((c) => ({
          title: c.source,
          docId: c.docId,
          score: c.score,
          mode: c.mode,
        })),
        sources: resultado.sources,
        mode: resultado.mode,
        ...(resultado.mode === "textual"
          ? {
              note: "Resultados por búsqueda textual (índice semántico no disponible); pueden ser menos precisos.",
            }
          : {}),
      });
    } catch (error: any) {
      Logger.error({
        message:
          "[search_knowledge_base_tool] Ocurrio un error al ejecutar la busqueda: ",
        data: {
          query: query,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      throw new Error(
        `No se pudo consultar la base de conocimientos: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
  {
    name: "search_knowledge_base",
    description:
      "Search the company knowledge base (internal documentation) and return the most relevant chunks with their sources. Uses hybrid retrieval: semantic + exact-term matching, so identifiers, model numbers and command syntax are also found.",
    schema: z.object({
      query: z.string().describe("Search query or keywords"),
      limit: z
        .number()
        .optional()
        .default(4)
        .describe("Number of chunks to retrieve"),
      type: z
        .enum(["DATA", "SKILL"])
        .optional()
        .default("DATA")
        .describe("'DATA' documents (default) or 'SKILL' playbooks"),
    }),
  },
);

export const ingestDocumentToChromaTool = tool(
  async ({ title, content, docId }) => {
    try {
      Logger.info({
        message:
          "[ingest_document_to_chroma_tool] Indexando documento en la base de conocimientos: ",
        data: {
          title: title,
        },
      });

      await vectorStoreService.indexDocuments([
        {
          title,
          content,
          id: docId,
        },
      ]);

      Logger.info({
        message:
          "[ingest_document_to_chroma_tool] Documento indexado correctamente en memoria.",
        data: {
          title: title,
        },
      });

      return JSON.stringify({
        success: true,
        message: `Documento "${title}" indexado correctamente en memoria.`,
      });
    } catch (error: any) {
      Logger.error({
        message:
          "[ingest_document_to_chroma_tool] Ocurrio un error al indexar el documento: ",
        data: {
          title: title,
          error: error,
        },
      });

      return JSON.stringify({
        error: `Error indexando en memoria: ${error.message}`,
      });
    }
  },
  {
    name: "ingest_document_to_chroma",
    description:
      "Index one document into the vector store so it becomes searchable by the RAG search tool.",
    schema: z.object({
      title: z.string().describe("Document title"),
      content: z.string().describe("Contenido completo a indexar"),
      docId: z
        .string()
        .describe("Unique document id (e.g. the KnowledgeBase id)"),
    }),
  },
);

export const knowledgeBaseTools = [
  searchKnowledgeBaseTool,
  ingestDocumentToChromaTool,
  searchWebTool,
  fetchWebPageTool,
];
