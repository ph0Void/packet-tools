import { createAgent } from "langchain";
import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { CISCO_PACKET_TRACER_TOOLS_ADMIN, CISCO_TOOLS_USER } from "./Tool";
import { CISCO_PACKET_TRACER_PROMPT } from "./Promt";
import { buildAgentMiddleware } from "../AgentRuntime";
import {
  capaDeToolsPerezosas,
  LAZY_TOOLS_RULE,
  type ToolLike,
} from "../tools/lazyTools";

export async function createCiscoPacketTracerAgent(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model, provider } = await getModelProviderWithMeta(
    modelProviderId,
    role,
  );

  const catalogo = (
    role === "ADMIN" || role === "STAFF"
      ? CISCO_PACKET_TRACER_TOOLS_ADMIN
      : CISCO_TOOLS_USER
  ) as unknown as ToolLike[];

  const lazy = capaDeToolsPerezosas(catalogo);

  return createAgent({
    model: model,

    tools: (lazy ? lazy.declaradas : catalogo) as never,
    systemPrompt: await buildSystemPrompt(
      lazy
        ? `${CISCO_PACKET_TRACER_PROMPT}\n\n${LAZY_TOOLS_RULE}`
        : CISCO_PACKET_TRACER_PROMPT,
    ),

    middleware: [
      ...buildAgentMiddleware({ provider, readCache: true }),
      ...(lazy ? [lazy.middleware] : []),
    ],
  });
}
