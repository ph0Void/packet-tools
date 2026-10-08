import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SshClient } from "@/client/SshClient";
import { searchKnowledgeBaseTool } from "../knowledge/Tool";
import { CONNECTION_TOOLS } from "../tools/DeviceTools";
import { openTerminalConsoleTool } from "../tools/OpenConsoleTools";
import { TERMINAL_TOOLS } from "../tools/TerminalTools";

const executeSshCommandsTool = tool(
  async ({ providerId, commands }) => {
    try {
      const client = await SshClient.fromProviderId(providerId);
      const output = await client.executeCommands(commands);
      await client.disconnect();
      return JSON.stringify({ success: true, output });
    } catch (error: any) {

      throw new Error(
        `Error ejecutando comandos SSH: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "executeSshCommands",
    description: "Run an ordered list of CLI commands on a remote device over SSH using its registered providerId.",
    schema: z.object({
      providerId: z.string().describe("Registered provider id of the SSH device"),
      commands: z.array(z.string()).describe("CLI commands to run, in order"),
    }),
  }
);

export const SSH_TOOLS = [
  executeSshCommandsTool,
  openTerminalConsoleTool,
  ...TERMINAL_TOOLS,
  ...CONNECTION_TOOLS,
  searchKnowledgeBaseTool,
];
