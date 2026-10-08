

import { describe, expect, it } from "vitest";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { type ChatGeneration, type ChatResult } from "@langchain/core/outputs";
import {
  chunkDeStream,
  crearRelojDeTurno,
  duracionLegible,
  LC_ERROR_CODE_PLAZO_CUMPLIDO,
  MARCA_TURNO_SIN_TIEMPO,
  mensajeDeCierrePorTiempo,
  plazoDeTurno,
  streamConPlazo,
  TurnoSinTiempoError,
} from "@/agent/deep/turnPlazo";
import { MARCA_AVISO_TIEMPO, turnPlazoMiddleware } from "@/agent/deep/turnPlazoMiddleware";
import { buildDeepConfig } from "@/agent/deep/runner";
import { deepTurnContextSchema } from "@/agent/deep/context";
import {
  anexarAvisoPresupuesto,
  codigoDeErrorStream,
} from "@/api/router/continuation";
import { contieneAvisoDeCorte } from "@/api/router/corteTurno";
import { mapLlmError } from "@/api/router/turnoStream";


function streamSlow(n: number, waitMs: number): AsyncIterable<unknown> {
  return (async function* () {
    for (let i = 0; i < n; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      yield new AIMessage({ content: `paso ${i}` });
    }
  })();
}


async function recorrerHastaElCut(params: {
  stream: AsyncIterable<unknown>;
  limitMs: number;
}): Promise<{ seen: unknown[]; error: unknown }> {
  const reloj = crearRelojDeTurno({ limitMs: params.limitMs });
  const seen: unknown[] = [];
  let error: unknown = null;
  try {
    for await (const chunk of streamConPlazo({
      stream: params.stream,
      reloj,
      threadId: "hilo-test",
      etiqueta: "test",
    })) {
      seen.push(chunk);
    }
  } catch (failure) {
    error = failure;
  }
  return { seen, error };
}

describe("tope de reloj: utilidades", () => {
  it("el plazo se puede inyectar y un valor imposible cae al del entorno", () => {
    expect(plazoDeTurno(1234)).toBe(1234);
    expect(plazoDeTurno(null)).toBeGreaterThan(0);
    expect(plazoDeTurno(0)).toBe(plazoDeTurno(null));
    expect(plazoDeTurno(-5)).toBe(plazoDeTurno(null));
    expect(plazoDeTurno(Number.NaN)).toBe(plazoDeTurno(null));
  });

  it("redacta duraciones legibles", () => {
    expect(duracionLegible(300_000)).toBe("5 min");
    expect(duracionLegible(90_000)).toBe("1.5 min");
    expect(duracionLegible(45_000)).toBe("45 s");
  });

  it("el cierre nombra el marcador, el plazo y repite la última respuesta", () => {
    const text = mensajeDeCierrePorTiempo(300_000, "estaba mirando la consola");
    expect(text).toContain(MARCA_TURNO_SIN_TIEMPO);
    expect(text).toContain("5 min");
    expect(text).toContain("estaba mirando la consola");
    expect(mensajeDeCierrePorTiempo(1000, "   ")).not.toContain("Última respuesta");
  });

  it("el error lleva la marca que el router ya traduce y NO la frase que lo machaca", () => {
    const error = new TurnoSinTiempoError(300_000);
    expect(error).toBeInstanceOf(Error);
    expect((error as unknown as { lc_error_code: string }).lc_error_code).toBe(
      LC_ERROR_CODE_PLAZO_CUMPLIDO,
    );

    expect(error.message.toLowerCase()).not.toContain("recursion limit");
  });

  it("chunkDeStream normaliza las tres formas del stream del router", () => {
    const ai = new AIMessage({ content: "hola" });
    expect(chunkDeStream(ai)).toBe(ai);
    expect(chunkDeStream([ai, { tags: [] }])).toBe(ai);
    expect(chunkDeStream([["tools", "ns"], [ai, { tags: [] }]])).toBe(ai);
    expect(chunkDeStream(["sin-mensaje", { meta: 1 }])).toBe("sin-mensaje");
  });
});

describe("tope de reloj: corte del turno", () => {
  it("corta el stream al cumplirse el plazo y emite el cierre", async () => {
    const { seen, error } = await recorrerHastaElCut({
      stream: streamSlow(50, 40),
      limitMs: 60,
    });

    expect(error).toBeInstanceOf(TurnoSinTiempoError);

    const ai = seen
      .map((chunk) => chunkDeStream(chunk))
      .filter((chunk) => chunk?.getType?.() === "ai") as AIMessage[];

    expect(ai.length).toBeLessThan(50);

    expect(String(ai[ai.length - 1].content)).toContain(MARCA_TURNO_SIN_TIEMPO);

    expect(String(ai[0].content)).toBe("paso 0");
  }, 20000);

  it("el router traduce el corte como presupuesto agotado con NUESTRO mensaje", async () => {
    const { error } = await recorrerHastaElCut({
      stream: streamSlow(50, 40),
      limitMs: 60,
    });

    expect(error).toBeInstanceOf(TurnoSinTiempoError);


    expect(codigoDeErrorStream(error)).toBe("budget_exhausted");

    expect(mapLlmError((error as Error).message)).toBe((error as Error).message);
    expect(mapLlmError((error as Error).message)).toContain("límite de tiempo");

    const persistido = anexarAvisoPresupuesto(mensajeDeCierrePorTiempo(300_000));
    expect(contieneAvisoDeCorte(persistido)).toBe(true);
  }, 20000);

  it("no corta un stream que termina antes del plazo", async () => {
    const reloj = crearRelojDeTurno({ limitMs: 5000 });
    const seen: unknown[] = [];
    for await (const chunk of streamConPlazo({
      stream: streamSlow(2, 1),
      reloj,
      threadId: "hilo-ok",
      etiqueta: "test",
    })) {
      seen.push(chunk);
    }
    expect(seen.length).toBe(2);
    expect(reloj.excedido()).toBe(false);
  });

  it("el corte del cliente sigue siendo del cliente, no un corte por plazo", () => {
    const cliente = new AbortController();
    const reloj = crearRelojDeTurno({ limitMs: 60_000, signal: cliente.signal });


    expect(cliente.signal.aborted).toBe(false);

    cliente.abort();
    expect(reloj.signal.aborted).toBe(true);
    expect(cliente.signal.aborted).toBe(true);
    expect(reloj.excedido()).toBe(false);


    expect(codigoDeErrorStream(new Error("Abort"), cliente.signal)).toBe("cancelled");
  });
});

