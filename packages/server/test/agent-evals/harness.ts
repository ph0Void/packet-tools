

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { terminalSessionHub, type TerminalSessionRegistration } from "@/sockets/TerminalSessionHub";
import { requestContext, type RequestUser } from "@/utils/RequestContext";
import { approvalBroker } from "@/agent/approval/ApprovalBroker";
import { resetApprovalAttempts } from "@/agent/approval/ApprovalMiddleware";
import { clearDeepSupervisorCache } from "@/agent/deep/runner";
import { resetDelegaciones } from "@/agent/deep/delegacionStream";
import { resetBudgetCounters } from "@/agent/deep/budgetMiddleware";
import { resetToolsActivadas } from "@/agent/tools/lazyTools";
import { createTurnStream } from "@/agent/deep/turn";
import { analizarChunkDelStream } from "@/agent/deep/streamChunk";
import { decidirFastPath, type FastPathSpecialist } from "@/agent/deep/fastPath";
import { clasificarEstadoToolResult, anexarBloqueTexto, construirBloqueTailTerminal } from "@/api/router/turnoStream";
import { envConfig } from "@/config/EnvConfig";
import { activateScript, modelcallsOf, modelcallsOfScenario, type Script, type CallModel } from "./modeloFalso";


export const SOCKET_EVAL = "socket-eval";

export const USER_EVAL = "usuario-eval";

export const PROVIDER_EVAL = "proveedor-eval";


export const MARKER_MOCKCONSOLE = "MARCA_CONSOLA_EVAL_uptime_4_dias";


export const MARKER_TAIL = "linea-cruda-";


export const TAIL_RAW_EVAL =
  "\u001b[36mR1# show version\u001b[0m\r\nCisco IOS XE Software, Version 16.12.4\r\n" +
  Array.from({ length: 30 }, (_, i) => `linea-cruda-${i + 1}\r\n`).join("") +
  "\u001b[36mR1# \u001b[K";


function replyOfMockConsole(command: string): string {
  const cmd = String(command ?? "").trim().toLowerCase();

  if (cmd.includes("bogus")) {
    return "% Invalid input detected at '^' marker.\n% Unknown command";
  }
  if (cmd.includes("version")) {
    return "Cisco IOS XE Software, Version 16.12.4\nR1 uptime is 4 days";
  }
  if (cmd.includes("interface")) {
    return "GigabitEthernet1/0/1 10.0.0.1/24 up up";
  }
  return `${command} completado`;
}


export interface MockConsoleMock {
  
  writes: Map<string, number>;
  
  total: number;
}


export function mountMockConsoleMock(): MockConsoleMock {
  const writes = new Map<string, number>();
  const mockConsole: MockConsoleMock = {
    writes,
    get total() {
      let sum = 0;
      for (const value of writes.values()) sum += value;
      return sum;
    },
  };

  const record: TerminalSessionRegistration = {
    socketId: SOCKET_EVAL,
    userId: USER_EVAL,
    providerId: PROVIDER_EVAL,
    protocol: "SSH",
    deviceName: "R1-core",
    fingerprint: null,
    typeDevice: "CISCO",
    preflight: false,
    write: (data) => {
      const command = String(data ?? "").replace(/[\r\n]+$/, "");
      writes.set(command, (writes.get(command) ?? 0) + 1);
      setTimeout(() => {
        terminalSessionHub.recordData(
          SOCKET_EVAL,
          `\r\n${replyOfMockConsole(command)}\r\nR1# `,
        );
      }, 1);
    },
    isAlive: () => true,
  };

  terminalSessionHub.register(record);

  terminalSessionHub.recordData(SOCKET_EVAL, `\r\nCisco IOS XE Software\r\n${MARKER_MOCKCONSOLE}\r\nR1# `);
  return mockConsole;
}


export function clearIsolation(): void {
  terminalSessionHub.clear();
  terminalSessionHub.stopKeepalive();
  approvalBroker.clear();
  resetApprovalAttempts();
  resetDelegaciones();
  resetBudgetCounters();
  resetToolsActivadas();
  clearDeepSupervisorCache();
  activateScript(null);
}


export interface ToolCallObserved {
  name: string;
  toolCallId: string;
  status: "completed" | "error" | "rejected" | "interrupted";
  output: string;
  deSubgrafo: boolean;
}


export interface EventObserved {
  event: string;
  data: unknown;
}


export interface MeasurementTurn {
  prompt: string;
  threadId: string;
  
  route: {
    predicted: boolean;
    specialistPredicted: FastPathSpecialist | null;
    reason: string;
    observed: boolean;
    specialistObserved: string | null;


    predictedWithFlag: boolean;
    reasonWithFlag: string;
  };
  
  modelcalls: CallModel[];
  
  calls: number;
  callsByNode: Record<string, number>;
  
  inputTokens: number;
  inputTokensByNode: Record<string, number>;
  toolCalls: ToolCallObserved[];
  
  delegations: number;
  
