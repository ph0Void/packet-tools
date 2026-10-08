

import { afterEach, describe, expect, it } from "vitest";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { type ChatGeneration, type ChatResult } from "@langchain/core/outputs";
import {
  NOTA_CACHE,
  readCacheMiddleware,
  resetReadCache,
} from "@/agent/tools/readCacheMiddleware";
import { buildAgentMiddleware } from "@/agent/AgentRuntime";
import {
  PROMT_SEED,
  PROMT_SEED_ANTERIOR,
  esSeedAnteriorSinPersonalizar,
} from "@/seed/promtSeed";
import { CISCO_PACKET_TRACER_PROMPT } from "@/agent/ciscoPacketTracer/Promt";

type Middleware = ReturnType<typeof readCacheMiddleware>;


type Handler = (request: {
  toolCall: { name: string; args: Record<string, unknown>; id?: string };
}) => Promise<ToolMessage>;

function wrapOf(middleware: Middleware) {
  const hook = middleware.wrapToolCall as unknown as (
    request: unknown,
    handler: Handler,
  ) => Promise<ToolMessage>;
  return hook;
}

function prompt(
  threadId: string,
  name: string,
  args: Record<string, unknown>,
  id = "tc-1",
) {
  return {
    toolCall: { name: name, args, id, type: "tool_call" },
    runtime: { configurable: { thread_id: threadId } },
    tool: undefined,
    state: { messages: [] },
  };
}


function invocarCycleOfVida(
  hook: unknown,
  threadId: string,
): void {
  const fn =
    typeof hook === "function"
      ? hook
      : (hook as { hook: (s: unknown, r: unknown) => unknown }).hook;
  (fn as (state: unknown, runtime: unknown) => unknown)(
    {},
    { configurable: { thread_id: threadId } },
  );
}


function handlerCounter(conteos: Record<string, number>, status?: string): Handler {
  return async (request) => {
    const name = request.toolCall.name;
    conteos[name] = (conteos[name] ?? 0) + 1;
    return new ToolMessage({
      tool_call_id: request.toolCall.id ?? "",
      name: name,
      status: status as "error" | undefined,
      content: JSON.stringify({ tool: name, ejecucion: conteos[name] }),
    });
  };
}

afterEach(() => {
  resetReadCache();
});

