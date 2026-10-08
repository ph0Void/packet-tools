import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { cronJobService } from "@/service/CronJobService";
import { deviceProviderService } from "@/service/DeviceProviderService";
import { configService } from "@/service/ConfigService";
import { requestContext } from "@/utils/RequestContext";
import { Gns3Client } from "@/client/Gns3Client";
import { SshClient } from "@/client/SshClient";
import { TelnetClient } from "@/client/TelnetClient";

class AdminError extends Error {}

interface AdminTurn {

  id: string;
  username: string;
  role: string;
  emit?: (event: string, data: unknown) => void;
}

function turno(): AdminTurn | null {
  return (requestContext.getStore() as AdminTurn | undefined) ?? null;
}

function exigeAdmin(operacion: string): AdminTurn {
  const ctx = turno();
  if (!ctx) throw new AdminError(`No hay contexto de turno para ${operacion}.`);
  if (ctx.role !== "ADMIN") {
    throw new AdminError(
      `Operación '${operacion}' reservada al rol ADMIN (rol actual: ${ctx.role}).`,
    );
  }
  return ctx;
}

function exigeStaff(operacion: string): AdminTurn {
  const ctx = turno();
  if (!ctx) throw new AdminError(`No hay contexto de turno para ${operacion}.`);
  if (ctx.role !== "ADMIN" && ctx.role !== "STAFF") {
    throw new AdminError(
      `Operación '${operacion}' requiere rol ADMIN o STAFF (rol actual: ${ctx.role}).`,
    );
  }
  return ctx;
}

async function auditar(params: {
  accion: string;
  objetivo: string;
  resultado: "ok" | "error";
  detalle?: unknown;
}): Promise<void> {
  const ctx = turno();
  const detalle =
    params.detalle === undefined
      ? ""
      : `\n${JSON.stringify(params.detalle, null, 2)}`;
  try {

    await prismaClient.log.create({
      data: {
        level: "ADMIN_ACTION",
        title: `${params.accion} → ${params.objetivo}`,
        content:
          `actor=${ctx?.username ?? "system"} (${ctx?.role ?? "?"}) ` +
          `resultado=${params.resultado}${detalle}`,
        userId: ctx?.id ?? null,
      },
    });
  } catch {

  }
  ctx?.emit?.("admin_action", {
    action: params.accion,
    target: params.objetivo,
    result: params.resultado,
  });
}

function responder<T>(fn: () => Promise<T>): Promise<string> {
  return (async () => {
    try {
      return JSON.stringify(await fn());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error inesperado";
      if (error instanceof AdminError) {
        return JSON.stringify({ success: false, error: message });
      }
      throw error;
    }
  })();
}