  reply: string;
  
  textSubagents: string;
  
  mockConsole: {
    
    linesEnSystemPrompt: number;
    
    markerEnSystemPrompt: boolean;
    
    tailEnModel: boolean;
    
    linesTailEnModel: number;
    hasHeaderMin: boolean;
    charsEnSystemPrompt: number;
  };
  
  approvals: { requested: number; approved: number; rejected: number; expired: number };
  
  writes: Record<string, number>;
  totalWrites: number;
  events: EventObserved[];


  shapeChunks: { tuples: number; flat: number };
}


export type PolicyApproval = "aprobar" | "rechazar" | "sin-canal";

export interface ArgsTurn {
  
  prompt: string;
  
  script: Script;
  
  modelProviderId: string;
  origin?: "terminal" | "chat";
  role?: string;
  
  fastPath?: boolean;
  
  terminalContextLines?: number;


  terminalTail?: string;
  
  connection?: {
    name: string;
    protocol: string;
    typeDevice: string;
    alive: boolean;
  } | null;
  
  policyApproval?: PolicyApproval;
  
  history?: BaseMessage[];
  
  timeoutMs?: number;
  
  messageId?: string;
}

const CONNECTION_EVAL = {
  name: "R1-core",
  protocol: "SSH",
  typeDevice: "CISCO",
  alive: true,
};



function parseChunk(item: unknown): { mensaje: unknown; deSubgrafo: boolean; isTuple: boolean } {
  const { mensaje, deSubgrafo, eraTupla } = analizarChunkDelStream(item);
  return { mensaje, deSubgrafo, isTuple: eraTupla };
}


