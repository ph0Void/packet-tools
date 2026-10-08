

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { type ChatGeneration, type ChatResult } from "@langchain/core/outputs";
import { buildAgentMiddleware } from "@/agent/AgentRuntime";
import { resetBudgetCounters } from "@/agent/deep/budgetMiddleware";
import { huellaDeTool, PREFIJO_REINTENTO_BLOQUEADO } from "@/agent/deep/retryGuardMiddleware";
import {
  duplicateGuardMiddleware,
  indicaFallo,
  mensajeDeLlamadaDuplicada,
  PREFIJO_LLAMADA_DUPLICADA,
  type ResultadoPrevio,
  ultimoResultadoPorHuella,
} from "@/agent/deep/duplicateGuardMiddleware";
import { clasificarToolMessage } from "@/agent/security/ToolErrorClassifier";
import { envConfig } from "@/config/EnvConfig";


const ejecuciones = { ping: 0, pong: 0 };

const ping = tool(
  async ({ n }: { n: number }) => {
    ejecuciones.ping += 1;
    return `pong:${n}`;
  },
  { name: "ping", description: "devuelve pong", schema: z.object({ n: z.number() }) },
);

const pong = tool(
  async ({ n }: { n: number }) => {
    ejecuciones.pong += 1;
    return `otro:${n}`;
  },
  { name: "pong", description: "otra tool", schema: z.object({ n: z.number() }) },
);


interface CallScript {
  name: string;
  args: Record<string, unknown>;
}


class ModelScript extends BaseChatModel {
  readonly modelcalls: BaseMessage[][] = [];
  constructor(private readonly script: CallScript[]) {
    super({});
  }
  override bindTools(): this {
    return this;
  }
  override _llmType(): string {
    return "guion-duplicados";
  }
  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.modelcalls.push([...messages]);
    const numero = this.modelcalls.length;
    const call = this.script[numero - 1];
    const message = call
      ? new AIMessage({
          content: "",
          tool_calls: [
            { name: call.name, args: call.args, id: `call_${numero}`, type: "tool_call" },
          ],
        })
      : new AIMessage({ content: "fin del guion" });
    return { generations: [{ text: "", message, generationInfo: {} } as ChatGeneration] };
  }
}

interface AgentFake {
  invoke(
    input: unknown,
    config?: unknown,
  ): Promise<{ messages?: BaseMessage[] }>;
}

function createAgent(
  model: ModelScript,
  opciones: Parameters<typeof buildAgentMiddleware>[0] = {},
): AgentFake {
  return createAgent({
    model: model as never,
    tools: [ping, pong],
    systemPrompt: "eres un bot de redes",
    middleware: buildAgentMiddleware({ withApproval: false, ...opciones }),
  }) as unknown as AgentFake;
}

async function run(
  model: ModelScript,
  opciones: Parameters<typeof buildAgentMiddleware>[0] = {},
): Promise<BaseMessage[]> {
  const agent = createAgent(model, opciones);
  const reply = await agent.invoke(
    { messages: [new HumanMessage("hola")] },
    { recursionLimit: envConfig.AGENT_RECURSION_LIMIT },
  );
  return reply.messages ?? [];
}


function blocks(messages: BaseMessage[]): ToolMessage[] {
  return messages.filter(
    (mensaje): mensaje is ToolMessage =>
      ToolMessage.isInstance(mensaje) &&
      typeof mensaje.content === "string" &&
      mensaje.content.startsWith(PREFIJO_LLAMADA_DUPLICADA),
  );
}

afterEach(() => {
  resetBudgetCounters();
  ejecuciones.ping = 0;
  ejecuciones.pong = 0;
});