const listCronJobsTool = tool(
  async ({ filter }) => {
    const jobs = await prismaClient.cronJob.findMany({
      where: {
        ...(filter?.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...(filter?.actionType ? { actionType: filter.actionType } : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        cronExpression: true,
        scheduledAt: true,
        actionType: true,
        isActive: true,
        status: true,
        nextRun: true,
        lastRun: true,
        topologyId: true,
        deviceProviderId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return JSON.stringify({ success: true, count: jobs.length, jobs });
  },
  {
    name: "listCronJobs",
    description:
      "Lista las tareas programadas (cronjobs) del sistema con su estado, próxima ejecución y objetivo. Úsala antes de crear o modificar una para evitar duplicados.",
    schema: z.object({
      filter: z
        .object({
          isActive: z.boolean().optional(),
          actionType: z.enum(["STANDARD", "INTELLIGENT"]).optional(),
        })
        .optional(),
    }),
  },
);

const createCronJobTool = tool(
  async (args) =>
    responder(async () => {
      exigeStaff("createCronJob");

      const existente = await prismaClient.cronJob.findFirst({
        where: { name: args.name },
      });
      if (existente) {
        return {
          success: true,
          created: false,
          reason: "Ya existe una tarea con ese nombre; se devuelve la existente.",
          job: existente,
        };
      }
      const resultado = await cronJobService.create({
        name: args.name,
        description: args.description,
        prompt: args.prompt,
        cronExpression: args.cronExpression,
        scheduledAt: args.scheduledAt ? new Date(args.scheduledAt) : undefined,
        actionType: args.actionType ?? (args.prompt ? "INTELLIGENT" : "STANDARD"),
        payload: args.payload,
        isActive: args.isActive ?? true,
        topologyId: args.topologyId,
        deviceProviderId: args.deviceProviderId,
        userId: requestContext.getStore()?.id,
      } as never);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: "createCronJob",
        objetivo: args.name,
        resultado: "ok",
        detalle: { id: resultado.data?.id },
      });
      return { success: true, created: true, job: resultado.data };
    }),
  {
    name: "createCronJob",
    description:
      "Crea una tarea programada. Usa cronExpression para tareas recurrentes (p.ej. '0 3 * * *' = todos los días a las 3:00) o scheduledAt para una ejecución única. Si actionType es INTELLIGENT, `prompt` es la instrucción que ejecutará el agente. Es idempotente por nombre.",
    schema: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(500).optional(),
      cronExpression: z
        .string()
        .optional()
        .describe("Expresión cron de 5 campos. Omitir para ejecución única."),
      scheduledAt: z
        .string()
        .optional()
        .describe("ISO date para ejecución única. Omitir si hay cronExpression."),
      actionType: z.enum(["STANDARD", "INTELLIGENT"]).optional(),
      prompt: z
        .string()
        .max(4000)
        .optional()
        .describe("Instrucción para el agente cuando actionType=INTELLIGENT"),
      payload: z.record(z.string(), z.unknown()).optional(),
      topologyId: z.string().optional(),
      deviceProviderId: z.string().optional(),
      isActive: z.boolean().optional(),
    }),
  },
);

const updateCronJobTool = tool(
  async (args) =>
    responder(async () => {
      exigeStaff("updateCronJob");
      const actual = await cronJobService.findById(args.id);
      if (!actual.success || !actual.data) {
        throw new AdminError(`CronJob '${args.id}' no encontrado.`);
      }
      const resultado = await cronJobService.update(args.id, {
        name: args.name,
        description: args.description,
        prompt: args.prompt,
        cronExpression: args.cronExpression,

        scheduledAt: args.scheduledAt ? new Date(args.scheduledAt) : undefined,
        actionType: args.actionType,
        isActive: args.isActive,
      } as never);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: "updateCronJob",
        objetivo: args.name ?? actual.data.name,
        resultado: "ok",
      });
      return { success: true, job: resultado.data };
    }),
  {
    name: "updateCronJob",
    description:
      "Actualiza una tarea programada existente. Solo se modifican los campos indicados; el resto se conserva. Usa `cronExpression` para cambiar la recurrencia o `scheduledAt` (ISO) para reprogramar una ejecución única.",
    schema: z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(500).optional(),
      prompt: z.string().max(4000).optional(),
      cronExpression: z.string().optional(),
      scheduledAt: z
        .string()
        .optional()
        .describe("ISO date futura para una ejecución única. Sustituye al cronExpression."),
      actionType: z.enum(["STANDARD", "INTELLIGENT"]).optional(),
      isActive: z.boolean().optional(),
    }),
  },
);

const toggleCronJobTool = tool(
  async ({ id, isActive }) =>
    responder(async () => {
      exigeStaff("toggleCronJob");
      const resultado = await cronJobService.toggleStatus(id, isActive);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: isActive ? "enableCronJob" : "disableCronJob",
        objetivo: id,
        resultado: "ok",
      });
      return { success: true, job: resultado.data };
    }),
  {
    name: "toggleCronJob",
    description: "Activa o desactiva una tarea programada sin eliminarla.",
    schema: z.object({
      id: z.string().min(1),
      isActive: z.boolean(),
    }),
  },
);

