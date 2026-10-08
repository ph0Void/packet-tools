import { Prisma } from "@/prisma/generated/browser";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

class AlertService {
  async getAllByUser(idUser: string, page: number, limit: number) {
    try {
      const user = await prismaClient.user.findUnique({
        where: {
          id: idUser,
        },
      });

      if (user?.role === "ADMIN" || user?.role === "STAFF") {
        const alert = await prismaClient.alert.findMany({
          skip: (page - 1) * limit,
          take: limit,
        });
        return {
          succes: true,
          message: "Alertas obtenidas exitosamente",
          data: alert,
        };
      }

      const alert = await prismaClient.alert.findMany({
        where: {
          userId: idUser,
        },
        skip: (page - 1) * limit,
        take: limit,
      });
      return {
        succes: true,
        message: "Alertas obtenidas exitosamente",
        data: alert,
      };
    } catch (error) {
      Logger.error({
        message: `[ALERT_SERVICE] Error al obtener las alertas`,
        data: {
          error,
        },
      });
      return {
        succes: false,
        message: "Error al obtener alertas",
        data: null,
      };
    }
  }

  async solveAlert(id: string) {
    try {
      const alert = await prismaClient.alert.update({
        where: {
          id,
        },
        data: {
          resolved: true,
        },
      });

      Logger.info({
        message: `[ALERT_SERVICE] Alerta resuelta exitosamente`,
        data: {
          id: alert.id,
          title: alert.title,
          date: alert.createdAt,
        },
      });

      return {
        succes: true,
        message: "Alerta resuelta exitosamente",
        data: alert,
      };
    } catch (error) {
      Logger.error({
        message: `[ALERT_SERVICE] Error al resolver la alerta`,
        data: error,
      });
      return {
        succes: false,
        message: "Error al resolver alerta",
        data: null,
      };
    }
  }

  async create(data: Prisma.AlertCreateInput) {
    try {
      const alert = await prismaClient.alert.create({
        data,
      });
      Logger.info({
        message: `[ALERT_SERVICE] Nueva alerta creada`,
        data: {
          id: alert.id,
          name: alert.title,
          date: alert.createdAt,
        },
      });
      return {
        succes: true,
        message: "Alerta creada exitosamente",
        data: alert,
      };
    } catch (error) {
      console.error("Error al crear la alerta", error);
      Logger.error({
        message: `[ALERT_SERVICE] Error al crear la alerta`,
        data: {
          error,
        },
      });
      return {
        succes: false,
        message: "Error al crear alerta",
        data: null,
      };
    }
  }

  async update(id: string, data: Prisma.AlertUpdateInput) {
    try {
      const alert = await prismaClient.alert.update({
        where: {
          id,
        },
        data,
      });

      Logger.info({
        message: `[ALERT_SERVICE] Alerta actualizada exitosamente`,
        data: {
          id: alert.id,
          title: alert.title,
          date: alert.createdAt,
        },
      });

      return {
        succes: true,
        message: "Alerta actualizada exitosamente",
        data: alert,
      };
    } catch (error) {
      Logger.error({
        message: `[ALERT_SERVICE] Error al actualizar la alerta`,
        data: {
          error,
        },
      });
      return {
        succes: false,
        message: "Error al actualizar alerta",
        data: null,
      };
    }
  }

  async delete(id: string) {
    try {
      const alert = await prismaClient.alert.delete({
        where: {
          id,
        },
      });

      Logger.info({
        message: `[ALERT_SERVICE] Alerta eliminada exitosamente`,
        data: {
          id: alert.id,
          title: alert.title,
          date: alert.createdAt,
        },
      });

      return {
        succes: true,
        message: "Alerta eliminada exitosamente",
        data: alert,
      };
    } catch (error) {
      Logger.error({
        message: `[ALERT_SERVICE] Error al eliminar la alerta`,
        data: {
          error,
        },
      });
      return {
        succes: false,
        message: "Error al eliminar alerta",
        data: null,
      };
    }
  }
}

export const alertService = new AlertService();
