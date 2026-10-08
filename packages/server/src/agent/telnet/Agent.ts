import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { TELNET_PROMPT } from "./Promt";
import { TELNET_TOOLS } from "./Tool";
import { createAgent } from "langchain";
import { buildAgentMiddleware } from "../AgentRuntime";

export async function createTelnetAgent(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model, provider } = await getModelProviderWithMeta(
    modelProviderId,
    role,
  );
  return createAgent({
    model: model,
    tools: TELNET_TOOLS,
    systemPrompt: await buildSystemPrompt(TELNET_PROMPT, {
      conHerramientasTerminal: true,
    }),
    middleware: buildAgentMiddleware({ provider }),
  });
}
