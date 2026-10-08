import { createAgent } from "langchain";
import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { knowledgeBaseTools } from "./Tool";
import { KNOWLEDGE_BASE_PROMT } from "./Promt";
import { buildAgentMiddleware } from "../AgentRuntime";

export async function createKnowledgeAgent(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model, provider } = await getModelProviderWithMeta(modelProviderId, role);

  return createAgent({
    model,
    name: "knowledge_specialist",
    tools: knowledgeBaseTools,
    systemPrompt: await buildSystemPrompt(KNOWLEDGE_BASE_PROMT),

    middleware: buildAgentMiddleware({ provider, withApproval: false }),
  });
}

export const knowledgeBaseAgent = () => createKnowledgeAgent();
