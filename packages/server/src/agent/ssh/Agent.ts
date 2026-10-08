import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { SSH_PROMPT } from "./Promt";
import { SSH_TOOLS } from "./Tool";
import { createAgent } from "langchain";
import { buildAgentMiddleware } from "../AgentRuntime";

export async function createSshAgent(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model, provider } = await getModelProviderWithMeta(
    modelProviderId,
    role,
  );
  return createAgent({
    model: model,
    tools: SSH_TOOLS,
    systemPrompt: await buildSystemPrompt(SSH_PROMPT, {
      conHerramientasTerminal: true,
    }),
    middleware: buildAgentMiddleware({ provider }),
  });
}
