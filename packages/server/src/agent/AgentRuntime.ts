import {
  anthropicPromptCachingMiddleware,
  ClearToolUsesEdit,
  contextEditingMiddleware,
  createMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
  type AgentMiddleware,
} from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import { compactText, estimateMessagesTokens } from "@/utils/MessageContext";
import { approvalMiddleware } from "./approval/ApprovalMiddleware";
import { agentBudgetMiddleware } from "./deep/budgetMiddleware";
import { duplicateGuardMiddleware } from "./deep/duplicateGuardMiddleware";
import { retryGuardMiddleware } from "./deep/retryGuardMiddleware";
import { turnPlazoMiddleware } from "./deep/turnPlazoMiddleware";
import { readCacheMiddleware } from "./tools/readCacheMiddleware";

const HINT_RECORTE =
  "\n[hint: output truncated to fit the context budget; narrow the call with filters/limits if you need the full payload]";

export function toolOutputBudgetMiddleware(
  maxChars: number = envConfig.AGENT_TOOL_OUTPUT_CHARS,
): AgentMiddleware {
  return createMiddleware({
    name: "ToolOutputBudget",
    wrapToolCall: async (request, handler) => {
      const resultado = await handler(request);
      if (!ToolMessage.isInstance(resultado)) return resultado;
      const texto = typeof resultado.content === "string" ? resultado.content : "";
      if (!texto || texto.length <= maxChars) return resultado;
      return new ToolMessage({
        ...(resultado as any),
        content: compactText(texto, maxChars, "tool output truncated") + HINT_RECORTE,
      });
    },
  });
}

export interface AgentMiddlewareOptions {

  provider?: string | null;

  toolCallLimit?: number;

  modelCallLimit?: number;

  toolOutputChars?: number;

  contextEditTokens?: number;

  withApproval?: boolean;

  budget?: boolean;

  retryGuard?: boolean;

  readCache?: boolean;

  turnDeadline?: boolean;

  duplicateToolGuard?: boolean;
}

export function buildAgentMiddleware(
  options: AgentMiddlewareOptions = {},
): AgentMiddleware[] {
  const middleware: AgentMiddleware[] = [];

  if (options.withApproval !== false) middleware.push(approvalMiddleware);

  if (options.retryGuard !== false) middleware.push(retryGuardMiddleware());
  middleware.push(
    toolOutputBudgetMiddleware(
      options.toolOutputChars ?? envConfig.AGENT_TOOL_OUTPUT_CHARS,
    ),
  );

  if (options.readCache) middleware.push(readCacheMiddleware());

  middleware.push(
    contextEditingMiddleware({
      edits: [
        new ClearToolUsesEdit({
          trigger: { tokens: options.contextEditTokens ?? envConfig.AGENT_CONTEXT_EDIT_TOKENS },
          keep: { messages: 4 },

          excludeTools: ["search_knowledge_base", "search_web_tool"],
          placeholder: "[older tool output cleared to save context]",
        }),
      ],
      tokenCountMethod: "approx",
    }),
  );

  const toolCallLimit = options.toolCallLimit ?? envConfig.AGENT_SPECIALIST_TOOL_LIMIT;
  const modelCallLimit = options.modelCallLimit ?? envConfig.AGENT_SPECIALIST_MODEL_LIMIT;

  if (options.turnDeadline !== false) {
    middleware.push(turnPlazoMiddleware());
  }

  if (options.budget !== false) {
    middleware.push(agentBudgetMiddleware({ modelLimit: modelCallLimit }));
  }

  if (options.duplicateToolGuard !== false) {
    middleware.push(duplicateGuardMiddleware());
  }

  middleware.push(
    toolCallLimitMiddleware({
      runLimit: toolCallLimit,
      exitBehavior: "continue",
    }),
  );
  middleware.push(
    modelCallLimitMiddleware({
      runLimit: modelCallLimit,
      exitBehavior: "end",
    }),
  );

  if (
    envConfig.AGENT_PROMPT_CACHING &&
    String(options.provider ?? "").toUpperCase() === "ANTHROPIC"
  ) {
    middleware.push(
      anthropicPromptCachingMiddleware({
        ttl: "1h",
        unsupportedModelBehavior: "ignore",
      }),
    );
  }

  return middleware;
}

export function logNodoTokens(nodo: string, cantidadMensajes: number, tokens: number): void {
  if (!envConfig.AGENT_TOKEN_LOGGING) return;
  Logger.info({
    message: "[AGENT_TOKENS]",
    data: { nodo, mensajes: cantidadMensajes, tokensEntrada: tokens },
  });
}

export { estimateMessagesTokens };
