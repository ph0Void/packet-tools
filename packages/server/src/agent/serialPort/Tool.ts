import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SerialPortClient } from "@/client/SerialPortClient";
import { searchKnowledgeBaseTool } from "../knowledge/Tool";
import { CONNECTION_TOOLS } from "../tools/DeviceTools";
import { openTerminalConsoleTool } from "../tools/OpenConsoleTools";
import { TERMINAL_TOOLS } from "../tools/TerminalTools";
import { Logger } from "@/utils/Logger";

const sendSerialCommandTool = tool(
  async ({ providerId, command }) => {
    try {
      Logger.info({
        message: "[sendSerialCommandTool] Ejecutando comando por puerto serial",
        data: {
          providerId: providerId,
          command: command,
        },
      });

      const client = await SerialPortClient.fromProviderId(providerId);
      const result = await client.executeCommand(command);
      await client.disconnect();
      Logger.info({
        message: "[sendSerialCommandTool] Comando ejecutado correctamente",
        data: {
          providerId: providerId,
          command: command,
          result: result,
        },
      });
      return JSON.stringify({ success: true, output: result });
    } catch (error: any) {
      Logger.error({
        message: "[sendSerialCommandTool] Error al ejecutar el comando",
        data: {
          providerId: providerId,
          command: command,
          error: error,
        },
      });

      throw new Error(
        `Error enviando comando por puerto serial: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "sendSerialCommand",
    description:
      "Send one CLI command over the device serial port (RS-232/USB) using its providerId; check the output before sending the next command.",
    schema: z.object({
      providerId: z
        .string()
        .describe("Registered provider id of the serial device"),
      command: z.string().describe("Comando CLI a ejecutar"),
    }),
  },
);

export const SERIAL_PORT_TOOLS = [
  sendSerialCommandTool,
  openTerminalConsoleTool,
  ...TERMINAL_TOOLS,
  ...CONNECTION_TOOLS,
  searchKnowledgeBaseTool,
];