function textOf(chunk: unknown): string {
  const candidate = chunk as { content?: unknown; getType?: () => string } | null;
  if (!candidate || candidate.getType?.() !== "ai") return "";
  if (typeof candidate.content === "string") return candidate.content;
  if (Array.isArray(candidate.content)) {
    return candidate.content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}


function linesOfMockConsoleEnPrompt(systemPrompt: string): number {
  if (!systemPrompt) return 0;
  const block = systemPrompt.split("Últimas líneas de la consola:")[1];
  if (!block) return 0;
  const inner = block.split("```")[1] ?? "";
  return inner
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}


export async function runTurn(args: ArgsTurn): Promise<{
  measurement: MeasurementTurn;
  mockConsole: MockConsoleMock;
}> {
  clearIsolation();
  const mockConsole = mountMockConsoleMock();
  activateScript(args.script);

  const role = args.role ?? "ADMIN";
  const origin = args.origin ?? "terminal";
  const connection = args.connection === undefined ? CONNECTION_EVAL : args.connection;
  const policy = args.policyApproval ?? "aprobar";

  const events: EventObserved[] = [];
  const approvals = { requested: 0, approved: 0, rejected: 0, expired: 0 };
  const toolCalls: ToolCallObserved[] = [];
  let reply = "";
  let textSubagents = "";
  const shapeChunks = { tuples: 0, flat: 0 };
  let error: unknown = null;

  const ctx: RequestUser = {
    id: USER_EVAL,
    username: "eval",
    role,
    terminalOrigin: origin,
    terminalSessionId: SOCKET_EVAL,
    terminalContextLines: args.terminalContextLines ?? 0,
    connectionProviderId: connection ? PROVIDER_EVAL : null,
    connectionName: connection?.name ?? null,
    connectionProtocol: connection?.protocol ?? null,
    connectionFingerprint: null,
    ...(policy === "sin-canal"
      ? {}
      : {
          approvalChannel: {
            chatId: args.modelProviderId,
            emit: (event: string, data: unknown) => {
              events.push({ event, data });
              if (event === "tool_approval_required") {
                approvals.requested += 1;
                const approvalId = String((data as { approvalId?: unknown })?.approvalId ?? "");
                
                
                if (approvalId) {
                  approvalBroker.resolve(approvalId, policy === "aprobar" ? "approved" : "rejected", {
                    id: USER_EVAL,
                  });
                }
              }
              if (event === "tool_approval_resolved") {
                const decision = String((data as { decision?: unknown })?.decision ?? "");
                if (decision === "approved") approvals.approved += 1;
                if (decision === "rejected") approvals.rejected += 1;
                if (decision === "expired") approvals.expired += 1;
              }
            },
          },
        }),
  };

  const fastPathPrev = envConfig.FAST_PATH_ENABLED;
  const fastPathActive = args.fastPath === true;
  envConfig.FAST_PATH_ENABLED = fastPathActive;

  
  
  
  
  
  const content = anexarBloqueTexto(
    args.prompt,
    construirBloqueTailTerminal(args.terminalContextLines ?? 0, args.terminalTail),
  );

  try {
    await requestContext.run(ctx, async () => {
      const turn = await createTurnStream({
        messages: [...(args.history ?? []), new HumanMessage(content)],
        chatId: args.modelProviderId,
        messageId: args.messageId ?? "mensaje-eval",
        role,
        modelProviderId: args.modelProviderId,
        provider: connection?.typeDevice,
        connectionType: connection?.protocol,
        connection: connection
          ? {
              id: PROVIDER_EVAL,
              name: connection.name,
              protocol: connection.protocol,
              typeDevice: connection.typeDevice,
              host: "10.0.0.1",
              hasLiveSession: connection.alive,
              sessionId: SOCKET_EVAL,
              prompt: "R1#",
              lastLines: [],
              alive: connection.alive,
            }
          : null,
        ragPrefetched: false,
        webRequired: false,
        skillRequested: null,
        origin,
        turnTimeoutMs: args.timeoutMs ?? 60_000,
      });

      try {
        for await (const item of turn.stream) {
          const { mensaje, deSubgrafo, isTuple } = parseChunk(item);
          if (isTuple) shapeChunks.tuples += 1;
          else shapeChunks.flat += 1;
          if (!mensaje || typeof mensaje !== "object") continue;
          const kind = (mensaje as { getType?: () => string }).getType?.();
          if (kind === "ai") {
            const text = textOf(mensaje);
            if (deSubgrafo) textSubagents += text;
            else reply += text;
          }
          if (kind === "tool") {
            const tool = mensaje as { name?: unknown; tool_call_id?: unknown; content?: unknown; status?: unknown };
            const output = typeof tool.content === "string" ? tool.content : JSON.stringify(tool.content ?? "");
            toolCalls.push({
              name: String(tool.name ?? ""),
              toolCallId: String(tool.tool_call_id ?? ""),
              status: clasificarEstadoToolResult(output, tool.status as string | undefined),
              output: output.slice(0, 600),
              deSubgrafo,
            });
          }
        }
      } catch (failure) {
        
        
        error = failure;
      }
    });
  } finally {
    envConfig.FAST_PATH_ENABLED = fastPathPrev;
  }

  const modelcalls = modelcallsOfScenario();
  const modelcallsSupervisor = modelcallsOf("supervisor");
  const system = modelcallsSupervisor[0]?.systemPrompt ?? "";
  const specialistEnStream =
    modelcalls.find((call) => call.node !== "supervisor")?.node ?? null;

  const prediction = decidirFastPath({
    
    
    enabled: fastPathActive,
    origin,
    role,
    connection: connection
      ? { name: connection.name, protocol: connection.protocol, typeDevice: connection.typeDevice, alive: connection.alive }
      : null,
    textoUsuario: content,
    ragPrefetched: false,
    webRequired: false,
    skillRequested: null,
  });

  const predictionWithFlag = decidirFastPath({
    enabled: true,
    origin,
    role,
    connection: connection
      ? { name: connection.name, protocol: connection.protocol, typeDevice: connection.typeDevice, alive: connection.alive }
      : null,
    textoUsuario: content,
    ragPrefetched: false,
    webRequired: false,
    skillRequested: null,
  });

  const inputTokensByNode: Record<string, number> = {};
  const callsByNode: Record<string, number> = {};
  for (const call of modelcalls) {
    inputTokensByNode[call.node] = (inputTokensByNode[call.node] ?? 0) + call.tokensInput;
    callsByNode[call.node] = (callsByNode[call.node] ?? 0) + 1;
  }

  const measurement: MeasurementTurn = {
    prompt: args.prompt,
    threadId: `${args.modelProviderId}:${args.messageId ?? "mensaje-eval"}`,
    route: {
      predicted: prediction.ir,
      specialistPredicted: prediction.especialista,
      reason: prediction.reason,
      observed: specialistEnStream !== null,
      specialistObserved: specialistEnStream,
      predictedWithFlag: predictionWithFlag.ir,
      reasonWithFlag: predictionWithFlag.reason,
    },
    modelcalls,
    calls: modelcalls.length,
    callsByNode,
    inputTokens: modelcalls.reduce((sum, call) => sum + call.tokensInput, 0),
    inputTokensByNode,
    toolCalls,
    delegations: toolCalls.filter((tool) => tool.name === "task").length,
    reply,
    textSubagents,
    mockConsole: {
      linesEnSystemPrompt: linesOfMockConsoleEnPrompt(system),
      markerEnSystemPrompt: system.includes(MARKER_MOCKCONSOLE),
      tailEnModel: modelcalls.some((call) => call.prompt.includes(MARKER_TAIL)),
      linesTailEnModel: Math.max(
        0,
        ...modelcalls.map(
          (call) => call.prompt.split(MARKER_TAIL).length - 1,
        ),
      ),
      hasHeaderMin: system.includes("## Terminal activa"),
      charsEnSystemPrompt: system.length,
    },
    approvals,
    writes: Object.fromEntries(mockConsole.writes),
    totalWrites: mockConsole.total,
    events,
    shapeChunks,
  };
  if (error) {
    measurement.events.push({ event: "__error_turno__", data: String((error as Error)?.message ?? error) });
  }
  return { measurement, mockConsole };
}
