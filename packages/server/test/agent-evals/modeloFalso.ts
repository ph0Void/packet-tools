

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatGeneration, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { estimarTokens, estimarTokensMensajes } from "@/agent/deep/metrics";


export const NODE_SUPERVISOR = "supervisor";
export const NODE_UNKNOWN = "desconocido";


const MARKERS_NODE: ReadonlyArray<readonly [string, string]> = [
  ["You are the supervisor of Packet-Tools", NODE_SUPERVISOR],
  ["You are the AI co-pilot for Cisco Packet Tracer", "packet_tracer_specialist"],
  ["You are the Telnet specialist", "telnet_specialist"],
  ["You are the SSH administration specialist", "ssh_specialist"],
  ["You are the serial-port (RS-232", "serial_specialist"],
  ["You are the GNS3", "gns3_specialist"],
  ["You are the company knowledge assistant", "knowledge_specialist"],
  ["You are the system administrator of Packet-Tools", "system_admin_specialist"],
  ["You are the general fallback", "general-purpose"],
];


function systemPromptOf(messages: BaseMessage[]): string {
  const parts: string[] = [];
  for (const mensaje of messages) {
    if (mensaje?.getType?.() !== "system") continue;
    const content = (mensaje as { content?: unknown }).content;
    parts.push(typeof content === "string" ? content : JSON.stringify(content));
  }
  return parts.join("\n\n");
}


function promptOf(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const mensaje = messages[i];
    if (mensaje?.getType?.() !== "human") continue;
    const content = (mensaje as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block) =>
          block && typeof block === "object" && "text" in block
            ? String((block as { text?: unknown }).text ?? "")
            : "",
        )
        .join("");
    }
  }
  return "";
}


export function identifyNode(messages: BaseMessage[]): string {
  const system = systemPromptOf(messages);
  for (const [marker, node] of MARKERS_NODE) {
    if (system.includes(marker)) return node;
  }
  return NODE_UNKNOWN;
}


export function tokensOfTool(tool: unknown): number {
  const t = tool as { description?: string; schema?: { toJSONSchema?: () => unknown } } | null;
  let json = "{}";
  if (t?.schema && typeof t.schema.toJSONSchema === "function") {
    try {
      json = JSON.stringify(t.schema.toJSONSchema());
    } catch {
      json = "{}";
    }
  }
  return estimarTokens(String(t?.description ?? "")) + estimarTokens(json);
}


export function tokensOfTools(tools: readonly unknown[]): number {
  return tools.reduce((total, tool) => total + tokensOfTool(tool), 0);
}


export interface CallModel {
  
  node: string;
  
  round: number;
  
  tools: string[];
  
  tokensMessages: number;
  
  tokensTools: number;
  
  tokensInput: number;
  
  systemPrompt: string;
  
  prompt: string;
  
  lastResult: string;
}


export interface ContextScript {
  node: string;
  round: number;
  tools: string[];
  
  modelcalls: readonly CallModel[];
  
  lastResult: string;
}

export type Script = (context: ContextScript) => AIMessage | Promise<AIMessage>;


let scriptActive: Script | null = null;
const modelcallsRecorded: CallModel[] = [];


export function activateScript(script: Script | null): void {
  scriptActive = script;
  modelcallsRecorded.length = 0;
}


export function scriptInstalled(): boolean {
  return scriptActive !== null;
}


export function modelcallsOfScenario(): CallModel[] {
  return [...modelcallsRecorded];
}


export function modelcallsOf(node: string): CallModel[] {
  return modelcallsRecorded.filter((call) => call.node === node);
}


export function newModelFake(): BaseChatModel {
  return new ModelScript();
}


function lastResultOf(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const mensaje = messages[i];
    if (mensaje?.getType?.() !== "tool") continue;
    const content = (mensaje as { content?: unknown }).content;
    if (typeof content === "string") return content;
    return JSON.stringify(content ?? "");
  }
  return "";
}


class ModelScript extends BaseChatModel {
  
  private readonly binds: unknown[][] = [];
  
  private readonly roundByNode = new Map<string, number>();

  constructor() {
    super({});
  }

  override bindTools(tools: unknown[], _options?: unknown): this {
    this.binds.push(Array.isArray(tools) ? tools : []);
    return this;
  }

  override _llmType(): string {
    return "modelo-falso-eval";
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    if (!scriptActive) {
      throw new Error(
        "El eval invocó al modelo sin guion instalado: el escenario debe llamar a activarGuion() antes de su turno.",
      );
    }

    const node = identifyNode(messages);
    const round = (this.roundByNode.get(node) ?? 0) + 1;
    this.roundByNode.set(node, round);

    
    
    const toolsLigadas = this.binds[round - 1] ?? this.binds[this.binds.length - 1] ?? [];

    const lastResult = lastResultOf(messages);
    const call: CallModel = {
      node,
      round,
      tools: toolsLigadas.map((t) => String((t as { name?: string })?.name ?? "")),
      tokensMessages: estimarTokensMensajes(messages),
      tokensTools: tokensOfTools(toolsLigadas),
      tokensInput: 0,
      systemPrompt: systemPromptOf(messages),
      prompt: promptOf(messages),
      lastResult,
    };
    call.tokensInput = call.tokensMessages + call.tokensTools;
    modelcallsRecorded.push(call);

    const mensaje = await scriptActive({
      node,
      round,
      tools: call.tools,
      modelcalls: [...modelcallsRecorded],
      lastResult,
    });

    const content = (mensaje as { content?: unknown }).content;
    const text = Array.isArray(content) ? "" : String(content ?? "");
    return {
      generations: [{ text: text, message: mensaje, generationInfo: {} } as ChatGeneration],
    };
  }

  
  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const result = await this._generate(messages, options, runManager);
    const generacion = result.generations[0];
    const mensaje = generacion.message as AIMessage;
    const content = typeof mensaje.content === "string" ? mensaje.content : "";
    const modelcalls = (mensaje as unknown as { tool_calls?: Array<{ name?: string; args?: unknown; id?: string }> })
      .tool_calls ?? [];
    const chunk = new AIMessageChunk({
      content: content,
      tool_call_chunks: modelcalls.map((call, index) => ({
        name: call.name ?? "",
        args: JSON.stringify(call.args ?? {}),
        id: call.id ?? `call_${index}`,
        index: index,
        type: "tool_call_chunk" as const,
      })),
    });
    yield new ChatGenerationChunk({ text: content, message: chunk, generationInfo: {} });
  }
}
