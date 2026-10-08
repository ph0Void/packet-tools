

import { describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  getModelTextProvider,
  withEmptyStreamFallback,
  withTimeoutGuard,
} from "@/config/ModelProviderConfig";
import { envConfig } from "@/config/EnvConfig";


const PROVIDERS = [
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE",
  "OPENROUTER",
  "OLLAMA",
  "LMSTUDIO",
  "CUSTOM",
] as const;


function build(provider: string, overrides: Record<string, unknown> = {}) {
  return getModelTextProvider({
    provider: provider,
    model: "modelo-de-prueba",
    apiKey: "clave-ficticia",
    ...overrides,
  }) as any;
}


function retriesOfCliente(model: any): number | undefined {
  
  return model?.caller?.maxRetries;
}


function maxTokensOfLaPrompt(model: any): number | undefined {
  if (model?.numPredict !== undefined) return model.numPredict;
  const cuerpo = model?.invocationParams?.({});
  return (
    cuerpo?.max_tokens ??
    cuerpo?.generationConfig?.maxOutputTokens ??
    model?.params?.maxOutputTokens
  );
}

describe("V19 — timeout en todos los proveedores", () => {
  for (const provider of PROVIDERS) {
    it(`${provider}: recibe AGENT_PROVIDER_TIMEOUT_MS`, () => {
      const model = build(provider);

      expect(model.__providerTimeoutGuard).toBe(
        envConfig.AGENT_PROVIDER_TIMEOUT_MS,
      );
      expect(envConfig.AGENT_PROVIDER_TIMEOUT_MS).toBeGreaterThan(0);
    });
  }

  it("OPENAI/LMSTUDIO/CUSTOM: el SDK recibe `timeout` en su campo propio", () => {

    expect(build("OPENAI").timeout).toBe(envConfig.AGENT_PROVIDER_TIMEOUT_MS);
    expect(build("LMSTUDIO").timeout).toBe(
      envConfig.AGENT_PROVIDER_TIMEOUT_MS,
    );
    expect(build("CUSTOM").timeout).toBe(
      envConfig.AGENT_PROVIDER_TIMEOUT_MS,
    );
  });

  it("ANTHROPIC: el SDK recibe `timeout` vía clientOptions", () => {

    expect(build("ANTHROPIC").clientOptions).toEqual({
      timeout: envConfig.AGENT_PROVIDER_TIMEOUT_MS,
    });
  });

  it("GOOGLE/OPENROUTER/OLLAMA no aceptan `timeout`: queda el guard genérico", () => {

    for (const provider of ["GOOGLE", "OPENROUTER", "OLLAMA"]) {
      const model = build(provider);
      expect(model.__providerTimeoutGuard).toBe(
        envConfig.AGENT_PROVIDER_TIMEOUT_MS,
      );
      expect(model.timeout).toBeUndefined();
    }
  });

  it("admite override por parámetro de la función", () => {
    const model = build("OPENAI", { timeoutMs: 5_000 });
    expect(model.__providerTimeoutGuard).toBe(5_000);
    expect(model.timeout).toBe(5_000);
  });
});

describe("V19 — maxRetries en todos los proveedores", () => {
  for (const provider of PROVIDERS) {
    it(`${provider}: recibe AGENT_PROVIDER_MAX_RETRIES`, () => {
      expect(retriesOfCliente(build(provider))).toBe(
        envConfig.AGENT_PROVIDER_MAX_RETRIES,
      );
    });
  }

  it("OLLAMA ya no tiene el 2 hardcodeado: usa el valor de envConfig", () => {

    const model = build("OLLAMA", { maxRetries: 4 });
    expect(retriesOfCliente(model)).toBe(4);
  });

  it("admite override por parámetro de la función", () => {
    expect(retriesOfCliente(build("GOOGLE", { maxRetries: 7 }))).toBe(7);
  });

  it("el reintento vive en un solo sitio: el AsyncCaller, no el SDK", () => {

    expect(build("LMSTUDIO").clientConfig.maxRetries).toBeUndefined();
    expect(build("CUSTOM").clientConfig.maxRetries).toBeUndefined();
    expect(build("ANTHROPIC").clientOptions.maxRetries).toBeUndefined();


    const openai = build("OPENAI");
    openai._getClientOptions({});
    expect(openai.client.maxRetries).toBe(0);
  });
});