const deleteCronJobTool = tool(
  async ({ id }) =>
    responder(async () => {

      exigeAdmin("deleteCronJob");
      const actual = await cronJobService.findById(id);
      if (!actual.success || !actual.data) {
        throw new AdminError(`CronJob '${id}' no encontrado.`);
      }
      const resultado = await cronJobService.delete(id);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: "deleteCronJob",
        objetivo: actual.data.name,
        resultado: "ok",
      });
      return { success: true, deletedId: id };
    }),
  {
    name: "deleteCronJob",
    description:
      "Elimina permanentemente una tarea programada. Es destructivo: requiere rol ADMIN y confirmación del usuario.",
    schema: z.object({ id: z.string().min(1) }),
  },
);

const listDeviceProvidersTool = tool(
  async ({ filter }) => {
    const providers = await prismaClient.deviceProviders.findMany({
      where: {
        ...(filter?.protocol ? { protocol: filter.protocol } : {}),
        ...(filter?.typeDevice ? { typeDevice: filter.typeDevice } : {}),
      },
      select: {
        id: true,
        name: true,
        typeDevice: true,
        protocol: true,
        host: true,
        port: true,
        serialPort: true,
        serialBaudrate: true,
        username: true,
        status: true,
        isTemporary: true,
        topologyId: true,
      },
      orderBy: { name: "asc" },
      take: 100,
    });

    return JSON.stringify({ success: true, count: providers.length, providers });
  },
  {
    name: "listDeviceProviders",
    description:
      "Lista las conexiones/dispositivos registrados (SSH, Telnet, serie, Packet Tracer, GNS3). No expone contraseñas.",
    schema: z.object({
      filter: z
        .object({
          protocol: z
            .enum(["SSH", "TELNET", "SERIAL", "SIMULATION"])
            .optional(),
          typeDevice: z
            .enum(["PACKET_TRACER", "GNS3", "CISCO", "HUAWEI", "ARUBA", "MIKROTIK", "GENERIC"])
            .optional(),
        })
        .optional(),
    }),
  },
);

const createDeviceProviderTool = tool(
  async (args) =>
    responder(async () => {
      exigeStaff("createDeviceProvider");
      const existente = await prismaClient.deviceProviders.findFirst({
        where: { name: args.name },
      });
      if (existente) {
        return {
          success: true,
          created: false,
          reason: "Ya existe una conexión con ese nombre.",
          provider: existente,
        };
      }
      const resultado = await deviceProviderService.create({
        name: args.name,
        typeDevice: args.typeDevice ?? "GENERIC",
        protocol: args.protocol,
        host: args.host,
        port: args.port,
        serialPort: args.serialPort,
        serialBaudrate: args.serialBaudrate,
        username: args.username,
        password: args.password,
      } as never);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: "createDeviceProvider",
        objetivo: args.name,
        resultado: "ok",

        detalle: { id: resultado.data?.id, protocol: args.protocol },
      });
      return { success: true, created: true, provider: resultado.data };
    }),
  {
    name: "createDeviceProvider",
    description:
      "Registra una nueva conexión (SSH, Telnet, puerto serie o simulación de Packet Tracer/GNS3). Es idempotente por nombre.",
    schema: z.object({
      name: z.string().min(1).max(200),
      protocol: z.enum(["SSH", "TELNET", "SERIAL", "SIMULATION"]),
      typeDevice: z
        .enum(["PACKET_TRACER", "GNS3", "CISCO", "HUAWEI", "ARUBA", "MIKROTIK", "GENERIC"])
        .optional(),
      host: z.string().max(300).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      serialPort: z.string().max(50).optional(),
      serialBaudrate: z.number().int().min(300).optional(),
      username: z.string().max(200).optional(),
      password: z.string().max(200).optional(),
    }),
  },
);

