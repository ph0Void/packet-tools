

import { describe, expect, it } from "vitest";
import { createAgent } from "langchain";
import { createDeepAgent } from "deepagents";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { type ChatGeneration, type ChatResult } from "@langchain/core/outputs";
import {
  consumirResultadosDeDelegacion,
  limpiarResultadosDeDelegacion,
  resetDelegaciones,
  taskResultMiddleware,
  toolMessageDeDelegacion,
} from "@/agent/deep/delegacionStream";
import { chunkDeStream, crearRelojDeTurno, streamConPlazo } from "@/agent/deep/turnPlazo";
import { clasificarEstadoToolResult } from "@/api/router/turnoStream";

const ID_TASK = "call_task_1";
const TEXT_SUBAGENT = "RESULTADO DEL ESPECIALISTA: write erase aplicado, consola limpia.";


class ModelScript extends BaseChatModel {
  readonly modelcalls: BaseMessage[][] = [];
  constructor(private readonly script: AIMessage[]) {
    super({});
  }
  override bindTools(): this {
    return this;
  }
  override _llmType(): string {
    return "guion-delegacion";
  }
  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.modelcalls.push([...messages]);
    const mensaje = this.script[Math.min(this.modelcalls.length - 1, this.script.length - 1)];
    return { generations: [{ text: "", message: mensaje, generationInfo: {} } as ChatGeneration] };
  }
}


function createSubagent() {
  const model = new ModelScript([new AIMessage({ content: TEXT_SUBAGENT })]);
  return createAgent({
    model: model as never,
    tools: [],
    systemPrompt: "especialista",
    name: "telnet_specialist",
  });
}


function createSupervisor(opts: { withCaptura: boolean }) {
  const model = new ModelScript([
    new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "task",
          args: { description: "borra la configuración", subagent_type: "telnet_specialist" },
          id: ID_TASK,
          type: "tool_call",
        },
      ],
    }),
    new AIMessage({ content: "Listo: configuración borrada." }),
  ]);

  return createDeepAgent({
    model: model as never,
    name: "packet_tools_supervisor",
    systemPrompt: "supervisor",
    subagents: [
      { name: "telnet_specialist", description: "telnet", runnable: createSubagent() as never },
    ],
    middleware: opts.withCaptura ? [taskResultMiddleware()] : [],
  }) as unknown as {
    stream(i: unknown, c: unknown): Promise<AsyncIterable<unknown>>;
  };
}


const CONFIG = {
  streamMode: "messages" as never,
  subgraphs: true,
  recursionLimit: 100,
  configurable: { thread_id: "hilo-delegacion" },
};

const INPUT = { messages: [new HumanMessage("borra la configuración del switch")] };


function parsearComoElRouter(items: unknown[]) {
  let answer = "";
  const results: Array<{ id: string; name: string; output: string; status: string }> = [];
  for (const item of items) {
    const chunk = chunkDeStream(item) as
      | { getType?: () => string; content?: unknown; name?: string; tool_call_id?: string; status?: string }
      | undefined;
    if (!chunk) continue;
    if (chunk.getType?.() === "tool") {
      const output = String(chunk.content ?? "").slice(0, 2000);
      results.push({
        id: String(chunk.tool_call_id ?? ""),
        name: String(chunk.name ?? ""),
        output,
        status: clasificarEstadoToolResult(output, chunk.status),
      });
      continue;
    }
    if (chunk.getType?.() === "ai") answer += String(chunk.content ?? "");
  }
  return { answer, results };
}


async function recorrerTurn(opts: { withCaptura: boolean; threadId: string }) {
  const supervisor = createSupervisor(opts);
  const reloj = crearRelojDeTurno({ limitMs: 60_000 });
  const stream = await supervisor.stream(INPUT, {
    ...CONFIG,
    configurable: { thread_id: opts.threadId },
  });
  const items: unknown[] = [];
  for await (const item of streamConPlazo({
    stream,
    reloj,
    threadId: opts.threadId,
    etiqueta: "test",
  })) {
    items.push(item);
  }
  return items;
}

