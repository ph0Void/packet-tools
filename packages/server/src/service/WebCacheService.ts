import { createHash } from "node:crypto";
import { searchWeb, type WebSearchResult } from "./WebSearchService";
import { Logger } from "@/utils/Logger";

const TTL_BUSQUEDA_MS = 60 * 60 * 1000;

const TTL_PAGINA_MS = 30 * 60 * 1000;

const MAX_ENTRADAS = 200;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cacheBusquedas = new Map<string, CacheEntry<WebSearchResult[]>>();
const cachePaginas = new Map<string, CacheEntry<PaginaExtraida>>();

function claveConsulta(query: string): string {
  return createHash("sha1")
    .update(query.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

function guardar<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttl: number,
): void {
  if (cache.size >= MAX_ENTRADAS) {
    const masAntigua = cache.keys().next().value;
    if (masAntigua !== undefined) cache.delete(masAntigua);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

function leer<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entrada = cache.get(key);
  if (!entrada) return null;
  if (entrada.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entrada.value;
}

function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function deduplicarResultados(
  resultados: WebSearchResult[],
  maxPorDominio = 2,
): WebSearchResult[] {
  const vistas = new Set<string>();
  const porDominio = new Map<string, number>();
  const salida: WebSearchResult[] = [];
  for (const resultado of resultados) {
    const url = resultado.url?.trim();
    if (!url) continue;
    if (vistas.has(url)) continue;
    const dominio = dominioDe(url);
    const usados = porDominio.get(dominio) ?? 0;
    if (usados >= maxPorDominio) continue;
    vistas.add(url);
    porDominio.set(dominio, usados + 1);
    salida.push(resultado);
  }
  return salida;
}

export interface PaginaExtraida {
  url: string;
  title: string;
  text: string;

  degraded: boolean;
}

export function extraerTextoPrincipal(html: string, limite = 8000): {
  title: string;
  text: string;
  degraded: boolean;
} {
  const sinNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const titulo = (sinNoise.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();

  const texto = sinNoise
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, codigo: string) =>
      String.fromCharCode(Number(codigo)),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    title: titulo.slice(0, 200),
    text: texto.slice(0, limite),

    degraded: texto.length < 40,
  };
}

class WebCacheService {

  async search(query: string, count = 5): Promise<WebSearchResult[]> {
    const clave = `${claveConsulta(query)}::${count}`;
    const enCache = leer(cacheBusquedas, clave);
    if (enCache) {
      Logger.info({
        message: "[WebCache] Búsqueda servida desde caché",
        data: { query, count },
      });
      return enCache;
    }

    const resultados = deduplicarResultados(await searchWeb(query, count), 2);
    guardar(cacheBusquedas, clave, resultados, TTL_BUSQUEDA_MS);
    return resultados;
  }

  async fetchPage(url: string): Promise<PaginaExtraida> {
    const normalizada = validarUrl(url);
    const enCache = leer(cachePaginas, normalizada);
    if (enCache) return enCache;

    const respuesta = await fetch(normalizada, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PacketToolsBot/1.0; +https://github.com/ph0Void/packet-tools)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status} ${respuesta.statusText}`);
    }
    const html = await respuesta.text();
    const { title, text, degraded } = extraerTextoPrincipal(html);
    const pagina: PaginaExtraida = {
      url: normalizada,
      title: title || normalizada,
      text,
      degraded,
    };
    guardar(cachePaginas, normalizada, pagina, TTL_PAGINA_MS);
    return pagina;
  }

  clear(): void {
    cacheBusquedas.clear();
    cachePaginas.clear();
  }

  stats(): { busquedas: number; paginas: number } {
    return { busquedas: cacheBusquedas.size, paginas: cachePaginas.size };
  }
}

export function validarUrl(url: string): string {
  let parseada: URL;
  try {
    parseada = new URL(String(url).trim());
  } catch {
    throw new Error("URL no válida.");
  }
  if (parseada.protocol !== "http:" && parseada.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http(s).");
  }
  return parseada.toString();
}

export const webCacheService = new WebCacheService();
