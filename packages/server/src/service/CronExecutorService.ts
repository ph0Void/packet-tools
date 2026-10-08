import { prismaClient } from "@/prisma/lib/PrismaClient";
import { invokeTurn } from "@/agent/deep/turn";
import {
  registrarFinDeTurno,
  registrarInicioDeTurno,
  type ContextoLogAgente,
} from "@/agent/deep/agentLog";
import { HumanMessage } from "@langchain/core/messages";
import { Logger } from "@/utils/Logger";
import { formatDate } from "@/utils/FormatDate";
import { requestContext } from "@/utils/RequestContext";
import { calcularProximaEjecucion } from "@/service/JobScheduler";
import {
  ejecutarComandosDeJob,
  MAX_SALIDA_STANDARD,
} from "@/service/CronCommandRunner";

export interface ResultadoEjecucion {
  jobId: string;
  nombre: string;

  ejecutado: boolean;
  ok: boolean;
  error?: string;
  duracionMs: number;
  salida?: string;
}

const MAX_SALIDA = MAX_SALIDA_STANDARD;

function recortar(texto: string): string {
  const limpio = String(texto ?? "");
  if (limpio.length <= MAX_SALIDA) return limpio;
  return `${limpio.slice(0, MAX_SALIDA)}… [salida recortada: ${limpio.length} caracteres]`;
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "error desconocido");
}

class CronExecutorService {

  async executeJob(cronJobId: string): Promise<ResultadoEjecucion> {
    const inicio = Date.now();
    const vacio = (
      nombre: string,
      ejecutado: boolean,
      ok: boolean,
      error?: string,
      salida?: string,
    ): ResultadoEjecucion => ({
      jobId: cronJobId,
      nombre,
      ejecutado,
      ok,
      duracionMs: Date.now() - inicio,
      ...(error ? { error } : {}),
      ...(salida ? { salida } : {}),
    });

    const job = await prismaClient.cronJob.findUnique({
      where: { id: cronJobId },
      include: { topology: true, deviceProvider: true },
    });

    if (!job) {
      Logger.warning({
        message: `[CRON_EXECUTOR_SERVICE] El job '${cronJobId}' ya no existe: nada que ejecutar.`,
      });
      return vacio("", false, false, "El trabajo ya no existe.");
    }
    if (!job.isActive) {
      Logger.info({
        message: `[CRON_EXECUTOR_SERVICE] '${job.name}' (${job.id}) está inactivo: no se ejecuta.`,
      });
      return vacio(job.name, false, false, "El trabajo está desactivado.");
    }

    const esUnaVez = job.cronExpression == null;
    const nombre = job.name;

    await prismaClient.cronJob.update({
      where: { id: cronJobId },
      data: { status: "RUNNING", lastRun: new Date() },
    });

    let contexto: ContextoLogAgente | null = null;
    let inicioTurnoCron = Date.now();

    let turnoCerrado = false;

    try {
      let salida: string | undefined;
      if (job.actionType === "INTELLIGENT") {
        salida = await this.ejecutarInteligente(
          job,
          (contextoCron, prompt) => {
            contexto = contextoCron;
            inicioTurnoCron = Date.now();
            registrarInicioDeTurno(contextoCron, { prompt, ruta: "supervisor" });
          },
          (contextoCron, salidaTurno) => {
            registrarFinDeTurno(contextoCron, {
              resultado: "completo",
              duracionMs: Date.now() - inicioTurnoCron,

              toolCalls: 0,
              respuesta: salidaTurno,
            });
            turnoCerrado = true;
          },
        );
      } else {
        const resultado = await ejecutarComandosDeJob({
          id: job.id,
          name: job.name,
          payload: job.payload,
          deviceProviderId: job.deviceProviderId,
          deviceProvider: job.deviceProvider
            ? {
                id: job.deviceProvider.id,
                name: job.deviceProvider.name,
                protocol: job.deviceProvider.protocol,
                typeDevice: job.deviceProvider.typeDevice,
              }
            : null,
        });
        if (!resultado.ok) {
          throw new Error(resultado.error ?? "STANDARD terminó sin ejecutar nada.");
        }
        salida = resultado.salida;
      }

      const salidaFinal = recortar(salida ?? "");

      await this.escribirLog({
        ...(job.topologyId ? { topologyId: job.topologyId } : {}),
        level: "CRON_EXECUTION",
        title: `CronJob ${job.actionType === "INTELLIGENT" ? "Inteligente" : "Estándar"}: ${job.name}`,
        content:
          job.actionType === "INTELLIGENT"
            ? `Resultado de la IA:\n${salidaFinal}`
            : salidaFinal,

        userId: job.topology?.ownerId ?? job.userId ?? null,
      });

      await this.persistirEstado(job, esUnaVez, "SUCCESS");
      Logger.info({
        message: "[CRON_EXECUTOR_SERVICE] CronJob ejecutado exitosamente",
        data: { id: job.id, name: job.name, date: new Date(), actionType: job.actionType },
      });

      return vacio(nombre, true, true, undefined, salidaFinal);
    } catch (error) {
      const mensaje = mensajeDe(error);
      Logger.error({
        message: `[CRON_EXECUTOR_SERVICE] CronJob '${job.name}' (${job.id}) falló: ${mensaje}`,
      });

      await this.persistirEstado(job, esUnaVez, "FAILED");

      if (contexto && !turnoCerrado) {
        registrarFinDeTurno(contexto, {
          resultado: "error",
          duracionMs: Date.now() - inicioTurnoCron,
          toolCalls: 0,
          error: mensaje,
        });
      }

      await this.escribirLog({
        ...(job.topologyId ? { topologyId: job.topologyId } : {}),
        level: "ERROR",
        title: `Falló CronJob: ${job.name}`,
        content: `Error al intentar ejecutar el cron job: Id: ${job.id} - Titulo: ${job.name} - Hora: ${formatDate(job.createdAt)} - Motivo: ${mensaje}`,
        userId: job.topology?.ownerId ?? job.userId ?? null,
      });

      return vacio(nombre, true, false, mensaje);
    }
  }

