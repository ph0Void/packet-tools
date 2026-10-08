import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { SERIAL_PORT_PROMPT } from "./Promt";
import { SERIAL_PORT_TOOLS } from "./Tool";
import { createAgent } from "langchain";
import { buildAgentMiddleware } from "../AgentRuntime";

export async function createSerialPortAgent(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model, provider } = await getModelProviderWithMeta(
    modelProviderId,
    role,
  );
  return createAgent({
    model: model,
    tools: SERIAL_PORT_TOOLS,
    systemPrompt: await buildSystemPrompt(SERIAL_PORT_PROMPT, {
      conHerramientasTerminal: true,
    }),
    middleware: buildAgentMiddleware({ provider }),
  });
}