describe("tope de reloj: aviso cooperativo al modelo", () => {
  
  function invocarNucleo(configurable: unknown, systemMessage?: string) {
    const middleware = turnPlazoMiddleware();
    const wrap = (middleware as unknown as { wrapModelCall: Function }).wrapModelCall;
    const seen: string[] = [];
    return wrap(
      {
        runtime: { configurable },
        systemMessage: systemMessage === undefined ? undefined : new SystemMessage(systemMessage),
      },
      async (request: { systemMessage?: { text?: string } }) => {
        seen.push(String(request.systemMessage?.text ?? ""));
        return "pase";
      },
    ).then(() => seen);
  }

  it("sin plazo en el configurable no inyecta nada", async () => {
    expect(await invocarNucleo({})).toEqual([""]);
  });

  it("con el plazo vencido inyecta el aviso con el plazo legible", async () => {
    const seen = await invocarNucleo({
      turn_deadline_at: Date.now() - 1_000,
      turn_deadline_ms: 300_000,
    });
    expect(seen[0]).toContain(MARCA_AVISO_TIEMPO);
    expect(seen[0]).toContain("5 min");
  });

  it("no duplica el aviso si ya está en el system prompt", async () => {
    const yaWithNotice = `base\n\n${MARCA_AVISO_TIEMPO} algo`;
    const seen = await invocarNucleo(
      { turn_deadline_at: Date.now() - 1_000, turn_deadline_ms: 300_000 },
      yaWithNotice,
    );
    expect(seen).toEqual([yaWithNotice]);
  });

  it("con plazo por delante no toca la llamada", async () => {
    const seen = await invocarNucleo(
      { turn_deadline_at: Date.now() + 60_000, turn_deadline_ms: 300_000 },
      "system base",
    );
    expect(seen).toEqual(["system base"]);
  });
});

describe("tope de reloj: el plazo viaja en la config del grafo", () => {
  it("buildDeepConfig mete deadline_at y plazo_ms solo si se los pasan", () => {
    const base = { threadId: "t1", context: deepTurnContextSchema.parse({}) };
    expect(
      (buildDeepConfig(base).configurable as Record<string, unknown>).turn_deadline_at,
    ).toBeUndefined();

    expect(buildDeepConfig({ ...base, deadlineAt: 1_000_000, deadlineMs: 300_000 }).configurable).toMatchObject({
      thread_id: "t1",
      turn_deadline_at: 1_000_000,
      turn_deadline_ms: 300_000,
    });
  });

  it("el aviso llega al system prompt con el stack real y el plazo vencido", async () => {
    class ModelEspia extends BaseChatModel {
      readonly modelcalls: BaseMessage[][] = [];
      constructor() {
        super({});
      }
      override bindTools(): this {
        return this;
      }
      override _llmType(): string {
        return "espia";
      }
      override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
        this.modelcalls.push([...messages]);
        const message = new AIMessage({ content: `ronda ${this.modelcalls.length}` });
        return { generations: [{ text: "", message, generationInfo: {} } as ChatGeneration] };
      }
    }

    const ping = tool(async () => "pong", {
      name: "ping",
      description: "ping",
      schema: z.object({}),
    });

    const model = new ModelEspia();
    const agent = createAgent({
      model: model as never,
      tools: [ping],
      systemPrompt: "base",
      middleware: [turnPlazoMiddleware()],
    });

    const stream = await (
      agent as unknown as { stream(i: unknown, c: unknown): Promise<AsyncIterable<unknown>> }
    ).stream(
      { messages: [new HumanMessage("hola")] },
      {
        streamMode: "updates" as never,
        recursionLimit: 20,
        configurable: { turn_deadline_at: Date.now() - 1, turn_deadline_ms: 300_000 },
      },
    );
    for await (const _chunk of stream) {

    }

    expect(model.modelcalls.length).toBeGreaterThan(0);
    const system = String(
      model.modelcalls[0].find((mensaje) => mensaje.getType() === "system")?.text ?? "",
    );
    expect(system).toContain(MARCA_AVISO_TIEMPO);
  }, 30000);
});