  private async escribirLog(data: {
    topologyId?: string;
    level: string;
    title: string;
    content: string;
    userId: string | null;
  }): Promise<void> {
    try {
      await prismaClient.log.create({ data });
    } catch (error) {
      Logger.error({
        message: "[CRON_EXECUTOR_SERVICE] No se pudo escribir el log del cron.",
        data: mensajeDe(error),
      });
    }
  }

  private async persistirEstado(
    job: { id: string; name: string; cronExpression: string | null; scheduledAt: Date | null },
    esUnaVez: boolean,
    resultado: "SUCCESS" | "FAILED",
  ): Promise<void> {

    try {
      if (esUnaVez) {

        await prismaClient.cronJob.update({
          where: { id: job.id },
          data:
            resultado === "SUCCESS"
              ? { status: "SUCCESS", isActive: false, nextRun: null }
              : { status: "FAILED", isActive: false, nextRun: null },
        });
        return;
      }

      const siguiente = calcularProximaEjecucion({
        id: job.id,
        name: job.name,
        cronExpression: job.cronExpression,
        scheduledAt: job.scheduledAt,
        isActive: true,
      });
      await prismaClient.cronJob.update({
        where: { id: job.id },
        data: { status: "PENDING", isActive: true, nextRun: siguiente },
      });
    } catch (error) {
      Logger.error({
        message: `[CRON_EXECUTOR_SERVICE] No se pudo guardar el estado final del job '${job.id}'.`,
        data: mensajeDe(error),
      });
    }
  }

  private async ejecutarInteligente(
    job: {
      id: string;
      prompt: string | null;
      deviceProvider: { typeDevice: string | null } | null;
    },
    alIniciar: (contexto: ContextoLogAgente, prompt: string) => void,
    alTerminar: (contexto: ContextoLogAgente, salida: string) => void,
  ): Promise<string> {
    if (!job.prompt) {
      throw new Error("El CronJob inteligente requiere un prompt de instrucción.");
    }
    const prompt = job.prompt;

    const contexto: ContextoLogAgente = {
      userId: null,
      chatId: `cron-${job.id}`,
      threadId: `cron-${job.id}`,
      actor: { username: "cron", role: "ADMIN" },
      origen: "cron",
      modelo: job.deviceProvider?.typeDevice,
    };
    alIniciar(contexto, prompt);

    const { messages } = await requestContext.run(
      { id: "system", username: "cron", role: "ADMIN" },
      async () =>
        invokeTurn({
          messages: [new HumanMessage(prompt)],
          chatId: `cron-${job.id}`,
          messageId: String(Date.now()),
          role: "ADMIN",
          provider: job.deviceProvider?.typeDevice || "PACKET_TRACER",
          ragPrefetched: false,
          webRequired: false,
          origin: "chat",
        }),
    );

    const lastMessage = messages[messages.length - 1];
    const salida = lastMessage
      ? typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content)
      : "";

    alTerminar(contexto, salida);
    return salida;
  }
}

export const cronExecutorService = new CronExecutorService();
