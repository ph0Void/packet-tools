import { ChatGoogle } from "@langchain/google";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";
import { Logger } from "@/utils/Logger";
import { envConfig } from "@/config/EnvConfig";

interface ModelProvider {
  provider: string;
  model: string;
  apiKey: string;
  temperature?: number;
  baseUrl?: string;
  maxOutputTokens?: number;

  timeoutMs?: number;

  maxRetries?: number;
}

const TIMEOUT_POR_DEFECTO_MS = envConfig.AGENT_PROVIDER_TIMEOUT_MS;
const MAX_RETRIES_POR_DEFECTO = envConfig.AGENT_PROVIDER_MAX_RETRIES;
const MAX_OUTPUT_TOKENS_POR_DEFECTO = envConfig.AGENT_MAX_OUTPUT_TOKENS;

const ESTADOS_SIN_REINTENTO = new Set([
  400, 401, 402, 403, 404, 405, 406, 407, 409, 413,
]);

class ProviderTimeoutError extends Error {
  readonly lc_error_code = "MODEL_TIMEOUT";

  constructor(timeoutMs: number) {
    super(`El proveedor no respondió en ${timeoutMs} ms (timeout).`);
    this.name = "ProviderTimeoutError";
  }
}

function esErrorDePlazoOAborto(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const nombre = (error as { name?: unknown }).name;
  if (nombre === "ProviderTimeoutError" || nombre === "AbortError") return true;
  return (error as { lc_error_code?: unknown }).lc_error_code === "MODEL_TIMEOUT";
}

function extraerCodigoHttp(error: unknown, profundidad = 0): number | undefined {
  if (!error || typeof error !== "object" || profundidad > 4) return undefined;
  const e = error as Record<string, unknown>;

  for (const campo of ["status", "statusCode"]) {
    const valor = e[campo];
    if (typeof valor === "number" && valor >= 100 && valor <= 599) return valor;
  }

  const response = e.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") return response.status;

  return extraerCodigoHttp(e.cause, profundidad + 1);
}

function debeReintentarStreamVacio(error: unknown): boolean {
  if (esErrorDePlazoOAborto(error)) return false;
  const status = extraerCodigoHttp(error);
  if (status === undefined) return true; // no parseable → conservador
  return !ESTADOS_SIN_REINTENTO.has(status);
}

export function withEmptyStreamFallback<T>(model: T): T {
  const candidato = model as any;

  if (typeof candidato?._streamResponseChunks !== "function") {
    return model;
  }

  const original = candidato._streamResponseChunks;

  candidato._streamResponseChunks = async function* (...args: any[]) {

    if (candidato.__emptyStreamFallbackActive) {
      yield* original.apply(this, args);
      return;
    }

    let emitted = false;
    let errorStream: unknown;

    try {
      for await (const chunk of original.apply(this, args)) {
        emitted = true;
        yield chunk;
      }
    } catch (error) {

      if (emitted) throw error;

      errorStream = error;
    }

    if (emitted) return;

    if (errorStream !== undefined && !debeReintentarStreamVacio(errorStream)) {
      const status = extraerCodigoHttp(errorStream);
      Logger.warning({
        message:
          "[ModelProvider] Stream vacío con error no reintentable: se propaga sin llamar a _generate.",
        data: {
          status: status ?? "desconocido",
          lc_error_code:
            (errorStream as { lc_error_code?: unknown })?.lc_error_code ?? undefined,
          timeout_o_aborto: esErrorDePlazoOAborto(errorStream),
          mensaje:
            errorStream instanceof Error
              ? errorStream.message.slice(0, 300)
              : String(errorStream).slice(0, 300),
        },
      });
      throw errorStream;
    }

    if (errorStream !== undefined) {
      const status = extraerCodigoHttp(errorStream);
      Logger.info({
        message:
          "[ModelProvider] Stream vacío con error transitorio: se reintenta una vez con _generate.",
        data: {
          status: status ?? "no parseable (fallback conservador)",
          mensaje:
            errorStream instanceof Error
              ? errorStream.message.slice(0, 300)
              : String(errorStream).slice(0, 300),
        },
      });
    }

    const [messages, options, runManager] = args;
    candidato.__emptyStreamFallbackActive = true;
    let result: any;
    try {
      result = await (this as any)._generate(messages, options, runManager);
    } finally {
      candidato.__emptyStreamFallbackActive = false;
    }
    const message = result?.generations?.[0]?.message;

    if (!message) return;

    const content = message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((part: any) => part?.type === "text")
              .map((part: any) => part?.text ?? "")
              .join("")
          : "";

    yield new ChatGenerationChunk({
      text,
      message: new AIMessageChunk({
        content: message.content,
        tool_calls: message.tool_calls,
        additional_kwargs: message.additional_kwargs,
      }),
    });
  };

  return model;
}

