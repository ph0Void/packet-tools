import { prismaClient } from "@/prisma/lib/PrismaClient";
import { CronJobType, Role } from "@/prisma/generated/enums";
import { Logger } from "@/utils/Logger";
import {
  cancelarJob,
  calcularProximaEjecucion,
  reprogramarJob,
} from "@/service/JobScheduler";

export interface CronJobData {
  name: string;
  description?: string | null;
  prompt?: string | null;
  cronExpression?: string | null;
  actionType?: CronJobType;
  scheduledAt?: Date | null;
  payload?: string | null;
  isActive?: boolean;
  topologyId?: string | null;
  deviceProviderId?: string | null;
  userId?: string | null;
}
export type CronJobUpdateData = Partial<CronJobData>;

const SIN_PROGRAMACION =
  "La tarea necesita una expresión CRON válida o una fecha de ejecución única (scheduledAt).";
const FECHA_NO_FUTURA = "La fecha de ejecución debe ser futura.";

type Validacion =
  | { ok: true; nextRun: Date | null }
  | { ok: false; message: string };

function validarCron(cronExpression: string): Date | null | string {
  const fecha = calcularProximaEjecucion({
    id: "validacion",
    name: "validacion",
    cronExpression,
    scheduledAt: null,
    isActive: true,
  });
  if (fecha) return fecha;
  return "Expresión CRON inválida.";
}

function validarProgramacion(
  cronExpression: string | null,
  scheduledAt: Date | null,
  exigirFutura = true,
): Validacion {
  const expresion = cronExpression?.trim() || null;
  if (expresion) {
    const fecha = validarCron(expresion);
    if (typeof fecha === "string") return { ok: false, message: fecha };
    return { ok: true, nextRun: fecha };
  }

  if (scheduledAt instanceof Date && !Number.isNaN(scheduledAt.getTime())) {
    if (exigirFutura && scheduledAt.getTime() <= Date.now()) {
      return { ok: false, message: FECHA_NO_FUTURA };
    }
    return { ok: true, nextRun: scheduledAt };
  }

  return { ok: false, message: SIN_PROGRAMACION };
}

