import { createDeepAgent, type CompiledSubAgent, type DeepAgent } from "deepagents";
import {
  createAgent,
  dynamicSystemPromptMiddleware,
  todoListMiddleware,
  type BuiltInState,
  type Runtime,
} from "langchain";
import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { searchKnowledgeBaseTool, searchWebTool } from "../knowledge/Tool";
import { buildAgentMiddleware, logNodoTokens } from "../AgentRuntime";
import { buildNetworkSubAgents } from "./subagents";
import { deepTurnContextSchema, type DeepTurnContext } from "./context";
import { taskResultMiddleware } from "./delegacionStream";
import { SKILLS_ROOT } from "../skills/loader";
import { skillsPromptMiddleware } from "../skills/middleware";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import { buildTerminalHeaderBlock } from "../terminal/SessionContext";
import { REGLA_DE_REINTENTOS } from "../security/ToolErrorClassifier";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export const BASE_SUPERVISOR_PROMPT = `You are the supervisor of Packet-Tools, a network engineering assistant with specialist sub-agents for Cisco Packet Tracer, GNS3 and real devices (SSH/Telnet/serial).

Decide for this turn:
- Theory, network concepts, vendor documentation or questions about the conversation: answer yourself, using 'search_knowledge_base' (internal RAG) and 'search_web_tool' only when you really need external data. Never delegate for this.
- Creating, editing or diagnosing topologies/devices in Packet Tracer: delegate to 'packet_tracer_specialist'.
- GNS3 labs: delegate to 'gns3_specialist'.
- Commands on a physical device over SSH / Telnet / serial: delegate to 'ssh_specialist' / 'telnet_specialist' / 'serial_specialist'.

Rules:
- Delegate with the 'task' tool: pass a self-contained brief in 'description' (objective, target device/lab, expected result, facts already known, and the terminal header: device, protocol, live session, vendor, prompt). The sub-agent cannot see this conversation.
- After a delegation, answer the user with the result of the sub-agent: summarise it, do not repeat its work and do not delegate the same task twice.
- Never invent tools and never invent sub-agent names: only the listed ones exist.
${REGLA_DE_REINTENTOS}
- When a specialist reports a definitive error, do not re-plan the same action: tell the user what is missing (syntax, target, permission) and ask for what is needed.
- Diagrams, when requested, in Mermaid.
- Be concise, use Markdown, and do not repeat information already present in the conversation.
- IMPORTANT: always answer the user in Spanish unless they ask for another language.
`;

const GENERAL_PURPOSE_PROMPT = `You are the general fallback of Packet-Tools. You have no device tools of your own.
Delegate the work to the specialist that fits (packet_tracer_specialist, gns3_specialist, ssh_specialist, telnet_specialist, serial_specialist, knowledge_specialist, system_admin_specialist) using the 'task' tool, then report the result to the user in Spanish.
For theory or documentation questions answer directly with 'search_knowledge_base' / 'search_web_tool'.`;

const GENERAL_PURPOSE_DESCRIPTION =
  "General fallback. Use it only for mixed or multi-step work that no single specialist covers; it routes to the right specialist itself.";

function buildConnectionBlock(context: DeepTurnContext): string {
  const connection = context.connection;
  if (!connection) return "";
  return [
    "## Target connection of this turn",
    `- Device: ${connection.name ?? "(unknown)"} | Protocol: ${connection.protocol ?? "(unknown)"} | Type: ${connection.typeDevice ?? "(unknown)"} | State: ${connection.alive ? "console alive" : "NO console open"}`,
    "- Routing is automatic per protocol: never ask the user which specialist to use.",
    connection.alive
      ? "- Operate ONLY on that device console; do not open parallel connections."
      : "- No console is open: do NOT open direct connections; ask the user to open the device console and wait.",
  ].join("\n");
}

function buildRagBlock(context: DeepTurnContext): string {
  if (!context.ragPrefetched) return "";
  return [
    "## Knowledge base already retrieved",
    "The relevant knowledge-base excerpts for this request are already in the conversation: use and cite them, do NOT call 'search_knowledge_base' again in this turn.",
  ].join("\n");
}