describe("caché de lecturas por turno", () => {
  it("sirve la nota de caché en el segundo acierto sin ejecutar la tool", async () => {
    const middleware = readCacheMiddleware();
    invocarCycleOfVida(middleware.beforeAgent, "hilo-1");
    const wrap = wrapOf(middleware);
    const conteos: Record<string, number> = {};
    const handler = handlerCounter(conteos);

    const first = await wrap(prompt("hilo-1", "getNetwork", {}), handler);
    const second = await wrap(prompt("hilo-1", "getNetwork", {}), handler);

    
    expect(conteos.getNetwork).toBe(1);
    
    expect(String(first.content)).not.toContain(NOTA_CACHE);
    expect(String(first.content)).toContain('"ejecucion":1');
    
    expect(String(second.content)).toBe(NOTA_CACHE + String(first.content));
  });

  it("distingue argumentos distintos de la misma tool", async () => {
    const middleware = readCacheMiddleware();
    invocarCycleOfVida(middleware.beforeAgent, "hilo-args");
    const wrap = wrapOf(middleware);
    const conteos: Record<string, number> = {};
    const handler = handlerCounter(conteos);

    await wrap(prompt("hilo-args", "getDeviceInfo", { deviceName: "R1" }), handler);
    await wrap(prompt("hilo-args", "getDeviceInfo", { deviceName: "R2" }), handler);
    await wrap(prompt("hilo-args", "getDeviceInfo", { deviceName: "R1" }), handler);

    
    expect(conteos.getDeviceInfo).toBe(2);
  });

  it("una mutación vacía la caché del turno: la lectura posterior se reejecuta", async () => {
    const middleware = readCacheMiddleware();
    invocarCycleOfVida(middleware.beforeAgent, "hilo-2");
    const wrap = wrapOf(middleware);
    const conteos: Record<string, number> = {};
    const handler = handlerCounter(conteos);

    await wrap(prompt("hilo-2", "getNetwork", {}), handler);
    
    await wrap(prompt("hilo-2", "addDevice", { deviceName: "PC1" }), handler);
    const afterOfMutar = await wrap(prompt("hilo-2", "getNetwork", {}), handler);

    expect(conteos.getNetwork).toBe(2);
    expect(conteos.addDevice).toBe(1);
    
    expect(String(afterOfMutar.content)).not.toContain(NOTA_CACHE);
    expect(String(afterOfMutar.content)).toContain('"ejecucion":2');
  });

  it("dos hilos distintos no comparten la caché", async () => {
    const middleware = readCacheMiddleware();
    invocarCycleOfVida(middleware.beforeAgent, "hilo-a");
    invocarCycleOfVida(middleware.beforeAgent, "hilo-b");
    const wrap = wrapOf(middleware);
    const conteos: Record<string, number> = {};
    const handler = handlerCounter(conteos);

    await wrap(prompt("hilo-a", "getNetwork", {}), handler);
    
    const enHiloB = await wrap(prompt("hilo-b", "getNetwork", {}), handler);
    expect(conteos.getNetwork).toBe(2);
    expect(String(enHiloB.content)).not.toContain(NOTA_CACHE);

    
    const otherTimeEnA = await wrap(prompt("hilo-a", "getNetwork", {}), handler);
    expect(conteos.getNetwork).toBe(2);
    expect(String(otherTimeEnA.content)).toContain(NOTA_CACHE);
  });

  it("afterAgent libera la caché: el estado dura un turno", async () => {
    const middleware = readCacheMiddleware();
    invocarCycleOfVida(middleware.beforeAgent, "hilo-3");
    const wrap = wrapOf(middleware);
    const conteos: Record<string, number> = {};
    const handler = handlerCounter(conteos);

    await wrap(prompt("hilo-3", "getNetwork", {}), handler);
    invocarCycleOfVida(middleware.afterAgent, "hilo-3");
    invocarCycleOfVida(middleware.beforeAgent, "hilo-3");
    await wrap(prompt("hilo-3", "getNetwork", {}), handler);

    expect(conteos.getNetwork).toBe(2);
  });

  it("no cachea resultados con status de error", async () => {
    const middleware = readCacheMiddleware();
    invocarCycleOfVida(middleware.beforeAgent, "hilo-4");
    const wrap = wrapOf(middleware);
    const conteos: Record<string, number> = {};
    const handler = handlerCounter(conteos, "error");

    await wrap(prompt("hilo-4", "getCommandLog", { limit: 10 }), handler);
    await wrap(prompt("hilo-4", "getCommandLog", { limit: 10 }), handler);

    expect(conteos.getCommandLog).toBe(2);
  });
});

describe("registro del middleware en el stack", () => {
  it("solo se monta con readCache: true", () => {
    const withoutCache = buildAgentMiddleware({ withApproval: false });
    const withCache = buildAgentMiddleware({ withApproval: false, readCache: true });

    expect(withoutCache.some((m) => m.name === "ReadCache")).toBe(false);
    expect(withCache.some((m) => m.name === "ReadCache")).toBe(true);
    
    const names = withCache.map((m) => m.name);
    expect(names.indexOf("ReadCache")).toBe(
      names.indexOf("ToolOutputBudget") + 1,
    );
  });
});


class ModelReads extends BaseChatModel {
  constructor() {
    super({});
  }

  override bindTools(): this {
    return this;
  }

  override _llmType(): string {
    return "lecturas";
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const numero = messages.filter((m) => m.getType() === "ai").length + 1;
    const toolCalls =
      numero === 1
        ? [{ name: "getDeviceInfo", args: { deviceName: "R1" }, id: "c1", type: "tool_call" as const }]
        : numero === 2
          ? [{ name: "getNetwork", args: {}, id: "c2", type: "tool_call" as const }]
          : numero === 3
            ? [{ name: "getDeviceInfo", args: { deviceName: "R1" }, id: "c3", type: "tool_call" as const }]
            : [];
    const message = new AIMessage(
      toolCalls.length
        ? { content: "", tool_calls: toolCalls }
        : { content: "listo" },
    );
    const generation: ChatGeneration = {
      text: typeof message.content === "string" ? message.content : "",
      message,
      generationInfo: {},
    };
    return { generations: [generation] };
  }
}

