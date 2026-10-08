

import { afterEach, describe, expect, it } from "vitest";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { type ChatGeneration, type ChatResult } from "@langchain/core/outputs";
import { buildAgentMiddleware } from "@/agent/AgentRuntime";
import { resetBudgetCounters } from "@/agent/deep/budgetMiddleware";
import { envConfig } from "@/config/EnvConfig";

const MARKER_NOTICE = "[PRESUPUESTO_PASOS]";
const MARKER_FORCE = "[PRESUPUESTO_URGENTE]";


class ModelBudget extends BaseChatModel {
  
  readonly modelcalls: BaseMessage[][] = [];
  
  constructor(private readonly argsFijos = false) {
    super({});
  }

  override bindTools(): this {
    return this;
  }

  override _llmType(): string {
    return "presupuesto";
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.modelcalls.push([...messages]);
    const numero = this.modelcalls.length;
    const args = this.argsFijos ? { n: 1 } : { n: numero };
    const text = `paso ${numero} en curso`;
    const message = new AIMessage({
      content: text,
      tool_calls: [{ name: "ping", args, id: `call_${numero}`, type: "tool_call" }],
    });
    const generation: ChatGeneration = { text: text, message, generationInfo: {} };
    return { generations: [generation] };
  }
}

let ejecucionesPing = 0;

const ping = tool(
  async ({ n }: { n: number }) => {
    ejecucionesPing += 1;
    return `pong:${n}`;
  },
  {
    name: "ping",
    description: "devuelve pong",
    schema: z.object({ n: z.number() }),
  },
);



class ModelSequence extends BaseChatModel {
  readonly modelcalls: BaseMessage[][] = [];
  constructor(private readonly sequence: { n: number }[]) {
    super({});
  }

  override bindTools(): this {
    return this;
  }

  override _llmType(): string {
    return "secuencia";
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.modelcalls.push([...messages]);
    const numero = this.modelcalls.length;
    const args = this.secuencia[(numero - 1) % this.secuencia.length];
    const text = `paso ${numero} en curso`;
    const message = new AIMessage({
      content: text,
      tool_calls: [{ name: "ping", args, id: `call_${numero}`, type: "tool_call" }],
    });
    const generation: ChatGeneration = { text: text, message, generationInfo: {} };
    return { generations: [generation] };
  }
}

interface StreamAgent {
  stream(input: unknown, config: unknown): Promise<AsyncIterable<unknown>>;
  invoke(input: unknown, config?: unknown): Promise<{ messages?: BaseMessage[] }>;
}

function createAgent(
  middleware: ReturnType<typeof buildAgentMiddleware>,
  model: ModelBudget,
) {
  return createAgent({
    model: model as never,
    tools: [ping],
    systemPrompt: "eres un bot de redes",
    middleware,
  }) as unknown as StreamAgent;
}


async function recorrerStream(agent: StreamAgent, recursionLimit: number) {
  const chunks: Array<Record<string, unknown>> = [];
  const stream = await agent.stream(
    { messages: [{ role: "human", content: "hola" }] },
    { recursionLimit, streamMode: "updates" },
  );
  for await (const chunk of stream) chunks.push(chunk as Record<string, unknown>);
  return chunks;
}


function messageOfClose(chunk: Record<string, unknown>): BaseMessage | null {
  for (const value of Object.values(chunk)) {
    const messages = (value as { messages?: BaseMessage[] } | null)?.messages;
    if (!Array.isArray(messages)) continue;
    const encontrado = messages.find(
      (m) =>
        AIMessage.isInstance(m) &&
        typeof m.content === "string" &&
        m.content.includes("PRESUPUESTO AGOTADO"),
    );
    if (encontrado) return encontrado;
  }
  return null;
}


function systemPromptOf(model: ModelBudget, index: number): string {
  const messages = model.modelcalls[index] ?? [];
  const system = messages.find((m) => m.getType() === "system");
  return system?.text ?? "";
}

