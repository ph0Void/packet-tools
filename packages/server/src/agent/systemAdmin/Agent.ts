import { createAgent } from "langchain";
import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { buildAgentMiddleware } from "../AgentRuntime";
import { SYSTEM_ADMIN_PROMPT } from "./Promt";
import {
  SYSTEM_ADMIN_TOOLS_ADMIN,
  SYSTEM_ADMIN_TOOLS_STAFF,
} from "./Tool";
import { SKILL_TOOLS, SKILL_TOOLS_STAFF } from "../skills/tools";

export async function createSystemAdminAgent(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model, provider } = await getModelProviderWithMeta(
    modelProviderId,
    role,
  );
  const esAdmin = role === "ADMIN";
  const tools = [
    ...(esAdmin ? SYSTEM_ADMIN_TOOLS_ADMIN : SYSTEM_ADMIN_TOOLS_STAFF),
    ...(esAdmin ? SKILL_TOOLS : SKILL_TOOLS_STAFF),
  ];

  return createAgent({
    model,
    name: "system_admin_specialist",
    tools: tools as never,
    systemPrompt: await buildSystemPrompt(SYSTEM_ADMIN_PROMPT),

    middleware: buildAgentMiddleware({ provider }),
  });
}