let conteoDeviceInfo = 0;
let conteoNetwork = 0;

const getDeviceInfoFake = tool(
  async ({ deviceName }: { deviceName: string }) => {
    conteoDeviceInfo += 1;
    return JSON.stringify({ deviceName, interfaces: ["GigabitEthernet0/0"] });
  },
  {
    name: "getDeviceInfo",
    description: "detalles de un dispositivo",
    schema: z.object({ deviceName: z.string() }),
  },
);

const getNetworkFake = tool(
  async () => {
    conteoNetwork += 1;
    return JSON.stringify({ devices: ["R1"] });
  },
  {
    name: "getNetwork",
    description: "snapshot de la red",
    schema: z.object({}),
  },
);

interface StreamAgent {
  invoke(input: unknown, config?: unknown): Promise<{ messages?: BaseMessage[] }>;
}

describe("caché de lecturas integrada en el agente", () => {
  it("la tercera llamada (misma que la primera) sale de caché", async () => {
    conteoDeviceInfo = 0;
    conteoNetwork = 0;

    const agent = createAgent({
      model: new ModelReads() as never,
      tools: [getDeviceInfoFake, getNetworkFake],
      systemPrompt: "eres un bot de redes",
      middleware: buildAgentMiddleware({ withApproval: false, readCache: true }),
    }) as unknown as StreamAgent;

    const reply = await agent.invoke(
      { messages: [{ role: "human", content: "revisa R1" }] },
      { recursionLimit: 30, configurable: { thread_id: "hilo-agente" } },
    );
    const messages = reply.messages ?? [];

    
    expect(conteoDeviceInfo).toBe(1);
    expect(conteoNetwork).toBe(1);

    const nota = messages.find(
      (m) =>
        ToolMessage.isInstance(m) &&
        typeof m.content === "string" &&
        m.content.startsWith(NOTA_CACHE),
    );
    expect(nota).toBeDefined();

    
    const close = messages.find(
      (m) =>
        AIMessage.isInstance(m) &&
        typeof m.content === "string" &&
        m.content === "listo",
    );
    expect(close).toBeDefined();
  }, 30000);
});

describe("prompt global (Fase 4)", () => {
  it("solo migra el seed antiguo sin personalizar y es idempotente", () => {
    
    expect(esSeedAnteriorSinPersonalizar(PROMT_SEED_ANTERIOR)).toBe(true);
    
    expect(esSeedAnteriorSinPersonalizar(`\n  ${PROMT_SEED_ANTERIOR} \n`)).toBe(
      true,
    );

    expect(esSeedAnteriorSinPersonalizar(PROMT_SEED)).toBe(false);
    expect(esSeedAnteriorSinPersonalizar("Eres un asistente personalizado.")).toBe(
      false,
    );

    expect(esSeedAnteriorSinPersonalizar(null)).toBe(false);
    expect(esSeedAnteriorSinPersonalizar(undefined)).toBe(false);
    expect(esSeedAnteriorSinPersonalizar("   ")).toBe(false);
  });

  it("el prompt vigente delega con task y ya no enruta con tools transfer_to_*", () => {

    expect(PROMT_SEED).not.toContain("→transfer_to");
    expect(PROMT_SEED).toContain("ya NO existen");
    expect(PROMT_SEED).toContain("task");
    expect(PROMT_SEED).toContain("subagent_type");
    for (const subagent of [
      "packet_tracer_specialist",
      "gns3_specialist",
      "ssh_specialist",
      "telnet_specialist",
      "serial_specialist",
      "knowledge_specialist",
      "system_admin_specialist",
    ]) {
      expect(PROMT_SEED).toContain(subagent);
    }
    expect(PROMT_SEED).not.toContain("Máximo 10 delegaciones");

    expect(PROMT_SEED_ANTERIOR).toContain("transfer_to_");

    expect(PROMT_SEED).toContain("POR FASE");
    expect(PROMT_SEED).toContain("UNA sola verificación final");
  });

  it("el prompt de Packet Tracer pide verificación por fases y no releer sin mutar", () => {
    expect(CISCO_PACKET_TRACER_PROMPT).toContain("Verify per PHASE");
    expect(CISCO_PACKET_TRACER_PROMPT).toContain(
      "Do not re-request getNetwork/getDeviceInfo",
    );
  });
});