const updateDeviceProviderTool = tool(
  async (args) =>
    responder(async () => {
      exigeStaff("updateDeviceProvider");
      const resultado = await deviceProviderService.update(args.id, {
        name: args.name,
        protocol: args.protocol,
        host: args.host,
        port: args.port,
        serialPort: args.serialPort,
        serialBaudrate: args.serialBaudrate,
        username: args.username,
        password: args.password,
      } as never);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: "updateDeviceProvider",
        objetivo: args.id,
        resultado: "ok",
      });
      return { success: true, provider: resultado.data };
    }),
  {
    name: "updateDeviceProvider",
    description:
      "Actualiza una conexión existente (host, puerto, credenciales, puerto serie). Solo se modifican los campos indicados.",
    schema: z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(200).optional(),
      protocol: z.enum(["SSH", "TELNET", "SERIAL", "SIMULATION"]).optional(),
      host: z.string().max(300).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      serialPort: z.string().max(50).optional(),
      serialBaudrate: z.number().int().min(300).optional(),
      username: z.string().max(200).optional(),
      password: z.string().max(200).optional(),
    }),
  },
);

const deleteDeviceProviderTool = tool(
  async ({ id }) =>
    responder(async () => {

      exigeAdmin("deleteDeviceProvider");
      const actual = await deviceProviderService.getById(id);
      if (!actual.success || !actual.data) {
        throw new AdminError(`Conexión '${id}' no encontrada.`);
      }
      const resultado = await deviceProviderService.delete(id);
      if (!resultado.success) throw new AdminError(resultado.message);
      await auditar({
        accion: "deleteDeviceProvider",
        objetivo: actual.data.name,
        resultado: "ok",
      });
      return { success: true, deletedId: id };
    }),
  {
    name: "deleteDeviceProvider",
    description:
      "Elimina una conexión/dispositivo registrado. Es destructivo: requiere rol ADMIN y confirmación del usuario.",
    schema: z.object({ id: z.string().min(1) }),
  },
);

const testDeviceProviderConnectionTool = tool(
  async ({ id }) =>
    responder(async () => {
      exigeStaff("testDeviceProviderConnection");
      const provider = await prismaClient.deviceProviders.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          protocol: true,
          typeDevice: true,
          host: true,
          port: true,
        },
      });
      if (!provider) throw new AdminError(`Conexión '${id}' no encontrada.`);

      if (provider.typeDevice === "GNS3" || provider.protocol === "SIMULATION") {
        const cliente = await Gns3Client.forRequest(id);
        const resultado = await cliente.testConnection();
        return {
          success: resultado.ok !== false,
          protocol: provider.protocol,
          typeDevice: provider.typeDevice,
          detail: resultado,
        };
      }

      if (provider.protocol === "SSH") {
        const cliente = await SshClient.fromProviderId(id);
        try {
          await cliente.connect();
          await auditar({
            accion: "testDeviceProviderConnection",
            objetivo: provider.name,
            resultado: "ok",
          });
          return { success: true, protocol: "SSH", detail: "Conectado correctamente" };
        } finally {
          await cliente.disconnect();
        }
      }

      if (provider.protocol === "TELNET") {
        return {
          success: false,
          protocol: "TELNET",
          detail:
            "Abre la consola Telnet del dispositivo y vuelve a ejecutar la comprobación; la prueba automática requiere una sesión de terminal activa.",
        };
      }

      return {
        success: true,
        protocol: provider.protocol,
        detail: `Dispositivo ${provider.typeDevice} registrado; sin prueba de conectividad automática para este tipo.`,
      };
    }),
  {
    name: "testDeviceProviderConnection",
    description:
      "Comprueba si una conexión registrada responde (GNS3: endpoint de estado; SSH: conexión real de prueba). Para Telnet y serie requiere una consola ya abierta.",
    schema: z.object({ id: z.string().min(1) }),
  },
);

