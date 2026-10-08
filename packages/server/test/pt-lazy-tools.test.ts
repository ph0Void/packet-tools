

import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "langchain";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import {
  CISCO_PACKET_TRACER_TOOLS_ADMIN,
  CISCO_TOOLS_USER,
} from "@/agent/ciscoPacketTracer/Tool";
import {
  buildLazyToolLayer,
  capaDeToolsPerezosas,
  lazyToolsHabilitadas,
  LAZY_TOOLS_RULE,
  LOAD_TOOLS_NAME,
  nombresActivadosEn,
  PT_TOOLS_EAGER,
  registrarToolsActivadas,
  resetToolsActivadas,
  resolverTools,
  toolsActivadas,
  type ToolLike,
} from "@/agent/tools/lazyTools";
import { getToolPolicy } from "@/agent/security/ToolPolicy";
import { envConfig } from "@/config/EnvConfig";
import { buildAgentMiddleware } from "@/agent/AgentRuntime";
import { CISCO_PACKET_TRACER_PROMPT } from "@/agent/ciscoPacketTracer/Promt";


const RECORD_ADMIN = CISCO_PACKET_TRACER_TOOLS_ADMIN as unknown as ToolLike[];
const RECORD_USER = CISCO_TOOLS_USER as unknown as ToolLike[];

afterEach(() => {
  resetToolsActivadas();
});

describe("capa de tools perezosas: cobertura del registro real", () => {
  it("ADMIN: por defecto se ligan ≤8 tools y el resto queda bajo demanda", () => {
    const capa = buildLazyToolLayer(RECORD_ADMIN);
    expect(capa.eager.length).toBeGreaterThan(0);
    expect(capa.eager.length).toBeLessThanOrEqual(8);
    for (const name of PT_TOOLS_EAGER) {
      
      if (RECORD_ADMIN.some((t) => t.name === name)) {
        expect(capa.eager).toContain(name);
      }
    }
    expect(capa.declaradas.length).toBe(RECORD_ADMIN.length + 1);
    expect(capa.declaradas.map((t) => t.name)).toContain(LOAD_TOOLS_NAME);
  });

  it("ADMIN: TODA tool del registro es alcanzable (eager ∪ diferidas = registro)", () => {
    const capa = buildLazyToolLayer(RECORD_ADMIN);
    const alcanzables = new Set([...capa.eager, ...capa.diferidas]);
    const record = new Set(RECORD_ADMIN.map((t) => t.name));
    expect(record.size).toBeGreaterThan(30);
    for (const name of record) {
      expect(alcanzables.has(name)).toBe(true);
    }
    
    expect(alcanzables.size).toBe(record.size);
  });

  it("USER: el subconjunto eager es la interseccion con su registro (sin fantasmas)", () => {
    const capa = buildLazyToolLayer(RECORD_USER);
    const recorded = new Set(RECORD_USER.map((t) => t.name));
    for (const name of capa.eager) {
      expect(recorded.has(name)).toBe(true);
    }
    expect(new Set([...capa.eager, ...capa.diferidas]).size).toBe(recorded.size);
    expect(capa.eager.length).toBeLessThanOrEqual(8);
  });

  it("rollback trivial: con la flag apagada la capa es null (todo como antes)", () => {
    const capa = capaDeToolsPerezosas(RECORD_ADMIN, false);
    expect(capa).toBeNull();
    
    expect(capaDeToolsPerezosas(RECORD_ADMIN, true)).not.toBeNull();
  });

  it("el default de la flag es ON y se lee del envConfig", () => {
    expect(envConfig.AGENT_LAZY_TOOLS).toBe(true);
    expect(lazyToolsHabilitadas()).toBe(true);
  });

  it("el prompt del especialista explica la carga bajo demanda", () => {
    expect(LAZY_TOOLS_RULE).toContain(LOAD_TOOLS_NAME);
    expect(LAZY_TOOLS_RULE).toContain("BEFORE");
    
    
    expect(CISCO_PACKET_TRACER_PROMPT).not.toContain(LOAD_TOOLS_NAME);
  });

  it("load_tools entra por el ToolPolicy: readonly, sin aprobar y sin kind cli", () => {
    const policy = getToolPolicy(LOAD_TOOLS_NAME);
    expect(policy.access).toBe("readonly");
    expect(policy.autoApprove).toBeUndefined();
    expect(policy.kind).toBe("internal");
  });
});