describe("V19 — maxOutputTokens configurable (ya no fijo en 2000)", () => {
  it("cada proveedor envía AGENT_MAX_OUTPUT_TOKENS en su petición", () => {
    const esperado = envConfig.AGENT_MAX_OUTPUT_TOKENS;
    expect(esperado).toBeGreaterThan(0);

    for (const provider of PROVIDERS) {
      expect(maxTokensOfLaPrompt(build(provider))).toBe(esperado);
    }
  });

  it("ya no está fijo en 2000", () => {
    expect(envConfig.AGENT_MAX_OUTPUT_TOKENS).not.toBe(2000);
    expect(build("OPENAI").maxTokens).not.toBe(2000);
  });

  it("admite override por proveedor", () => {
    for (const provider of PROVIDERS) {
      expect(
        maxTokensOfLaPrompt(build(provider, { maxOutputTokens: 12_000 })),
      ).toBe(12_000);
    }
  });
});


type ComportamientoStream =
  | "vacio"
  | "lanza"
  | "dos-chunks"
  | "chunk-y-lanza"
  | "cuelga";



class FakeProviderModel extends BaseChatModel {
  public modelcallsGenerate = 0;

  private readonly comportamiento: ComportamientoStream;
  private readonly errorStream?: unknown;

  constructor(
    comportamiento: ComportamientoStream,
    textFallback = "respuesta completa desde _generate",
    errorStream?: unknown,
  ) {
    super({});
    this.comportamiento = comportamiento;
    this.errorStream = errorStream;
    this.textFallback = textFallback;
  }

  private readonly textFallback: string;

  override _llmType(): string {
    return "fake-provider";
  }

  override async _generate(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.modelcallsGenerate += 1;
    return {
      generations: [
        {
          text: this.textFallback,
          message: new AIMessage({ content: this.textFallback }),
        },
      ],
    };
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    switch (this.comportamiento) {
      case "vacio":
        return;
      case "lanza":
        throw this.errorStream ?? new Error("stream vacío con error");
      case "dos-chunks":
        yield new ChatGenerationChunk({
          text: "hola ",
          message: new AIMessageChunk({ content: "hola " }),
        });
        yield new ChatGenerationChunk({
          text: "mundo",
          message: new AIMessageChunk({ content: "mundo" }),
        });
        return;
      case "chunk-y-lanza":
        yield new ChatGenerationChunk({
          text: "parcial",
          message: new AIMessageChunk({ content: "parcial" }),
        });
        throw new Error("stream roto tras emitir");
      case "cuelga":
        yield new ChatGenerationChunk({
          text: "primer chunk",
          message: new AIMessageChunk({ content: "primer chunk" }),
        });

        await new Promise(() => undefined);
    }
  }
}


function errorHttp(status: number, mensaje = "error"): Error {
  const e = new Error(mensaje) as Error & { status: number };
  e.status = status;
  return e;
}


const SHAPES_401 = [
  { name: "status (OpenAI/Anthropic APIError)", error: errorHttp(401) },
  {
    name: "statusCode (Google/OpenRouter RequestError)",
    error: Object.assign(new Error("unauthorized"), { statusCode: 401 }),
  },
  {
    name: "response.status (fetch/undici)",
    error: Object.assign(new Error("unauthorized"), {
      response: { status: 401 },
    }),
  },
  {
    name: "cause anidado (error de red envuelto)",
    error: Object.assign(new Error("fetch failed"), {
      cause: errorHttp(401),
    }),
  },
];

async function consumirText(model: BaseChatModel): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of await model.stream([new HumanMessage("hola")])) {
    parts.push(chunk.text);
  }
  return parts.join("");
}

describe("V19 — withEmptyStreamFallback no reintenta errores de autenticación", () => {
  for (const { name, error } of SHAPES_401) {
    it(`401 (${name}): NO llama a _generate y propaga el error`, async () => {
      const model = withEmptyStreamFallback(
        new FakeProviderModel("lanza", "no debe usarse", error),
      );

      await expect(consumirText(model)).rejects.toThrow(error.message);
      expect(model.modelcallsGenerate).toBe(0);
    });
  }

  for (const status of [400, 403, 404]) {
    it(`${status}: NO llama a _generate y propaga el error`, async () => {
      const model = withEmptyStreamFallback(
        new FakeProviderModel("lanza", "no debe usarse", errorHttp(status)),
      );

      await expect(consumirText(model)).rejects.toThrow("error");
      expect(model.modelcallsGenerate).toBe(0);
    });
  }

  it("un timeout NO se reintenta con _generate", async () => {

    const model = withEmptyStreamFallback(
      withTimeoutGuard(new FakeProviderModel("cuelga", "no debe usarse"), 20),
    );

    await expect(consumirText(model)).rejects.toThrow(/timeout/i);
    expect(model.modelcallsGenerate).toBe(0);
  });

  it("un AbortError externo (cancelación del turno) NO se reintenta", async () => {
    const abortado = new Error("Cancel: el turno fue cancelado");
    abortado.name = "AbortError";
    const model = withEmptyStreamFallback(
      new FakeProviderModel("lanza", "no debe usarse", abortado),
    );

    await expect(consumirText(model)).rejects.toThrow("Cancel");
    expect(model.modelcallsGenerate).toBe(0);
  });
});