const updateGlobalSystemPromptTool = tool(
  async ({ systemPrompt }) =>
    responder(async () => {

      exigeAdmin("updateGlobalSystemPrompt");
      const config = await prismaClient.configuration.findFirst();
      if (!config) {
        throw new AdminError(
          "No existe la fila de configuración; créala desde /dashboard/configuration.",
        );
      }
      await configService.updateConfiguration(config.id, systemPrompt);
      await auditar({
        accion: "updateGlobalSystemPrompt",
        objetivo: "Configuration.systemPrompt",
        resultado: "ok",
        detalle: { chars: systemPrompt.length },
      });
      return { success: true, updated: true };
    }),
  {
    name: "updateGlobalSystemPrompt",
    description:
      "Reemplaza las instrucciones globales del sistema (se aplican a todos los agentes del sistema). Es un cambio de alcance GLOBAL: requiere rol ADMIN y confirmación.",
    schema: z.object({ systemPrompt: z.string().max(20000) }),
  },
);

const setAgentLogsEnabledTool = tool(
  async ({ enabled }) =>
    responder(async () => {
      exigeStaff("setAgentLogsEnabled");
      await configService.setAgentLogsEnabled(enabled);
      await auditar({
        accion: "setAgentLogsEnabled",
        objetivo: "Configuration.agentLogsEnabled",
        resultado: "ok",
        detalle: { enabled },
      });
      return { success: true, agentLogsEnabled: enabled };
    }),
  {
    name: "setAgentLogsEnabled",
    description:
      "Activa o desactiva el registro de la traza del agente agéntico (inicio/fin de turno, plan, delegación, tools, skills, RAG y aprobaciones) en el historial de auditoría. No borra la traza existente; solo deja de capturar la nueva. Es reversible y no necesita confirmación.",
    schema: z.object({ enabled: z.boolean() }),
  },
);

const getSystemMetricsTool = tool(
  async () =>
    responder(async () => {
      exigeStaff("getSystemMetrics");
      const [dispositivos, cronjobs, skills, datos, logs, usuarios] =
        await Promise.all([
          prismaClient.deviceProviders.count(),
          prismaClient.cronJob.count(),
          prismaClient.knowledgeBase.count({ where: { type: "SKILL" } }),
          prismaClient.knowledgeBase.count({ where: { type: "DATA" } }),
          prismaClient.log.count({ where: { level: "ADMIN_ACTION" } }),
          prismaClient.user.count(),
        ]);
      const activos = await prismaClient.cronJob.count({ where: { isActive: true } });
      return {
        success: true,
        metrics: {
          dispositivos,
          cronjobs,
          cronjobsActivos: activos,
          skills,
          documentosRag: datos,
          accionesAdminAuditadas: logs,
          usuarios,
        },
      };
    }),
  {
    name: "getSystemMetrics",
    description:
      "Devuelve contadores de estado del sistema (dispositivos, cronjobs, skills, documentos, acciones auditadas). Útil para responder preguntas como '¿qué hay dado de alta?'.",
    schema: z.object({}),
  },
);

export const SYSTEM_ADMIN_TOOLS = [
  listCronJobsTool,
  createCronJobTool,
  updateCronJobTool,
  toggleCronJobTool,
  deleteCronJobTool,
  listDeviceProvidersTool,
  createDeviceProviderTool,
  updateDeviceProviderTool,
  deleteDeviceProviderTool,
  testDeviceProviderConnectionTool,
  updateGlobalSystemPromptTool,
  setAgentLogsEnabledTool,
  getSystemMetricsTool,
] as const;

export const SYSTEM_ADMIN_TOOLS_ADMIN = SYSTEM_ADMIN_TOOLS;

export const SYSTEM_ADMIN_TOOLS_STAFF = SYSTEM_ADMIN_TOOLS.filter(
  (t) => t.name !== "deleteCronJob" && t.name !== "deleteDeviceProvider",
);
