import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";

const listDeviceProvidersTool = tool(
  async () => {
    try {
      const providers = await prismaClient.deviceProviders.findMany({
        select: {
          id: true,
          name: true,
          typeDevice: true,
          protocol: true,
          host: true,
          port: true,
          serialPort: true,
          status: true,
        },
      });
      return JSON.stringify({ success: true, providers });
    } catch (error: any) {

      throw new Error(
        `Error listando los dispositivos proveedores: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "listDeviceProviders",
    description:
      "List registered provider devices (id, name, type, protocol, host, port, serial port, status). Call it first to get a real providerId instead of inventing one.",
    schema: z.object({}),
  }
);

const findByNameConnectionTool = tool(
  async ({ name }) => {
    try {
      const providers = await prismaClient.deviceProviders.findMany({
        where: {
          name: {
            contains: name,
          },

        },
        select: {
          id: true,
          name: true,
          typeDevice: true,
          protocol: true,
          host: true,
          port: true,
          serialPort: true,
          status: true,
        },
      });
      return JSON.stringify({ success: true, providers });
    } catch (error: any) {
      throw new Error(
        `Error listando los dispositivos proveedores: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "findDeviceByName",
    description:
      "Find registered provider devices by name substring; returns the same fields as listDeviceProviders.",
    schema: z.object({
      name: z.string().describe("Device name to look up"),
    }),
  }
);

export const CONNECTION_TOOLS = [
  listDeviceProvidersTool,
  findByNameConnectionTool,
]
