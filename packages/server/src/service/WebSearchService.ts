import { Logger } from "@/utils/Logger";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WebSearchNetworkError";
  }
}

const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";

const DDG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml",
};

const RETRY_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 10000;

const MENSAJE_ERROR_CONEXION =
  "No se pudo conectar con el servicio de búsqueda (DuckDuckGo). Verifica tu conexión a internet e inténtalo de nuevo.";

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function extractRealUrl(href: string): string {
  const normalizedHref = href.replace(/&amp;/gi, "&");
  const uddgMatch = normalizedHref.match(/[?&]uddg=([^&]+)/i);

  if (!uddgMatch) {
    return href;
  }

  try {
    return decodeURIComponent(uddgMatch[1]);
  } catch {
    return href;
  }
}

function extractHref(attributes: string): string {
  const hrefMatch = attributes.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!hrefMatch) {
    return "";
  }

  return hrefMatch[1] ?? hrefMatch[2] ?? "";
}

function isDuckDuckGoUrl(url: string): boolean {
  try {
    const host = new URL(url, "https://duckduckgo.com").hostname.toLowerCase();
    return host === "duckduckgo.com" || host.endsWith(".duckduckgo.com");
  } catch {
    return false;
  }
}

export function parseDdgLiteHtml(
  html: string,
  limit: number,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  if (!html || limit <= 0) {
    return results;
  }

  const linkRegex =
    /<a\b([^>]*\bclass\s*=\s*['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<td\b[^>]*\bclass\s*=\s*['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(html)) !== null && results.length < limit) {

    const rowStart = html.lastIndexOf("<tr", linkMatch.index);
    if (
      rowStart !== -1 &&
      /result-sponsored/i.test(html.slice(rowStart, linkMatch.index))
    ) {
      continue;
    }

    const title = stripHtml(linkMatch[2]);
    const href = extractHref(linkMatch[1]);
    const url = extractRealUrl(href);

    if (isDuckDuckGoUrl(url)) {
      continue;
    }

    snippetRegex.lastIndex = linkRegex.lastIndex;
    const snippetMatch = snippetRegex.exec(html);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    results.push({ title, url, snippet });
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchWeb(
  query: string,
  count = 5,
): Promise<WebSearchResult[]> {
  const url = `${DDG_LITE_URL}?q=${encodeURIComponent(query)}`;

  Logger.info({
    message: "[WebSearchService] Ejecutando búsqueda web en DuckDuckGo Lite: ",
    data: { query, count },
  });

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: DDG_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const results = parseDdgLiteHtml(html, count);

      if (results.length > 0 || attempt === 2) {
        Logger.info({
          message: "[WebSearchService] Búsqueda web finalizada.",
          data: { query, intento: attempt, resultados: results.length },
        });

        return results;
      }

      Logger.error({
        message:
          "[WebSearchService] La búsqueda no devolvió resultados; reintentando.",
        data: { query, intento: attempt },
      });
    } catch (error) {
      lastError = error;

      Logger.error({
        message: "[WebSearchService] Error al conectar con DuckDuckGo Lite: ",
        data: {
          query,
          intento: attempt,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    if (attempt === 1) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw new WebSearchNetworkError(MENSAJE_ERROR_CONEXION, {
    cause: lastError,
  });
}
