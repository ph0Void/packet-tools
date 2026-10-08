import { Prisma, Role, TypeModel } from "@/prisma/generated/client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import {
  establecerCacheLogsDeAgente,
  invalidarCacheLogsDeAgente,
} from "@/agent/deep/agentLog";

function providerAllowsRole(
  userPermission: string | null | undefined,
  role: string,
): boolean {
  const allowed = (userPermission ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase());
  return allowed.includes(role.toUpperCase());
}

class ConfigService {

  async getSystemConfiguration(userId: string) {
    try {
      const user = await prismaClient.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new Error("Usuario no encontrado.");
      }

      let config = await prismaClient.configuration.findFirst({
        include: {
          modelProviders: {
            where: {
              isActive: true,
              userPermission: {
                contains: user.role,
              },
            },
          },
        },
      });

      if (!config) {
        config = await prismaClient.configuration.create({
          data: {
            systemPrompt: "Eres un asistente de red útil y profesional.",
          },
          include: {
            modelProviders: true,
          },
        });
      }

      return config;
    } catch (error: any) {
      Logger.error({
        message: "Error al obtener la configuración del sistema.",
        data: error.message,
      });
      throw new Error("No se pudo obtener la configuración del sistema.");
    }
  }

  async getGlobalSystemPrompt(): Promise<string> {
    try {
      const config = await prismaClient.configuration.findFirst();
      return config?.systemPrompt?.trim() ?? "";
    } catch (error: any) {
      Logger.error({
        message: "Error al obtener el prompt global del sistema.",
        data: error.message,
      });
      return "";
    }
  }

  async getAvailableModelsForUser(userId: string) {
    try {
      const user = await prismaClient.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new Error("Usuario no encontrado.");
      }

      return await prismaClient.modelProvider.findMany({
        where: {
          isActive: true,
          typeModel: TypeModel.CHAT,
          userPermission: {
            contains: user.role,
          },
        },
      });
    } catch (error: any) {
      Logger.error({
        message: "Error al obtener proveedores de modelos.",
        data: error.message,
      });
      return [];
    }
  }

  async findModelProviderById(modelProviderId?: string, role: string = "ADMIN") {
    try {
      let providerConfig = null;

      if (modelProviderId) {
        const found = await prismaClient.modelProvider.findUnique({
          where: { id: modelProviderId },
        });

        if (
          found &&
          found.typeModel === TypeModel.CHAT &&
          found.isActive &&
          providerAllowsRole(found.userPermission, role)
        ) {
          providerConfig = found;
        }
      }

      if (!providerConfig) {
        const candidates = await prismaClient.modelProvider.findMany({
          where: { isActive: true, typeModel: TypeModel.CHAT },
          orderBy: { createdAt: "desc" },
        });
        providerConfig =
          candidates.find((candidate) =>
            providerAllowsRole(candidate.userPermission, role),
          ) ?? null;
      }

      return providerConfig;
    } catch (error: any) {
      Logger.error({
        message: "Error al obtener el proveedor del modelo.",
        data: error.message,
      });
      return null;
    }
  }

  async getAllModelProviders(userId: string) {
    try {
      const user = await prismaClient.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new Error("Usuario no encontrado.");
      }

      return await prismaClient.modelProvider.findMany();
    } catch (error: any) {
      Logger.error({
        message: "Error al obtener proveedores de modelos.",
        data: error.message,
      });
      return [];
    }
  }

  async saveModelProvider(data: Prisma.ModelProviderCreateInput) {
    try {
      return await prismaClient.modelProvider.create({
        data,
      });
    } catch (error: any) {
      Logger.error({
        message: "Error al guardar el proveedor del modelo.",
        data: error.message,
      });
      throw new Error("No se pudo guardar el proveedor del modelo.");
    }
  }

  async updateModelProvider(
    idModel: string,
    data: Prisma.ModelProviderUpdateInput,
  ) {
    try {
      return await prismaClient.modelProvider.update({
        where: { id: idModel },
        data,
      });
    } catch (error) {
      console.error("Error al actualizar el proveedor del modelo:", error);
      throw error;
    }
  }

  async deleteModelProvider(idModel: string) {
    try {
      return await prismaClient.modelProvider.delete({
        where: { id: idModel },
      });
    } catch (error) {
      console.error("Error al eliminar el proveedor del modelo:", error);
      throw error;
    }
  }

  async updateConfiguration(configId: string, systemPrompt: string) {
    try {
      return await prismaClient.configuration.update({
        where: { id: configId },
        data: { systemPrompt },
      });
    } catch (error: any) {
      Logger.error({
        message: "Error al actualizar la configuración del sistema.",
        data: error.message,
      });
      throw new Error("No se pudo actualizar la configuración del sistema.");
    }
  }

  async getAgentLogsEnabled(): Promise<boolean> {
    try {
      const config = await prismaClient.configuration.findFirst({
        select: { agentLogsEnabled: true },
      });
      return config?.agentLogsEnabled ?? true;
    } catch (error: any) {
      Logger.error({
        message: "Error al obtener agentLogsEnabled.",
        data: error.message,
      });
      return true;
    }
  }

  async setAgentLogsEnabled(valor: boolean): Promise<boolean> {
    try {
      const existing = await prismaClient.configuration.findFirst({
        select: { id: true },
      });
      if (existing) {
        await prismaClient.configuration.update({
          where: { id: existing.id },
          data: { agentLogsEnabled: valor },
        });
      } else {
        await prismaClient.configuration.create({
          data: { agentLogsEnabled: valor },
        });
      }
      invalidarCacheLogsDeAgente();
      establecerCacheLogsDeAgente(valor);
      return valor;
    } catch (error: any) {
      Logger.error({
        message: "Error al actualizar agentLogsEnabled.",
        data: error.message,
      });
      throw new Error("No se pudo actualizar la configuración de la traza del agente.");
    }
  }
}

export const configService = new ConfigService();