function times(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

afterEach(() => {
  resetBudgetCounters();
  ejecucionesPing = 0;
});

describe("presupuesto de pasos: derivación de límites", () => {
  it("nunca invierte los límites respecto al recursionLimit del grafo", () => {
    const pasos = envConfig.AGENT_STEPS_PER_ROUND;
    expect(pasos).toBeGreaterThan(0);
    expect(envConfig.AGENT_SPECIALIST_MODEL_LIMIT).toBeLessThan(
      envConfig.AGENT_RECURSION_LIMIT,
    );
    expect(envConfig.AGENT_SPECIALIST_TOOL_LIMIT).toBe(
      envConfig.AGENT_SPECIALIST_MODEL_LIMIT * 2,
    );
    expect(envConfig.AGENT_BUDGET_NUDGE_RATIO).toBeLessThan(
      envConfig.AGENT_BUDGET_FORCE_RATIO,
    );
    expect(envConfig.AGENT_SUPERVISOR_RECURSION_LIMIT).toBe(
      envConfig.AGENT_RECURSION_LIMIT * 4,
    );

    const superstepsCut = 1 + envConfig.AGENT_SPECIALIST_MODEL_LIMIT * pasos + 1;
    expect(superstepsCut).toBeLessThanOrEqual(envConfig.AGENT_RECURSION_LIMIT);
  });

  it("resetBudgetCounters vacía sin errores con y sin thread", () => {
    expect(() => resetBudgetCounters("turno-x")).not.toThrow();
    expect(() => resetBudgetCounters()).not.toThrow();
  });
});

describe("presupuesto de pasos: corte y avisos", () => {
  it("termina con respuesta final (nunca GraphRecursionError) tras 96 llamadas", async () => {
    const model = new ModelBudget();
    const agent = createAgent(buildAgentMiddleware({ withApproval: false }), model);

    const chunks = await recorrerStream(agent, envConfig.AGENT_RECURSION_LIMIT);


    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(envConfig.AGENT_RECURSION_LIMIT);


    expect(model.modelcalls.length).toBe(envConfig.AGENT_SPECIALIST_MODEL_LIMIT);


    const close = chunks
      .map(messageOfClose)
      .find((mensaje) => mensaje !== null) as AIMessage | null;
    expect(close).not.toBeNull();
    const content = String(close?.content);
    expect(content).toContain(`Límite de ${envConfig.AGENT_SPECIALIST_MODEL_LIMIT} pasos`);
    expect(content).toContain(`paso ${envConfig.AGENT_SPECIALIST_MODEL_LIMIT} en curso`);
    expect(content).toContain("lista numerada");


    expect(ejecucionesPing).toBe(envConfig.AGENT_SPECIALIST_MODEL_LIMIT);
  }, 60000);

  it("inyecta el aviso del 70 % y el forzoso del 95 % una sola vez cada uno", async () => {
    const model = new ModelBudget();
    const agent = createAgent(buildAgentMiddleware({ withApproval: false }), model);

    await recorrerStream(agent, envConfig.AGENT_RECURSION_LIMIT);

    const limit = envConfig.AGENT_SPECIALIST_MODEL_LIMIT;
    const thresholdNotice = Math.floor(envConfig.AGENT_BUDGET_NUDGE_RATIO * limit);
    const thresholdForce = Math.floor(envConfig.AGENT_BUDGET_FORCE_RATIO * limit);
    const first = systemPromptOf(model, thresholdNotice - 1);
    const previous = systemPromptOf(model, thresholdNotice - 2);
    const firstForce = systemPromptOf(model, thresholdForce - 1);
    const previousForce = systemPromptOf(model, thresholdForce - 2);
    const last = systemPromptOf(model, model.modelcalls.length - 1);


    expect(previous).not.toContain(MARKER_NOTICE);
    expect(times(first, MARKER_NOTICE)).toBe(1);
    expect(times(last, MARKER_NOTICE)).toBe(1);


    expect(previousForce).not.toContain(MARKER_FORCE);
    expect(times(firstForce, MARKER_FORCE)).toBe(1);
    expect(times(last, MARKER_FORCE)).toBe(1);
  }, 60000);
});

describe("presupuesto de pasos: bucles de herramienta", () => {
  it("bloquea la llamada idéntica consecutiva sin ejecutarla dos veces", async () => {
    const model = new ModelBudget(true);
    const agent = createAgent(
      buildAgentMiddleware({
        withApproval: false,
        toolCallLimit: 10,
        modelCallLimit: 5,
      }),
      model,
    );

    const reply = await agent.invoke(
      { messages: [{ role: "human", content: "hola" }] },
      { recursionLimit: envConfig.AGENT_RECURSION_LIMIT },
    );
    const messages = reply.messages ?? [];


    expect(ejecucionesPing).toBe(1);
    expect(model.modelcalls.length).toBe(5);


    const block = messages.find(
      (m): m is ToolMessage =>
        ToolMessage.isInstance(m) &&
        typeof m.content === "string" &&
        m.content.includes("Llamada idéntica repetida"),
    );
    expect(block).toBeDefined();
    expect(block?.status).toBe("error");


    const close = messages.find(
      (m) =>
        AIMessage.isInstance(m) &&
        typeof m.content === "string" &&
        m.content.includes("PRESUPUESTO AGOTADO"),
    );
    expect(close).toBeDefined();
  }, 60000);

  it("bloquea el bucle alterno (A → B → A → B), que antes nunca se detectaba", async () => {

    const model = new ModelSequence([{ n: 1 }, { n: 2 }]);
    const agent = createAgent(
      buildAgentMiddleware({
        withApproval: false,
        toolCallLimit: 20,
        modelCallLimit: 6,
        duplicateToolGuard: false,
      }),
      model,
    );

    const reply = await agent.invoke(
      { messages: [{ role: "human", content: "hola" }] },
      { recursionLimit: envConfig.AGENT_RECURSION_LIMIT },
    );
    const messages = reply.messages ?? [];


    expect(model.modelcalls.length).toBe(6);
    expect(ejecucionesPing).toBe(3);

    const cut = messages.filter(
      (m): m is ToolMessage =>
        ToolMessage.isInstance(m) &&
        typeof m.content === "string" &&
        m.content.includes("Bucle de tool-calls detectado"),
    );
    expect(cut.length).toBeGreaterThanOrEqual(1);
    expect(cut.every((m) => m.status === "error")).toBe(true);


    expect(
      messages.some(
        (m) =>
          AIMessage.isInstance(m) &&
          typeof m.content === "string" &&
          m.content.includes("PRESUPUESTO AGOTADO"),
      ),
    ).toBe(true);
  }, 60000);

  it("no bloquea releer el mismo dato entre trabajo legítimo", async () => {

    const model = new ModelSequence([
      { n: 1 }, { n: 2 }, { n: 1 }, { n: 3 }, { n: 1 },
      { n: 4 }, { n: 1 }, { n: 5 }, { n: 1 }, { n: 6 },
    ]);
    const agent = createAgent(
      buildAgentMiddleware({
        withApproval: false,
        toolCallLimit: 20,
        modelCallLimit: 10,
        duplicateToolGuard: false,
      }),
      model,
    );

    const reply = await agent.invoke(
      { messages: [{ role: "human", content: "hola" }] },
      { recursionLimit: envConfig.AGENT_RECURSION_LIMIT },
    );
    const messages = reply.messages ?? [];


    expect(model.modelcalls.length).toBe(10);
    expect(ejecucionesPing).toBe(10);
    expect(
      messages.some(
        (m) =>
          ToolMessage.isInstance(m) &&
          typeof m.content === "string" &&
          (m.content.includes("Bucle de tool-calls detectado") ||
            m.content.includes("Llamada idéntica repetida")),
      ),
    ).toBe(false);
  }, 60000);
});