class CronJobService {
  async findAllByUser(userId: string) {
    try {
      const cronJobs = await prismaClient.cronJob.findMany({
        where: { userId },
        include: {
          topology: true,
          deviceProvider: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return {
        success: true,
        message: "Tareas programadas obtenidas",
        data: cronJobs,
      };
    } catch (error) {
      console.error("Error consultando tareas por usuario:", error);
      return {
        success: false,
        message: "Error consultando las tareas programadas",
        data: null,
      };
    }
  }

  async findAll() {
    try {
      const cronJobs = await prismaClient.cronJob.findMany({
        include: {
          user: { select: { id: true, username: true, role: true } },
          topology: true,
          deviceProvider: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return {
        success: true,
        message: "Todas las tareas programadas obtenidas",
        data: cronJobs,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error consultando todas las tareas`,
        data: error,
      });
      return {
        success: false,
        message: "Error al obtener las tareas",
        data: null,
      };
    }
  }

  async findAllVisible(user: { id: string; role: string }) {
    try {
      const cronJobs = await prismaClient.cronJob.findMany({
        where: user.role === Role.ADMIN || user.role === Role.STAFF ? {} : { userId: user.id },
        include: {
          topology: true,
          deviceProvider: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return {
        success: true,
        message: "Trabajos obtenidos",
        data: cronJobs,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error listando los trabajos visibles`,
        data: error,
      });
      return {
        success: false,
        message: "Error al obtener los trabajos",
        data: null,
      };
    }
  }

  async findVisibleById(id: string, user: { id: string; role: string }) {
    try {
      const cronJob = await prismaClient.cronJob.findFirst({
        where: {
          id,
          ...(user.role === Role.ADMIN || user.role === Role.STAFF
            ? {}
            : { userId: user.id }),
        },
        include: { topology: true, deviceProvider: true },
      });
      return {
        success: true,
        message: "Trabajo obtenido",
        data: cronJob,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error consultando el trabajo '${id}'`,
        data: error,
      });
      return {
        success: false,
        message: "Error al consultar el trabajo",
        data: null,
      };
    }
  }

  async findById(id: string) {
    try {
      const cronJob = await prismaClient.cronJob.findUnique({
        where: { id },
        include: { topology: true, deviceProvider: true },
      });
      return {
        success: true,
        message: "Tarea obtenida correctamente",
        data: cronJob,
      };
    } catch (error) {
      console.error("Error consultando la tarea:", error);
      return {
        success: false,
        message: "Error al consultar la tarea",
        data: null,
      };
    }
  }

  async create(data: CronJobData) {
    try {
      const cronExpression = data.cronExpression?.trim() || null;
      const scheduledAt = data.scheduledAt ?? null;
      const isActive = data.isActive ?? true;

      const validacion = validarProgramacion(cronExpression, scheduledAt);
      if (!validacion.ok) {
        return { success: false, message: validacion.message, data: null };
      }

      const cronJob = await prismaClient.cronJob.create({
        data: {
          ...data,
          cronExpression,
          scheduledAt,
          isActive,

          nextRun: isActive ? validacion.nextRun : null,
          status: isActive ? "PENDING" : "CANCEL",
        },
      });

      await reprogramarJob(cronJob.id);

      return {
        success: true,
        message: "Tarea programada creada correctamente",
        data: cronJob,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error creando tarea programada`,
        data: error,
      });
      return {
        success: false,
        message: "Error al crear la tarea programada",
        data: null,
      };
    }
  }

  async update(idCron: string, data: CronJobUpdateData) {
    try {
      const actual = await prismaClient.cronJob.findUnique({ where: { id: idCron } });
      if (!actual) {
        return { success: false, message: "Tarea no encontrada.", data: null };
      }

      const tocaCron = data.cronExpression !== undefined;
      const tocaFecha = data.scheduledAt !== undefined;
      const tocaActivo = data.isActive !== undefined;

      let cronExpression = tocaCron ? data.cronExpression?.trim() || null : actual.cronExpression;

      let scheduledAt = tocaCron ? null : tocaFecha ? data.scheduledAt ?? null : actual.scheduledAt;
      if (tocaFecha && data.scheduledAt) cronExpression = null;

      const isActive = tocaActivo ? Boolean(data.isActive) : actual.isActive;

      if (!isActive) {
        const desactivada = await prismaClient.cronJob.update({
          where: { id: idCron },
          data: {
            ...data,
            isActive: false,
            status: "CANCEL",
            nextRun: null,
          },
        });
        await reprogramarJob(idCron);
        return {
          success: true,
          message: "Tarea programada actualizada",
          data: desactivada,
        };
      }

      const validacion = validarProgramacion(cronExpression, scheduledAt);
      if (!validacion.ok) {
        return { success: false, message: validacion.message, data: null };
      }

      const actualizada = await prismaClient.cronJob.update({
        where: { id: idCron },
        data: {
          ...data,
          cronExpression,
          scheduledAt,
          isActive: true,
          nextRun: validacion.nextRun,
          status: "PENDING",
        },
      });

      await reprogramarJob(idCron);

      return {
        success: true,
        message: "Tarea programada actualizada",
        data: actualizada,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error actualizando tarea programada`,
        data: error,
      });

      return {
        success: false,
        message: "Error al actualizar la tarea programada",
        data: null,
      };
    }
  }

  async delete(idCronJob: string) {
    try {
      const cronJob = await prismaClient.cronJob.delete({
        where: { id: idCronJob },
      });

      cancelarJob(idCronJob);
      Logger.info({
        message: `[CRON_JOB_SERVICE] Tarea programada eliminada`,
        data: cronJob,
      });
      return {
        success: true,
        message: "Tarea programada eliminada",
        data: cronJob,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error eliminando tarea programada`,
        data: error,
      });
      return {
        success: false,
        message: "Error al eliminar la tarea programada",
        data: null,
      };
    }
  }

  async toggleStatus(idCronJob: string, isActive: boolean) {
    try {
      const actual = await prismaClient.cronJob.findUnique({ where: { id: idCronJob } });
      if (!actual) {
        return { success: false, message: "Tarea no encontrada.", data: null };
      }

      if (!isActive) {
        const desactivada = await prismaClient.cronJob.update({
          where: { id: idCronJob },
          data: { isActive: false, status: "CANCEL", nextRun: null },
        });
        await reprogramarJob(idCronJob);
        return {
          success: true,
          message: "Estado de la tarea actualizado",
          data: desactivada,
        };
      }

      const validacion = validarProgramacion(actual.cronExpression, actual.scheduledAt, false);
      if (!validacion.ok) {
        return { success: false, message: validacion.message, data: null };
      }
      if (!validacion.nextRun) {
        return { success: false, message: SIN_PROGRAMACION, data: null };
      }
      if (validacion.nextRun.getTime() <= Date.now()) {
        return {
          success: false,
          message:
            `No se puede activar: la ejecución única ya venció (${validacion.nextRun.toISOString()}). ` +
            "Vuelve a programarla con una fecha futura o conviértela en una tarea recurrente.",
          data: null,
        };
      }

      const activada = await prismaClient.cronJob.update({
        where: { id: idCronJob },
        data: {
          isActive: true,
          status: "PENDING",
          nextRun: validacion.nextRun,
        },
      });
      await reprogramarJob(idCronJob);
      return {
        success: true,
        message: "Estado de la tarea actualizado",
        data: activada,
      };
    } catch (error) {
      Logger.error({
        message: `[CRON_JOB_SERVICE] Error cambiando estado de la tarea`,
        data: error,
      });
      return {
        success: false,
        message: "Error al cambiar el estado de la tarea",
        data: null,
      };
    }
  }
}

export const cronJobService = new CronJobService();
