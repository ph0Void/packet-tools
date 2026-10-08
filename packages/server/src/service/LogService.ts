import { Prisma } from "@/prisma/generated/browser";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

class LogService {
  async getAll(topologyId?: string, page: number = 1, limit: number = 10) {
    try {
      const whereClause = topologyId ? { topologyId } : {};
      const logs = await prismaClient.log.findMany({
        where: whereClause,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          topology: true,
        },
      });
      return {
        succes: true,
        message: "Logs obtenidos exitosamente",
        data: logs,
      };
    } catch (error) {
      Logger.error({
        message: `[LOG_SERVICE] Error obteniendo logs`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al obtener logs",
        data: null,
      };
    }
  }

  async getById(id: string) {
    try {
      const log = await prismaClient.log.findUnique({
        where: {
          id,
        },
      });
      return {
        succes: true,
        message: "Log obtenido exitosamente",
        data: log,
      };
    } catch (error) {
      Logger.error({
        message: `[LOG_SERVICE] Error obteniendo log`,
        data: error,
      });

      return {
        succes: false,
        message: "Error al obtener log",
        data: null,
      };
    }
  }

  async create(data: Prisma.LogCreateInput) {
    try {
      const log = await prismaClient.log.create({
        data,
      });
      return {
        succes: true,
        message: "Log creado exitosamente",
        data: log,
      };
    } catch (error) {
      Logger.error({
        message: `[LOG_SERVICE] Error creando log`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al crear log",
        data: null,
      };
    }
  }

  async update(id: string, data: Prisma.LogUpdateInput) {
    try {
      const log = await prismaClient.log.update({
        where: {
          id,
        },
        data,
      });
      return {
        succes: true,
        message: "Log actualizado exitosamente",
        data: log,
      };
    } catch (error) {
      Logger.error({
        message: `[LOG_SERVICE] Error actualizando log`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al actualizar log",
        data: null,
      };
    }
  }

  async delete(id: string) {
    try {
      const log = await prismaClient.log.delete({
        where: {
          id,
        },
      });
      return {
        succes: true,
        message: "Log eliminado exitosamente",
        data: log,
      };
    } catch (error) {
      Logger.error({
        message: `[LOG_SERVICE] Error eliminando log`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al eliminar log",
        data: null,
      };
    }
  }
}

export const logService = new LogService();
