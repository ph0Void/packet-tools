import { Prisma } from "@/prisma/generated/browser";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

class TopologyService {
  async getAll(userId: string, page: number = 1, limit: number = 10) {
    try {
      const topologies = await prismaClient.topology.findMany({
        where: {
          ownerId: userId,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          owner: true,
        },
      });
      return {
        succes: true,
        message: "Topologías obtenidas exitosamente",
        data: topologies,
      };
    } catch (error) {
      Logger.error({
        message: `[TOPOLOGY_SERVICE] Error obteniendo topologías`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al obtener topologías",
        data: null,
      };
    }
  }

  async getById(id: string) {
    try {
      const topology = await prismaClient.topology.findUnique({
        where: {
          id,
        },
        include: {
          owner: true,
        },
      });
      return {
        succes: true,
        message: "Topología obtenida exitosamente",
        data: topology,
      };
    } catch (error) {
      console.error("Error al obtener la topología", error);
      return {
        succes: false,
        message: "Error al obtener topología",
        data: null,
      };
    }
  }

  async getLastOwnerTopology(userId: string) {
    try {
      const topology = await prismaClient.topology.findFirst({
        where: {
          ownerId: userId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      return {
        succes: true,
        message: "Última topología obtenida exitosamente",
        data: topology,
      };
    } catch (error) {
      Logger.error({
        message: `[TOPOLOGY_SERVICE] Error obteniendo última topología`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al obtener última topología",
        data: null,
      };
    }
  }

  async createOrUpdate(data: Prisma.TopologyCreateInput) {
    try {
      if (data.id) {
        const { id, ...updateData } = data;
        const topology = await prismaClient.topology.upsert({
          where: {
            id: id,
          },
          create: {
            id,
            ...updateData,
          },
          update: {
            ...updateData,
          },
        });
        return {
          succes: true,
          message: "Topología creada o actualizada exitosamente",
          data: topology,
        };
      } else {
        const topology = await prismaClient.topology.create({
          data: {
            ...data,
          },
        });
        return {
          succes: true,
          message: "Topología creada exitosamente",
          data: topology,
        };
      }
    } catch (error) {
      Logger.error({
        message: `[TOPOLOGY_SERVICE] Error creando o actualizando topología`,
        data: error,
      });

      return {
        succes: false,
        message: "Error al crear o actualizar topología " + data.name,
        data: null,
      };
    }
  }

  async delete(id: string) {
    try {
      const topology = await prismaClient.topology.delete({
        where: {
          id,
        },
      });
      return {
        succes: true,
        message: "Topología eliminada exitosamente",
        data: topology,
      };
    } catch (error) {
      Logger.error({
        message: `[TOPOLOGY_SERVICE] Error eliminando topología con id: ${id}`,
        data: error,
      });

      return {
        succes: false,
        message: "Error al eliminar topología",
        data: null,
      };
    }
  }
}

export const topologyService = new TopologyService();