export function withTimeoutGuard<T>(model: T, timeoutMs: number): T {
  const candidato = model as any;

  const activo = Number.isFinite(timeoutMs) && timeoutMs > 0;

  if (!activo || candidato.__providerTimeoutGuard) return model;

  const marcar = (fn: Function | undefined) =>
    typeof fn === "function" ? fn : undefined;

  candidato.__providerTimeoutGuard = timeoutMs;

  const crearReloj = (signalExterno?: AbortSignal) => {
    const controller = new AbortController();
    const relanzar = () => controller.abort();

    if (signalExterno) {
      if (signalExterno.aborted) controller.abort();
      else signalExterno.addEventListener("abort", relanzar, { once: true });
    }

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const plazo = new Promise<never>((_, reject) => {
      temporizador = setTimeout(() => {
        controller.abort();
        reject(new ProviderTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    plazo.catch(() => undefined);

    return {
      signal: controller.signal,
      plazo,
      dispose: () => {
        if (temporizador !== undefined) clearTimeout(temporizador);
        signalExterno?.removeEventListener("abort", relanzar);
      },
    };
  };

  const generarOriginal = marcar(candidato._generate);
  if (generarOriginal) {
    candidato._generate = async function (...args: any[]) {
      const [messages, options, runManager] = args;
      const reloj = crearReloj(options?.signal);
      try {
        return await Promise.race([
          generarOriginal.call(
            this,
            messages,
            { ...options, signal: reloj.signal },
            runManager,
          ),
          reloj.plazo,
        ]);
      } finally {
        reloj.dispose();
      }
    };
  }

  const streamOriginal = marcar(candidato._streamResponseChunks);
  if (streamOriginal) {
    candidato._streamResponseChunks = async function* (...args: any[]) {
      const [messages, options, runManager] = args;
      const reloj = crearReloj(options?.signal);
      const iterador = streamOriginal.call(
        this,
        messages,
        { ...options, signal: reloj.signal },
        runManager,
      );
      try {

        while (true) {
          const siguiente = await Promise.race([iterador.next(), reloj.plazo]);
          if (siguiente?.done) return;
          if (siguiente?.value !== undefined) yield siguiente.value;
        }
      } finally {
        reloj.dispose();

        if (iterador?.return) void iterador.return(undefined).catch(() => undefined);
      }
    };
  }

  return model;
}

export function getModelTextProvider(data: Partial<ModelProvider>) {
  const provider = data.provider?.toUpperCase()?.trim();

  const timeoutMs = data.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS;
  const maxRetries = data.maxRetries ?? MAX_RETRIES_POR_DEFECTO;
  const maxOutputTokens = data.maxOutputTokens ?? MAX_OUTPUT_TOKENS_POR_DEFECTO;
  const temperature = data.temperature ?? 0.7;

  if (!data.apiKey) {
    Logger.error({
      message:
        "API Key faltante para el proveedor: " +
        provider +
        ". Ejecuta el seed para configurarla.",
      data: data,
    });
  }

  const finalizar = <T>(model: T) =>
    withTimeoutGuard(withEmptyStreamFallback(model), timeoutMs);

  switch (provider) {
    case "GOOGLE":
      return finalizar(
        new ChatGoogle({
          apiKey: data.apiKey,
          model: data.model!,
          temperature,
          maxOutputTokens,
          maxRetries,
        }),
      );

    case "OPENAI":
      return finalizar(
        new ChatOpenAI({
          apiKey: data.apiKey,
          model: data.model!,
          temperature,
          maxTokens: maxOutputTokens,
          timeout: timeoutMs,
          maxRetries,
        }),
      );

    case "ANTHROPIC":
      return finalizar(
        new ChatAnthropic({
          apiKey: data.apiKey,
          model: data.model!,
          temperature,
          maxTokens: maxOutputTokens,
          maxRetries,

          clientOptions: { timeout: timeoutMs },
        }),
      );

    case "OPENROUTER":
      return finalizar(
        new ChatOpenRouter({
          apiKey: data.apiKey,
          model: data.model,
          temperature: data.temperature,
          maxTokens: maxOutputTokens,
          maxRetries,
        }),
      );

    case "OLLAMA":
      return finalizar(
        new ChatOllama({
          model: data.model!,
          temperature,

          baseUrl: data.baseUrl?.trim() || "http://localhost:11434",
          maxRetries,

          numPredict: maxOutputTokens,
        }),
      );

    case "LMSTUDIO":
      return finalizar(
        new ChatOpenAI({

          apiKey: data.apiKey?.trim() || "not-needed",
          model: data.model!,
          configuration: {
            baseURL: data.baseUrl?.trim() || "http://localhost:1234/v1",
          },
          temperature,
          maxTokens: maxOutputTokens,
          timeout: timeoutMs,
          maxRetries,
        }),
      );

    case "CUSTOM":
      return finalizar(
        new ChatOpenAI({
          apiKey: data.apiKey!,
          model: data.model!,
          configuration: {
            baseURL: data.baseUrl,
            defaultHeaders: {
              Authorization: `Bearer ${data.apiKey}`,
            },
          },
          temperature,
          maxTokens: maxOutputTokens,
          timeout: timeoutMs,
          maxRetries,
        }),
      );

    default:
      return finalizar(
        new ChatOpenAI({
          apiKey: data.apiKey!,
          model: data.model!,
          configuration: {
            baseURL: data.baseUrl,
            defaultHeaders: {
              Authorization: `Bearer ${data.apiKey}`,
            },
          },
          temperature,
          maxTokens: maxOutputTokens,
          timeout: timeoutMs,
          maxRetries,
        }),
      );
  }
}

export function getModelEmbeddingProvider(data: Partial<ModelProvider>) {
  const provider = data.provider?.toUpperCase()?.trim();

  const apiKey = data.apiKey?.trim() || undefined;
  const baseUrl = data.baseUrl?.trim() || undefined;

  Logger.info({
    message: "Embedding → " + data.model + " | Proveedor → " + provider,
  });

  const requireApiKey = (nombre: string): string => {
    if (!apiKey) {
      throw new Error(
        `Embeddings: API Key faltante para el proveedor "${nombre}". Configúrala en /dashboard/configuration.`,
      );
    }
    return apiKey;
  };

  const isLocalUrl = (url: string | undefined): boolean =>
    typeof url === "string" &&
    (url.includes("localhost") || url.includes("127.0.0.1"));

  switch (provider) {
    case "GOOGLE":
      return new GoogleGenerativeAIEmbeddings({
        apiKey: requireApiKey("GOOGLE"),
        model: data.model,
      });

    case "OPENAI":
      return new OpenAIEmbeddings({
        apiKey: requireApiKey("OPENAI"),
        model: data.model,
      });

    case "OPENROUTER":
      return new OpenAIEmbeddings({
        apiKey: requireApiKey("OPENROUTER"),
        model: data.model!,
        configuration: {
          baseURL: baseUrl ?? "https://openrouter.ai/api/v1",
          defaultHeaders: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      });

    case "ANTHROPIC":
      throw new Error(
        `[ProviderConfig] El proveedor Anthropic no ofrece modelos de embeddings nativos en LangChain. Por favor utiliza OpenAI, Google u Ollama para los embeddings.`,
      );

    case "OLLAMA":
      return new OllamaEmbeddings({
        model: data.model!,
        baseUrl: baseUrl ?? "http://localhost:11434",
      });

    case "LMSTUDIO":
      return new OpenAIEmbeddings({
        apiKey: apiKey ?? "not-needed",
        model: data.model!,
        configuration: {
          baseURL: baseUrl ?? "http://localhost:1234/v1",
          defaultHeaders: {
            Authorization: `Bearer ${apiKey ?? "not-needed"}`,
          },
        },
      });

    case "CUSTOM": {
      const local = isLocalUrl(baseUrl);
      return new OpenAIEmbeddings({

        apiKey: local ? apiKey ?? "not-needed" : requireApiKey("CUSTOM"),
        model: data.model!,
        configuration: {
          baseURL: baseUrl,
          defaultHeaders: {
            Authorization: `Bearer ${apiKey ?? "not-needed"}`,
          },
        },
      });
    }

    default: {
      const local = isLocalUrl(baseUrl);
      return new OpenAIEmbeddings({
        apiKey: local ? apiKey ?? "not-needed" : requireApiKey(provider ?? "CUSTOM"),
        model: data.model!,
        configuration: {
          baseURL: baseUrl,
          defaultHeaders: {
            Authorization: `Bearer ${apiKey ?? "not-needed"}`,
          },
        },
      });
    }
  }
}
