import schedule, { type Job as JobDeNodeSchedule } from "node-schedule";
import cronParser from "cron-parser";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import {
  cronExecutorService,
  type ResultadoEjecucion,
} from "@/service/CronExecutorService";

export interface JobProgramable {
  id: string;
  name: string;
  cronExpression: string | null;
  scheduledAt: Date | null;
  isActive: boolean;
  nextRun?: Date | null;
}

export interface InstantaneaProgramador {
  id: string;
  nombre: string;
  activa: boolean;

  proximaEjecucion: string | null;
  enEjecucion: boolean;
}

interface Armado {
  id: string;
  nombre: string;

  proxima: Date;
  job: JobDeNodeSchedule | null;
}

const armados = new Map<string, Armado>();

const enEjecucion = new Set<string>();

function claveDe(jobId: string): string {
  return `cronjob:${jobId}`;
}

function idDe(clave: string): string {
  return clave.startsWith("cronjob:") ? clave.slice("cronjob:".length) : clave;
}

export function calcularProximaEjecucion(job: JobProgramable): Date | null {
  const expresion = job.cronExpression?.trim();
  if (!expresion) {
    if (!job.scheduledAt) return null;
    const fecha = new Date(job.scheduledAt);
    if (Number.isNaN(fecha.getTime())) {
      Logger.error({
        message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) tiene un scheduledAt ilegible: ${String(job.scheduledAt)}`,
      });
      return null;
    }
    return fecha;
  }

  try {
    return cronParser.parse(expresion).next().toDate();
  } catch (error) {
    Logger.error({
      message: `[JOB_SCHEDULER] Expresión CRON inválida en '${job.name}' (${job.id}): '${expresion}'`,
      data: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function programarJob(jobId: string): Promise<void> {
  try {
    cancelarJob(jobId);

    const job = await prismaClient.cronJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    if (!job.isActive) {
      Logger.info({
        message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) está inactivo: no se programa.`,
      });
      return;
    }

    const fecha = calcularProximaEjecucion(job);
    if (!fecha) {
      Logger.warning({
        message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) no tiene fecha de ejecución calculable (cronExpression='${job.cronExpression}', scheduledAt=${String(job.scheduledAt)}); queda sin programar.`,
      });
      return;
    }
    if (fecha.getTime() <= Date.now()) {
      Logger.warning({
        message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) ya venció (${fecha.toISOString()}): no se rearma un temporizador imposible.`,
      });
      return;
    }

    if (!job.nextRun || job.nextRun.getTime() !== fecha.getTime()) {
      await prismaClient.cronJob.update({
        where: { id: jobId },
        data: { nextRun: fecha },
      });
    }

    const clave = claveDe(jobId);
    const jobProgramado = schedule.scheduleJob(clave, fecha, () => {
      void ejecutarYReplanificar(jobId);
    });
    armados.set(clave, { id: jobId, nombre: job.name, proxima: fecha, job: jobProgramado });

    Logger.info({
      message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) programado para ${fecha.toISOString()}.`,
    });
  } catch (error) {

    Logger.error({
      message: `[JOB_SCHEDULER] No se pudo programar el job '${jobId}'.`,
      data: error instanceof Error ? error.message : String(error),
    });
  }
}

export function cancelarJob(jobId: string): boolean {
  const clave = claveDe(jobId);
  armados.delete(clave);
  return schedule.cancelJob(clave);
}

export async function reprogramarJob(jobId: string): Promise<void> {
  cancelarJob(jobId);
  await programarJob(jobId);
}

export async function ejecutarYReplanificar(
  jobId: string,
): Promise<ResultadoEjecucion | null> {
  if (enEjecucion.has(jobId)) {
    Logger.warning({
      message: `[JOB_SCHEDULER] '${jobId}' ya está en ejecución: se descarta este disparo (guard de solape).`,
    });
    return null;
  }

  enEjecucion.add(jobId);
  try {
    return await cronExecutorService.executeJob(jobId);
  } catch (error) {

    Logger.error({
      message: `[JOB_SCHEDULER] Fallo inesperado ejecutando '${jobId}'.`,
      data: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    enEjecucion.delete(jobId);

    await reprogramarJob(jobId);
  }
}

export async function ejecutarJobAhora(
  jobId: string,
): Promise<ResultadoEjecucion | null> {
  const job = await prismaClient.cronJob.findUnique({
    where: { id: jobId },
    select: { id: true, name: true, isActive: true },
  });
  if (!job) return null;
  if (!job.isActive) {
    Logger.info({
      message: `[JOB_SCHEDULER] «Ejecutar Ahora» reactiva '${job.name}' (${job.id}) antes de ejecutarlo.`,
    });
    await prismaClient.cronJob.update({
      where: { id: jobId },
      data: { isActive: true, status: "PENDING" },
    });
  }
  return ejecutarYReplanificar(jobId);
}

export async function iniciarProgramador(): Promise<void> {
  const jobs = await prismaClient.cronJob.findMany({
    where: { isActive: true },
    orderBy: { nextRun: "asc" },
  });

  const vencidos: string[] = [];
  const proximas: { id: string; nombre: string; fecha: Date }[] = [];

  for (const job of jobs) {

    const fecha = job.nextRun ?? calcularProximaEjecucion(job);

    if (!fecha) {
      Logger.warning({
        message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) está activo pero no tiene ni nextRun ni una fecha calculable; queda sin programar.`,
        data: { cronExpression: job.cronExpression, scheduledAt: job.scheduledAt },
      });
      continue;
    }

    if (fecha.getTime() <= Date.now()) {

      vencidos.push(job.id);
      Logger.warning({
        message: `[JOB_SCHEDULER] '${job.name}' (${job.id}) tenía nextRun vencido (${fecha.toISOString()}): se recupera ejecutándolo una vez.`,
      });
      continue;
    }

    if (!job.nextRun) {
      await prismaClient.cronJob.update({
        where: { id: job.id },
        data: { nextRun: fecha },
      });
    }

    const clave = claveDe(job.id);
    const jobProgramado = schedule.scheduleJob(clave, fecha, () => {
      void ejecutarYReplanificar(job.id);
    });
    armados.set(clave, { id: job.id, nombre: job.name, proxima: fecha, job: jobProgramado });
    proximas.push({ id: job.id, nombre: job.name, fecha });
  }

  Logger.info({
    message: `[JOB_SCHEDULER] Planificador iniciado: ${armados.size} job(s) armado(s), ${vencidos.length} por recuperar.`,
    data: {
      totalActivos: jobs.length,
      programados: armados.size,
      aRecuperar: vencidos,
      masProximo: proximas[0]
        ? { nombre: proximas[0].nombre, proximaEjecucion: proximas[0].fecha.toISOString() }
        : null,
    },
  });

  if (vencidos.length > 0) {

    void (async () => {
      for (const jobId of vencidos) {
        await ejecutarYReplanificar(jobId).catch((error) =>
          Logger.error({
            message: `[JOB_SCHEDULER] La recuperación del job '${jobId}' falló.`,
            data: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    })();
  }
}

export function detenerProgramador(): void {
  try {
    for (const nombre of Object.keys(schedule.scheduledJobs ?? {})) {
      schedule.cancelJob(nombre);
    }
  } catch (error) {
    Logger.error({
      message: "[JOB_SCHEDULER] Error cancelando los temporizadores.",
      data: error instanceof Error ? error.message : String(error),
    });
  }
  armados.clear();
  enEjecucion.clear();
  Logger.info({
    message: "[JOB_SCHEDULER] Planificador detenido: temporizadores cancelados.",
  });
}

export function obtenerEnEjecucion(): string[] {
  return [...enEjecucion];
}

export function instantaneaProgramador(): InstantaneaProgramador[] {
  const filas = new Map<string, InstantaneaProgramador>();

  for (const armado of armados.values()) {
    filas.set(armado.id, {
      id: armado.id,
      nombre: armado.nombre,
      activa: true,
      proximaEjecucion: armado.proxima.toISOString(),
      enEjecucion: enEjecucion.has(armado.id),
    });
  }

  for (const id of enEjecucion) {
    if (filas.has(id)) continue;
    filas.set(id, {
      id,
      nombre: "(en ejecución)",
      activa: true,
      proximaEjecucion: null,
      enEjecucion: true,
    });
  }

  return [...filas.values()].sort((a, b) =>
    (a.proximaEjecucion ?? "9999").localeCompare(b.proximaEjecucion ?? "9999"),
  );
}

export const jobScheduler = {
  iniciarProgramador,
  programarJob,
  cancelarJob,
  reprogramarJob,
  ejecutarJobAhora,
  ejecutarYReplanificar,
  detenerProgramador,
  instantaneaProgramador,
  obtenerEnEjecucion,
  calcularProximaEjecucion,
} as const;
