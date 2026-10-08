import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { GNS3_PROMPT } from "./Promt";
import { GNS3_TOOLS_ADMIN } from "./Tool";
import { createAgent } from "langchain";
import { buildAgentMiddleware } from "../AgentRuntime";
import { requestContext } from "@/utils/RequestContext";

interface Gns3TargetContext {
  name?: string | null;
  host?: string | null;
  typeDevice?: string | null;
}

function buildGns3ContextBlocks(
  connection?: Gns3TargetContext | null,
): string {
  const bloques: string[] = [];

  if (connection) {
    bloques.push(
      [
        "## Servidor GNS3 objetivo",
        `- Nombre: ${connection.name ?? "(sin nombre)"}`,
        `- Host: ${connection.host ?? "(host no configurado)"}`,
        `- Tipo: ${connection.typeDevice ?? "GNS3"}`,
        "- Las herramientas resuelven la URL y las credenciales de este servidor automáticamente: no pidas usuario ni contraseña.",
      ].join("\n"),
    );
  }

  const activo =
    (requestContext.getStore() as { gns3ProjectId?: string | null } | undefined)
      ?.gns3ProjectId ?? null;
  if (activo) {
    bloques.push(
      [
        "## Proyecto GNS3 activo",
        `Proyecto activo persistido: ${activo}. Úsalo por defecto en 'getGns3Project', 'listGns3Nodes', 'listGns3Links', 'createGns3Node', 'connectGns3Nodes', 'controlGns3NodePower', 'sendGns3ConsoleCommands' y 'openGns3Console' sin volver a preguntar por el 'projectId'.`,
      ].join("\n"),
    );
  }

  return bloques.join("\n\n");
}

export async function createGns3Agent(
  modelProviderId?: string,
  role: string = "ADMIN",
  connection?: {
    name?: string | null;
    host?: string | null;
    typeDevice?: string | null;
  } | null,
) {
  const { model, provider } = await getModelProviderWithMeta(
    modelProviderId,
    role,
  );
  const systemPrompt = await buildSystemPrompt(GNS3_PROMPT, {
    conHerramientasTerminal: true,
  });
  const contextBlocks = buildGns3ContextBlocks(connection);

  return createAgent({
    model: model,
    tools: GNS3_TOOLS_ADMIN,
    systemPrompt: contextBlocks
      ? `${systemPrompt}\n\n${contextBlocks}`
      : systemPrompt,
    middleware: buildAgentMiddleware({ provider }),
  });
}
