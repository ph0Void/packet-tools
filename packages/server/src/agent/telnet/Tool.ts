import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { TelnetClient } from "@/client/TelnetClient";
import { searchKnowledgeBaseTool } from "../knowledge/Tool";
import { TERMINAL_TOOLS } from "../tools/TerminalTools";
import { openTerminalConsoleTool } from "../tools/OpenConsoleTools";
import { Logger } from "@/utils/Logger";
import { CONNECTION_TOOLS } from "../tools/DeviceTools";

const executeTelnetCommandsTool = tool(
  async ({ providerId, commands }) => {
    try {
      Logger.info({
        message: "[executeTelnetCommandsTool] Ejecutando comandos por Telnet",
        data: {
          providerId: providerId,
          commands: commands,
        },
      });

      const client = await TelnetClient.fromProviderId(providerId);
      const output = await client.executeCommands(commands);

      Logger.info({
        message:
          "[executeTelnetCommandsTool] Comandos ejecutados correctamente",
        data: {
          providerId: providerId,
          commands: commands,
          output: output,
        },
      });
      return JSON.stringify({ success: true, output });
    } catch (error: any) {
      Logger.error({
        message: "[executeTelnetCommandsTool] Error al ejecutar los comandos",
        data: {
          providerId: providerId,
          commands: commands,
          error: error,
        },
      });

      throw new Error(
        `Error ejecutando comandos Telnet: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "executeTelnetCommands",
    description:
      "Run an ordered list of CLI commands on a remote legacy device over Telnet using its registered providerId.",
    schema: z.object({
      providerId: z
        .string()
        .describe(
          "Registered provider id of the Telnet device",
        ),
      commands: z
        .array(z.string())
        .describe("CLI commands to send over Telnet, in order"),
    }),
  },
);

export const TELNET_TOOLS = [
  executeTelnetCommandsTool,
  openTerminalConsoleTool,
  ...TERMINAL_TOOLS,
  ...CONNECTION_TOOLS,
  searchKnowledgeBaseTool,
];