describe("V19 — withEmptyStreamFallback sí reintenta stream vacío o error transitorio", () => {
  it("stream vacío sin error → una llamada a _generate", async () => {
    const model = withEmptyStreamFallback(new FakeProviderModel("vacio"));

    expect(await consumirText(model)).toBe(
      "respuesta completa desde _generate",
    );
    expect(model.modelcallsGenerate).toBe(1);
  });

  for (const status of [429, 500, 503, 502]) {
    it(`${status}: error transitorio → reintenta UNA vez con _generate`, async () => {
      const model = withEmptyStreamFallback(
        new FakeProviderModel("lanza", "respuesta completa desde _generate", errorHttp(status)),
      );

      expect(await consumirText(model)).toBe(
        "respuesta completa desde _generate",
      );
      expect(model.modelcallsGenerate).toBe(1);
    });
  }

  it("error de red sin código HTTP → reintenta (fallback conservador)", async () => {
    const model = withEmptyStreamFallback(
      new FakeProviderModel(
        "lanza",
        "respuesta completa desde _generate",
        new Error("ECONNRESET"),
      ),
    );

    expect(await consumirText(model)).toBe(
      "respuesta completa desde _generate",
    );
    expect(model.modelcallsGenerate).toBe(1);
  });

  it("stream con chunks → no toca _generate", async () => {
    const model = withEmptyStreamFallback(new FakeProviderModel("dos-chunks"));

    expect(await consumirText(model)).toBe("hola mundo");
    expect(model.modelcallsGenerate).toBe(0);
  });

  it("stream que emite y luego falla → el error se propaga sin fallback", async () => {
    const model = withEmptyStreamFallback(
      new FakeProviderModel("chunk-y-lanza"),
    );

    await expect(consumirText(model)).rejects.toThrow("stream roto tras emitir");
    expect(model.modelcallsGenerate).toBe(0);
  });
});

describe("V19 — withTimeoutGuard", () => {
  it("corta un stream que se cuelga tras emitir y no reintenta", async () => {
    const model = withTimeoutGuard(
      withEmptyStreamFallback(new FakeProviderModel("cuelga")),
      40,
    );

    await expect(consumirText(model)).rejects.toThrow(/40 ms/);
    expect(model.modelcallsGenerate).toBe(0);
  });

  it("propaga el error del stream cuando el plazo no vence", async () => {
    const model = withTimeoutGuard(new FakeProviderModel("dos-chunks"), 10_000);

    expect(await consumirText(model)).toBe("hola mundo");
  });

  it("es idempotente: no se envuelve dos veces", () => {
    const model = withTimeoutGuard(new FakeProviderModel("vacio"), 100);
    const otherTime = withTimeoutGuard(model, 100);

    expect(otherTime).toBe(model);
    expect((model as any).__providerTimeoutGuard).toBe(100);
  });

  it("con timeout no finito o <= 0 no envuelve nada", () => {
    const a = new FakeProviderModel("vacio");
    const b = new FakeProviderModel("vacio");

    expect(withTimeoutGuard(a, 0)).toBe(a);
    expect((a as any).__providerTimeoutGuard).toBeUndefined();
    expect(withTimeoutGuard(b, Number.POSITIVE_INFINITY)).toBe(b);
    expect((b as any).__providerTimeoutGuard).toBeUndefined();
  });

  it("aborta el signal que recibe el proveedor al vencer", async () => {

    let signalRecibido: AbortSignal | undefined;
    class Espia extends FakeProviderModel {
      override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
      ): AsyncGenerator<ChatGenerationChunk> {
        signalRecibido = options?.signal;
        yield* super._streamResponseChunks(messages, options, runManager);
      }
    }

    const model = withTimeoutGuard(new Espia("cuelga"), 30);

    await expect(consumirText(model)).rejects.toThrow(/timeout/i);
    expect(signalRecibido).toBeInstanceOf(AbortSignal);
    expect(signalRecibido!.aborted).toBe(true);
  });
});