describe("guarda de duplicados: repetición exacta con trabajo intercalado", () => {
  it("bloquea la segunda vez que se pide la misma tool con los mismos args", async () => {

    const model = new ModelScript([
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 2 } },
      { name: "ping", args: { n: 1 } },
    ]);

    const messages = await run(model, { toolCallLimit: 20, modelCallLimit: 8 });


    expect(ejecuciones.ping).toBe(2);


    const cuts = blocks(messages);
    expect(cuts.length).toBe(1);
    expect(cuts[0].status).toBe("error");
    expect(cuts[0].tool_call_id).toBe("call_3");
    expect(String(cuts[0].content)).toContain("'ping'");
    expect(String(cuts[0].content)).toContain("terminó bien");


    expect(
      messages.some(
        (mensaje) =>
          AIMessage.isInstance(mensaje) && String(mensaje.content).includes("fin del guion"),
      ),
    ).toBe(true);
  }, 60000);

  it("es idempotente: el tercer intento idéntico también se bloquea", async () => {
    const model = new ModelScript([
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 2 } },
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 3 } },
      { name: "ping", args: { n: 1 } },
    ]);

    const messages = await run(model, { toolCallLimit: 20, modelCallLimit: 8 });

    expect(ejecuciones.ping).toBe(3);

    const cuts = blocks(messages);
    expect(cuts.map((mensaje) => mensaje.tool_call_id)).toEqual(["call_3", "call_5"]);
    expect(cuts.every((mensaje) => mensaje.status === "error")).toBe(true);
  }, 60000);

  it("deja pasar llamadas con argumentos distintos y de otra tool", async () => {
    const model = new ModelScript([
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 2 } },
      { name: "ping", args: { n: 3 } },

      { name: "pong", args: { n: 1 } },
      { name: "pong", args: { n: 2 } },
    ]);

    const messages = await run(model, { toolCallLimit: 20, modelCallLimit: 8 });

    expect(ejecuciones.ping).toBe(3);
    expect(ejecuciones.pong).toBe(2);
    expect(blocks(messages)).toHaveLength(0);
  }, 60000);

  it("no rompe el flujo normal: una sola llamada se ejecuta y devuelve su resultado", async () => {
    const model = new ModelScript([{ name: "ping", args: { n: 7 } }]);

    const messages = await run(model, { toolCallLimit: 20, modelCallLimit: 6 });

    expect(ejecuciones.ping).toBe(1);
    const result = messages.find(
      (mensaje): mensaje is ToolMessage =>
        ToolMessage.isInstance(mensaje) && mensaje.tool_call_id === "call_1",
    );
    expect(result).toBeDefined();
    expect(String(result?.content)).toBe("pong:7");

    expect(result?.status).not.toBe("error");
    expect(blocks(messages)).toHaveLength(0);
  }, 60000);

  it("con el stack completo, releer con los MISMOS args también se corta (política nueva)", async () => {

    const model = new ModelScript([
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 2 } },
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 3 } },
    ]);

    const messages = await run(model, { toolCallLimit: 20, modelCallLimit: 8 });

    expect(ejecuciones.ping).toBe(3);
    expect(blocks(messages).map((mensaje) => mensaje.tool_call_id)).toEqual(["call_3"]);
  }, 60000);

  it("con la guarda apagada se repite la tool (opt-out explícito)", async () => {
    const model = new ModelScript([
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 2 } },
      { name: "ping", args: { n: 1 } },
    ]);

    const messages = await run(model, {
      toolCallLimit: 20,
      modelCallLimit: 8,
      duplicateToolGuard: false,
    });

    expect(ejecuciones.ping).toBe(3);
    expect(blocks(messages)).toHaveLength(0);
  }, 60000);

  it("un resultado previo FALLIDO no se bloquea aquí (lo decide retryGuardMiddleware)", async () => {

    const scripts: CallScript[] = [
      { name: "ping", args: { n: 1 } },
      { name: "ping", args: { n: 2 } },
      { name: "ping", args: { n: 1 } },
    ];

    const runWithFailure = async (failure: string) => {
      ejecuciones.ping = 0;
      const pingThatFailure = tool(
        async ({ n }: { n: number }) => {
          ejecuciones.ping += 1;
          return ejecuciones.ping === 1 ? failure : `pong:${n}`;
        },
        { name: "ping", description: "falla la primera vez", schema: z.object({ n: z.number() }) },
      );
      const model = new ModelScript(scripts);
      const agent = createAgent({
        model: model as never,
        tools: [pingThatFailure],
        systemPrompt: "eres un bot de redes",
        middleware: buildAgentMiddleware({
          withApproval: false,
          toolCallLimit: 20,
          modelCallLimit: 8,
        }),
      }) as unknown as AgentFake;
      const reply = await agent.invoke(
        { messages: [new HumanMessage("hola")] },
        { recursionLimit: envConfig.AGENT_RECURSION_LIMIT },
      );
      return reply.messages ?? [];
    };

    const transitorio = await runWithFailure("ETIMEDOUT: la operación agotó su tiempo");
    expect(ejecuciones.ping).toBe(3);
    expect(blocks(transitorio)).toHaveLength(0);

    const final = await runWithFailure("% Invalid input detected at '^' marker.");
    expect(blocks(final)).toHaveLength(0);
    expect(
      final.some(
        (mensaje) =>
          ToolMessage.isInstance(mensaje) &&
          typeof mensaje.content === "string" &&
          mensaje.content.startsWith(PREFIJO_REINTENTO_BLOQUEADO),
      ),
    ).toBe(true);
  }, 60000);
});