describe("delegación (V6): el ToolMessage del task no viaja en el stream", () => {
  it("SIN el arreglo el resultado de `task` no aparece (reproduce el bug)", async () => {
    resetDelegaciones();
    const supervisor = createSupervisor({ withCaptura: false });
    const stream = await supervisor.stream(INPUT, CONFIG);

    const items: unknown[] = [];
    for await (const item of stream) items.push(item);

    const { results } = parsearComoElRouter(items);
    
    expect(
      items.some((item) => String(chunkDeStream(item)?.content ?? "").includes("RESULTADO DEL ESPECIALISTA")),
    ).toBe(true);
    
    expect(results.some((result) => result.id === ID_TASK)).toBe(false);
  }, 60000);

  it("CON el arreglo se emite el ToolMessage del task con su tool_call_id", async () => {
    resetDelegaciones();
    const items = await recorrerTurn({ withCaptura: true, threadId: "hilo-con-fix" });

    const delegation = items
      .map((item) => chunkDeStream(item))
      .find((chunk) => ToolMessage.isInstance(chunk) && chunk.tool_call_id === ID_TASK) as
      | ToolMessage
      | undefined;

    expect(delegation).toBeDefined();
    expect(delegation?.name).toBe("task");
    expect(String(delegation?.content)).toBe(TEXT_SUBAGENT);
  }, 60000);

  it("el chunk emitido se traduce como resultado de tool COHERENTE para el router", async () => {
    resetDelegaciones();
    const items = await recorrerTurn({ withCaptura: true, threadId: "hilo-estado" });

    const { answer, results } = parsearComoElRouter(items);
    const result = results.find((item) => item.id === ID_TASK);

    
    expect(result?.name).toBe("task");
    expect(result?.status).toBe("completed");
    expect(result?.output).toBe(TEXT_SUBAGENT);

    
    expect(results.filter((item) => item.id === ID_TASK)).toHaveLength(1);

    
    
    
    
    
    expect(answer.split(TEXT_SUBAGENT).length - 1).toBe(1);
    expect(answer).toContain("Listo: configuración borrada.");
  }, 60000);

  it("no reemite el ToolMessage si el stream ya lo trajo (futuro deepagents)", async () => {
    resetDelegaciones();
    const middleware = taskResultMiddleware();
    const nucleo = (middleware as unknown as { wrapToolCall: Function }).wrapToolCall;
    const command = {
      update: { messages: [new ToolMessage({ content: TEXT_SUBAGENT, tool_call_id: ID_TASK, name: "task" })] },
    };

    await nucleo(
      { toolCall: { name: "task", args: { description: "x" }, id: ID_TASK }, runtime: { configurable: { thread_id: "hilo-dedupe" } } },
      async () => command,
    );

    
    expect(consumirResultadosDeDelegacion("hilo-dedupe", new Set([ID_TASK]))).toHaveLength(0);

    
    await nucleo(
      { toolCall: { name: "task", args: { description: "x" }, id: ID_TASK }, runtime: { configurable: { thread_id: "hilo-nuevo" } } },
      async () => command,
    );
    const sueltos = consumirResultadosDeDelegacion("hilo-nuevo", new Set());
    expect(sueltos).toHaveLength(1);
    expect(sueltos[0].tool_call_id).toBe(ID_TASK);

    
    expect(consumirResultadosDeDelegacion("hilo-nuevo", new Set())).toHaveLength(0);

    
    resetDelegaciones();
    const devuelto = await nucleo(
      { toolCall: { name: "task", args: {}, id: ID_TASK }, runtime: { configurable: { thread_id: "hilo-intacto" } } },
      async () => command,
    );
    expect(devuelto).toBe(command);
  }, 60000);
});

describe("delegación (V6): piezas del registro", () => {
  it("solo extrae el ToolMessage de la forma Command que usa deepagents", () => {
    const enCommand = {
      update: { messages: [new ToolMessage({ content: "x", tool_call_id: "c1", name: "task" })] },
    };
    expect(toolMessageDeDelegacion(enCommand)?.tool_call_id).toBe("c1");

    
    
    expect(toolMessageDeDelegacion(new ToolMessage({ content: "x", tool_call_id: "c1" }))).toBeNull();
    expect(toolMessageDeDelegacion({ update: { messages: [new AIMessage("hola")] } })).toBeNull();
    expect(toolMessageDeDelegacion(null)).toBeNull();
    expect(toolMessageDeDelegacion("texto")).toBeNull();
  });

  it("consume el registro una sola vez y limpiar lo vacía", () => {
    resetDelegaciones();
    
    
    expect(consumirResultadosDeDelegacion("hilo-vacio", new Set())).toEqual([]);
    limpiarResultadosDeDelegacion("hilo-vacio");
    expect(consumirResultadosDeDelegacion("hilo-vacio", new Set())).toEqual([]);
  });
});