function buildWebBlock(context: DeepTurnContext): string {
  if (!context.webRequired) return "";
  return [
    "## Web research is mandatory for this turn",
    "The user explicitly requested an internet search with @web: you MUST call 'search_web_tool' before answering, and cite the sources you used. Do not answer from memory.",
  ].join("\n");
}

function buildSkillBlock(context: DeepTurnContext): string {
  if (!context.skillRequested) return "";
  return [
    "## Skill explicitly requested",
    `The user referenced a specific skill: '${context.skillRequested}'.`,
    `You MUST read '/skills/${context.skillRequested}/SKILL.md' with read_file BEFORE acting, and follow the procedure it describes.`,
    "If that file does not exist, say so plainly and continue without it instead of inventing its content.",
  ].join("\n");
}

const DELEGATION_TERMINAL_RULE = [
  "## Delegation rule for terminal turns",
  "When you delegate with the 'task' tool, copy the terminal header above verbatim into the 'description' (device, protocol, live session, vendor, prompt), so the specialist does not need to call 'get_terminal_status' just to learn the session or vendor.",
].join("\n");

export async function buildTurnContextPrompt(
  context: DeepTurnContext,
): Promise<string> {

  const bloques = [
    buildConnectionBlock(context),
    buildRagBlock(context),
    buildWebBlock(context),
    buildSkillBlock(context),
  ].filter(Boolean);
  const cabeceraTerminal = buildTerminalHeaderBlock();
  if (cabeceraTerminal) {
    bloques.push(cabeceraTerminal, DELEGATION_TERMINAL_RULE);
  }
  return bloques.length > 0 ? bloques.join("\n\n") : "";
}

const turnContextMiddleware = dynamicSystemPromptMiddleware<DeepTurnContext>(
  async (_state: BuiltInState, runtime: Runtime<DeepTurnContext>) =>
    buildTurnContextPrompt(runtime.context),
);

export interface DeepSupervisorOptions {
  modelProviderId?: string;
  role: string;

  connection?: DeepTurnContext["connection"];
}

export async function createDeepSupervisor(
  options: DeepSupervisorOptions,
): Promise<DeepAgent> {
  const { modelProviderId, role, connection } = options;
  const { model, provider } = await getModelProviderWithMeta(modelProviderId, role);

  const networkSubagents = await buildNetworkSubAgents({
    modelProviderId,
    role,
    connection,
  });

  const generalPurpose: CompiledSubAgent = {
    name: "general-purpose",
    description: GENERAL_PURPOSE_DESCRIPTION,
    runnable: createAgent({
      model,
      name: "general-purpose",
      systemPrompt: GENERAL_PURPOSE_PROMPT,
      tools: [searchKnowledgeBaseTool, searchWebTool],
      middleware: buildAgentMiddleware({ provider, withApproval: false }),
    }),
  };

  const agent = createDeepAgent({
    model,
    name: "packet_tools_supervisor",
    systemPrompt: await buildSystemPrompt(BASE_SUPERVISOR_PROMPT),
    tools: [searchKnowledgeBaseTool, searchWebTool],
    subagents: [...networkSubagents, generalPurpose],
    contextSchema: deepTurnContextSchema,

    skills: [SKILLS_ROOT + "/"],

    middleware: [
      todoListMiddleware(),
      skillsPromptMiddleware(),
      turnContextMiddleware,

      taskResultMiddleware(),
      ...supervisorGuardMiddleware(provider),
    ],
  });

  if (envConfig.AGENT_SUBAGENT_LOGGING) {
    Logger.info({
      message: "[DEEP_AGENT] supervisor listo",
      data: { provider, role, subagentes: networkSubagents.map((s) => s.name) },
    });
  }

  return agent;
}

function supervisorGuardMiddleware(provider: string) {
  return buildAgentMiddleware({
    provider,

    toolCallLimit: 8,
    modelCallLimit: 12,
    withApproval: false,

  }).filter((middleware) => middleware.name !== "ContextEditingMiddleware");
}

export function logSupervisorTokens(
  cantidadMensajes: number,
  tokens: number,
): void {
  logNodoTokens("deep_supervisor", cantidadMensajes, tokens);
}

export type { BaseChatModel };
