import { createAgent } from "langchain";
import { buildSystemPrompt, getModelProviderWithMeta } from "../Model";
import { buildAgentMiddleware } from "../AgentRuntime";
import { SSH_TOOLS } from "../ssh/Tool";
import { SSH_PROMPT } from "../ssh/Promt";
import { TELNET_TOOLS } from "../telnet/Tool";
import { TELNET_PROMPT } from "../telnet/Promt";
import { SERIAL_PORT_TOOLS } from "../serialPort/Tool";
import { SERIAL_PORT_PROMPT } from "../serialPort/Promt";
import { buildTerminalHeaderBlock } from "../terminal/SessionContext";
import { Logger } from "@/utils/Logger";
import { FAST_PATH_RULE, type FastPathSpecialist } from "./fastPath";

const ESPECIALISTAS: Record<
  FastPathSpecialist,
  { prompt: string; tools: unknown[] }
> = {
  ssh: { prompt: SSH_PROMPT, tools: SSH_TOOLS },
  telnet: { prompt: TELNET_PROMPT, tools: TELNET_TOOLS },
  serial: { prompt: SERIAL_PORT_PROMPT, tools: SERIAL_PORT_TOOLS },
};

export const FAST_PATH_SUBAGENTS: Record<FastPathSpecialist, string> = {
  ssh: "ssh_specialist",
  telnet: "telnet_specialist",
  serial: "serial_specialist",
};

export async function crearEspecialistaDeTerminal(params: {
  especialista: FastPathSpecialist;
  modelProviderId?: string;
  role: string;
}): Promise<ReturnType<typeof createAgent> | null> {
  const definicion = ESPECIALISTAS[params.especialista];
  if (!definicion) return null;

  let modelo: Awaited<ReturnType<typeof getModelProviderWithMeta>>;
  try {
    modelo = await getModelProviderWithMeta(params.modelProviderId, params.role);
  } catch (error) {
    Logger.warning({
      message:
        "[FAST_PATH] No se pudo resolver el modelo del especialista; cae al supervisor",
      data: error,
    });
    return null;
  }

  const instrucciones = [buildTerminalHeaderBlock(), "", FAST_PATH_RULE]
    .filter(Boolean)
    .join("\n");

  return createAgent({
    model: modelo.model,
    name: FAST_PATH_SUBAGENTS[params.especialista],
    tools: definicion.tools as never,
    systemPrompt: await buildSystemPrompt(`${definicion.prompt}\n\n${instrucciones}`),
    middleware: buildAgentMiddleware({ provider: modelo.provider }),
  });
}
