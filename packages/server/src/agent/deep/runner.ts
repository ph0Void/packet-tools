import type { BaseMessage } from "@langchain/core/messages";
import type { DeepAgent } from "deepagents";
import { createDeepSupervisor } from "./DeepSupervisor";
import { deepTurnContextSchema, type DeepTurnContext } from "./context";
import { CLAVE_DEADLINE, CLAVE_PLAZO } from "./turnPlazoMiddleware";
import { envConfig } from "@/config/EnvConfig";
import { logNodoTokens } from "../AgentRuntime";
import { estimateMessagesTokens } from "@/utils/MessageContext";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  agent: DeepAgent;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(modelProviderId: string | undefined, role: string): string {
  return `${modelProviderId ?? "default"}::${role}`;
}

function purgeExpired(): void {
  const ahora = Date.now();
  for (const [key, entry] of cache) {
    if (ahora - entry.createdAt > CACHE_TTL_MS) cache.delete(key);
  }
}

export async function getDeepSupervisor(options: {
  modelProviderId?: string;
  role: string;
  connection?: DeepTurnContext["connection"];
}): Promise<DeepAgent> {
  const { modelProviderId, role } = options;
  const key = cacheKey(modelProviderId, role);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.createdAt <= CACHE_TTL_MS) return hit.agent;

  purgeExpired();
  const agent = await createDeepSupervisor(options);
  cache.set(key, { agent, createdAt: Date.now() });
  return agent;
}

export function clearDeepSupervisorCache(): void {
  cache.clear();
}

export function buildTurnThreadId(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`;
}

export function logDeepTurnTokens(mensajes: BaseMessage[]): void {
  if (!envConfig.AGENT_TOKEN_LOGGING) return;
  logNodoTokens(
    "deep_supervisor",
    mensajes.length,
    estimateMessagesTokens(mensajes),
  );
}

export function buildDeepConfig(input: {
  threadId: string;
  context: DeepTurnContext;
  signal?: AbortSignal;

  deadlineAt?: number;

  plazoMs?: number;
}) {
  return {
    configurable: {
      thread_id: input.threadId,
      ...(typeof input.deadlineAt === "number"
        ? {
            [CLAVE_DEADLINE]: Math.round(input.deadlineAt),
            ...(typeof input.plazoMs === "number" ? { [CLAVE_PLAZO]: Math.round(input.plazoMs) } : {}),
          }
        : {}),
    },
    context: deepTurnContextSchema.parse(input.context),

    recursionLimit: envConfig.AGENT_SUPERVISOR_RECURSION_LIMIT,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}