describe("indicatesFallo decide por el VALOR del payload, no por el nombre del campo", () => {


  const payloadOfSendCommand = (extra: Record<string, unknown>): string =>
    JSON.stringify({
      sessionId: "socket-eval",
      command: "show version",
      executed: ["show version"],
      removed: [],
      output: "Cisco IOS XE Software, Version 16.12.4\nR1 uptime is 4 days",
      prompt: "R1# ",
      endReason: "idle",
      timedOut: false,
      elapsedMs: 42,
      paged: false,
      pages: 0,
      pagerVariant: null,
      truncated: true,
      reasonCut: null,
      wake: null,
      success: true,
      removedReason: null,
      ...extra,
    });

  const prev = (content: string, status: string | null = null): ResultadoPrevio => ({
    content,
    status,
    toolCallId: "cmd-1",
  });

  it("`timedOut: false` NO es un fallo: el `send_command` correcto se puede cortar", () => {

    const content = payloadOfSendCommand({});
    expect(indicaFallo(prev(content), "send_command")).toBe(false);
    expect(clasificarToolMessage({ content: content, status: "success" }).clase).toBe(
      "unknown",
    );

    expect(content).toContain('"timedOut":false');
  });

  it("`timedOut: true` SÍ es un fallo (y se clasifica como transitorio)", () => {

    const content = payloadOfSendCommand({ timedOut: true });
    expect(indicaFallo(prev(content), "send_command")).toBe(true);
    expect(clasificarToolMessage({ content: content, status: "success" }).clase).toBe(
      "transient",
    );
  });

  it("un error textual del CLI SÍ es un fallo (y no lo tapa el campo `timedOut`)", () => {
    const invalido = payloadOfSendCommand({
      output: "% Invalid input detected at '^' marker.\n% Unknown command",
    });
    expect(indicaFallo(prev(invalido), "send_command")).toBe(true);
    expect(clasificarToolMessage({ content: invalido, status: "success" }).clase).toBe(
      "definitive",
    );

    expect(indicaFallo(prev(invalido, "error"), "send_command")).toBe(true);
  });

  it("`success: false` (sin salida) y los bloqueos del sistema siguen siendo fallos", () => {
    const withoutOutput = payloadOfSendCommand({
      output: "",
      success: false,
      code: "NO_OUTPUT",
      message: "El comando se envió a la consola pero no volvió ninguna salida en 15000 ms.",
    });
    expect(indicaFallo(prev(withoutOutput), "send_command")).toBe(true);

    const withoutMockConsole = JSON.stringify({
      success: false,
      message: "No hay ninguna consola conectada.",
    });
    expect(indicaFallo(prev(withoutMockConsole), "send_command")).toBe(true);

    const bloqueado = "[APROBACION_RECHAZADA] El usuario rechazó la ejecución.";
    expect(indicaFallo(prev(bloqueado, "error"), "send_command")).toBe(true);
  });

  it("con el payload real, la repetición exacta de `send_command` SÍ se corta", async () => {

    const middleware = duplicateGuardMiddleware();
    const nucleo = (middleware as unknown as { wrapToolCall: Function }).wrapToolCall;
    const run = vi.fn(async () =>
      new ToolMessage({ content: "ejecutada", tool_call_id: "c2", name: "send_command" }),
    );

    const history = [
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "send_command", args: { command: "show version" }, id: "c1", type: "tool_call" },
        ],
      }),
      new ToolMessage({
        content: payloadOfSendCommand({}),
        tool_call_id: "c1",
        name: "send_command",
      }),
    ];

    const result = await nucleo(
      {
        toolCall: {
          name: "send_command",
          args: { command: "show version" },
          id: "c2",
        },
        state: { messages: history },
      },
      run,
    );

    expect(run).not.toHaveBeenCalled();
    expect(String((result as ToolMessage).content).startsWith(PREFIJO_LLAMADA_DUPLICADA)).toBe(
      true,
    );
  });

  it("y NO se corta si el resultado anterior fue un timeout de verdad", async () => {
    const middleware = duplicateGuardMiddleware();
    const nucleo = (middleware as unknown as { wrapToolCall: Function }).wrapToolCall;
    const run = vi.fn(async () =>
      new ToolMessage({ content: "ejecutada", tool_call_id: "c2", name: "send_command" }),
    );
    const history = [
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "send_command", args: { command: "show version" }, id: "c1", type: "tool_call" },
        ],
      }),
      new ToolMessage({
        content: payloadOfSendCommand({ timedOut: true }),
        tool_call_id: "c1",
        name: "send_command",
      }),
    ];
    await nucleo(
      {
        toolCall: { name: "send_command", args: { command: "show version" }, id: "c2" },
        state: { messages: history },
      },
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("guarda de duplicados: piezas puras", () => {
  it("la huella ignora el orden de las claves y distingue los valores", () => {

    expect(huellaDeTool("a", { x: 1, y: 2 })).toBe(huellaDeTool("a", { y: 2, x: 1 }));
    expect(huellaDeTool("a", { x: 1 })).not.toBe(huellaDeTool("a", { x: 2 }));
    expect(huellaDeTool("a", { x: 1 })).not.toBe(huellaDeTool("b", { x: 1 }));
  });

  it("ultimoResultadoPorHuella devuelve el resultado MÁS RECIENTE de cada huella", () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: "",
        tool_calls: [{ name: "send_command", args: { command: "sh" }, id: "c1" }],
      }),
      new ToolMessage({ content: "primer resultado", tool_call_id: "c1", name: "send_command" }),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "send_command", args: { command: "sh" }, id: "c2" }],
      }),
      new ToolMessage({ content: "segundo resultado", tool_call_id: "c2", name: "send_command" }),
    ];

    const previos = ultimoResultadoPorHuella(messages);
    expect(previos.size).toBe(1);
    const prev = previos.get('send_command::{"command":"sh"}');
    expect(prev?.contenido).toBe("segundo resultado");
    expect(prev?.toolCallId).toBe("c2");
  });

  it("el mensaje de bloqueo dice qué hacer en lugar de repetir", () => {
    const text = mensajeDeLlamadaDuplicada("send_command", "send_command::{}");
    expect(text.startsWith(PREFIJO_LLAMADA_DUPLICADA)).toBe(true);
    expect(text).toContain("send_command::{}");
    expect(text).toContain("cambia los argumentos");
  });

  it("la guarda apagada deja pasar todo", async () => {
    const middleware = duplicateGuardMiddleware({ enabled: false });
    const nucleo = (middleware as unknown as { wrapToolCall: Function }).wrapToolCall;
    const result = await nucleo(
      {
        toolCall: { name: "ping", args: { n: 1 }, id: "c1" },
        state: {
          messages: [
            new AIMessage({
              content: "",
              tool_calls: [{ name: "ping", args: { n: 1 }, id: "c0" }],
            }),
            new ToolMessage({ content: "pong:1", tool_call_id: "c0", name: "ping" }),
          ],
        },
      },
      async () => new ToolMessage({ content: "ejecutada", tool_call_id: "c1", name: "ping" }),
    );
    expect(String((result as ToolMessage).content)).toBe("ejecutada");
  });
});