describe("resolucion de tools bajo demanda", () => {
  it("busca por nombre exacto", () => {
    const encontrados = resolverTools(RECORD_ADMIN, { tools: ["addDevice"] });
    expect(encontrados.map((t) => t.name)).toEqual(["addDevice"]);
  });

  it("busca por palabras clave sobre nombre y descripcion", () => {
    const encontrados = resolverTools(RECORD_ADMIN, { query: "configure ios" });
    expect(encontrados.length).toBeGreaterThan(0);
    expect(encontrados.map((t) => t.name)).toContain("configureIosDevice");
  });

  it("nunca resuelve a si misma (load_tools no se carga a si misma)", () => {
    const encontrados = resolverTools(RECORD_ADMIN, { tools: [LOAD_TOOLS_NAME] });
    expect(encontrados).toEqual([]);
  });

  it("el estado de activacion es por hilo y se reinicia", () => {
    registrarToolsActivadas("hilo-a", ["addDevice"]);
    registrarToolsActivadas("hilo-a", ["addLink"]);
    registrarToolsActivadas("hilo-b", ["clearWorkspace"]);
    expect(toolsActivadas("hilo-a").sort()).toEqual(["addDevice", "addLink"]);
    expect(toolsActivadas("hilo-b")).toEqual(["clearWorkspace"]);
    resetToolsActivadas("hilo-a");
    expect(toolsActivadas("hilo-a")).toEqual([]);
    expect(toolsActivadas("hilo-b")).toEqual(["clearWorkspace"]);
  });

  it("lee los nombres activados de la respuesta de load_tools", () => {
    const content = JSON.stringify({ activated: ["addDevice"], tools: [] });
    expect(nombresActivadosEn(content)).toEqual(["addDevice"]);
    expect(nombresActivadosEn("no json")).toEqual([]);
    expect(nombresActivadosEn(JSON.stringify({}))).toEqual([]);
  });
});


class ModelLoad extends BaseChatModel {
  static ligadas: string[][] = [];
  private readonly script: Array<
    { tool?: { name: string; args: Record<string, unknown> } ; text?: string }
  >;
  private index = 0;

  constructor(script: ModelLoad["guion"]) {
    super({});
    this.script = script;
  }

  override _llmType(): string {
    return "carga";
  }

  override _combineLLMOutput(): never[] {
    return [] as never[];
  }

  override bindTools(tools: Array<{ name: string }>): this {
    ModelLoad.ligadas.push(tools.map((t) => t.name));
    return this;
  }

  override async _generate(): Promise<ChatResult> {
    const paso = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (paso.tool) {
      return {
        generations: [
          {
            text: "",
            message: new AIMessage({
              content: "",
              tool_calls: [
                { ...paso.tool, id: `c${this.index}`, type: "tool_call" as const },
              ],
            }),
            generationInfo: {},
          },
        ],
      };
    }
    return {
      generations: [
        {
          text: paso.text ?? "listo",
          message: new AIMessage(paso.text ?? "listo"),
          generationInfo: {},
        },
      ],
    };
  }
}

describe("integracion: el modelo solo ve ≤8 tools hasta que carga", () => {
  it("1a llamada ve el subconjunto eager; tras load_tools ve la tool cargada", async () => {
    resetToolsActivadas();
    ModelLoad.ligadas = [];
    const capa = buildLazyToolLayer(RECORD_ADMIN);
    const agent = createAgent({
      model: new ModelLoad([
        { tool: { name: LOAD_TOOLS_NAME, args: { query: "add device" } } },
        { tool: { name: "addDevice", args: { name: "R9", model: "Router" } } },
        { text: "hecho" },
      ]) as never,
      tools: capa.declaradas as never,
      systemPrompt: "pt",
      middleware: [
        ...buildAgentMiddleware({ withApproval: false }),
        capa.middleware,
      ],
    }) as unknown as {
      invoke(input: unknown, config?: unknown): Promise<{ messages: BaseMessage[] }>;
    };

    const reply = await agent.invoke(
      { messages: [{ role: "human", content: "crea R9" }] },
      { recursionLimit: 30, configurable: { thread_id: "lazy-1" } },
    );

    const first = ModelLoad.ligadas[0] ?? [];

    expect(first.length).toBeLessThanOrEqual(9);
    expect(first).toContain(LOAD_TOOLS_NAME);
    expect(first).toContain("getNetwork");
    expect(first).not.toContain("addDevice");
    expect(first).not.toContain("clearWorkspace");


    const second = ModelLoad.ligadas[1] ?? [];
    expect(second).toContain("addDevice");
    expect(second).not.toContain("clearWorkspace");


    const messages = reply.messages ?? [];
    const ejecucion = messages.find(
      (m) => ToolMessage.isInstance(m) && (m as ToolMessage).name === "addDevice",
    );
    expect(ejecucion).toBeDefined();
    const close = messages.find(
      (m) => AIMessage.isInstance(m) && String(m.content) === "hecho",
    );
    expect(close).toBeDefined();
  }, 40000);

  it("la respuesta de load_tools trae el schema de lo que activa", async () => {
    resetToolsActivadas();
    const capa = buildLazyToolLayer(RECORD_ADMIN);
    const loadTools = capa.declaradas.find((t) => t.name === LOAD_TOOLS_NAME)!;
    const output = JSON.parse(
      (await (loadTools as never as { invoke(a: unknown): Promise<string> }).invoke({
        tools: ["addDevice"],
      })) as string,
    ) as {
      activated: string[];
      tools: Array<{ name: string; description: string; inputSchema: unknown }>;
    };
    expect(output.activated).toEqual(["addDevice"]);
    expect(output.tools[0].name).toBe("addDevice");
    expect(output.tools[0].description.length).toBeGreaterThan(0);
    expect(output.tools[0].inputSchema).toMatchObject({ type: "object" });
  });
});
