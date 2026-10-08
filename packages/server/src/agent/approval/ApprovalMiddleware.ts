import {
  createMiddleware,
  ToolMessage,
  type AgentMiddleware,
} from "langchain";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { requestContext, type RequestUser } from "@/utils/RequestContext";
import { Logger } from "@/utils/Logger";
import { terminalSessionHub, buildTerminalFingerprint } from "@/sockets/TerminalSessionHub";
import { classifyCommands } from "../security/CommandClassifier";
import { resolveVendorForConsole } from "../terminal/vendorResolver";
import {
  getToolPolicy,
  type ToolPolicyEntry,
} from "../security/ToolPolicy";
import {
  approvalBroker,
  type ApprovalDecision,
  type ApprovalSnapshot,
} from "./ApprovalBroker";

export const APPROVAL_MESSAGE_PREFIXES = {
  rejected: "[APROBACION_RECHAZADA]",
  expired: "[APROBACION_EXPIRADA]",
  roleBlocked: "[BLOQUEADO_ROL]",
  sessionProtected: "[SESION_PROTEGIDA]",
} as const;

const CLI_DIRECT_CONNECTION_TOOLS = new Set([
  "send_command",
  "executeSshCommands",
  "executeTelnetCommands",
  "sendSerialCommand",
]);

const rejectionsByTool = new Map<string, number>();

export function resetApprovalAttempts(chatId?: string): void {
  if (!chatId) {
    rejectionsByTool.clear();
    return;
  }
  const prefijo = `${chatId}:`;
  for (const clave of rejectionsByTool.keys()) {
    if (clave.startsWith(prefijo)) rejectionsByTool.delete(clave);
  }
}

interface DeviceInfo {
  deviceName: string | null;
  protocol: string | null;

  fingerprint: string | null;
}

async function resolveDeviceInfo(providerId: string | null): Promise<DeviceInfo> {
  if (!providerId) {
    return { deviceName: null, protocol: null, fingerprint: null };
  }
  try {
    const device = await prismaClient.deviceProviders.findUnique({
      where: { id: providerId },
      select: {
        name: true,
        protocol: true,
        host: true,
        port: true,
        serialPort: true,
        serialBaudrate: true,
      },
    });
    return {
      deviceName: device?.name ?? null,
      protocol: device?.protocol ?? null,
      fingerprint: buildTerminalFingerprint({
        protocol: device?.protocol ?? null,
        host: device?.host || "localhost",
        port: device?.port ?? null,
        serialPort: device?.serialPort ?? null,
        baudRate: device?.serialBaudrate ?? null,
      }),
    };
  } catch (error) {
    Logger.warning({
      message: "[APPROVAL] No se pudo resolver el proveedor del dispositivo",
      data: { providerId, error },
    });
    return { deviceName: null, protocol: null, fingerprint: null };
  }
}

function splitCommandLines(value: string): string[] {
  return value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function extractCommands(
  policy: ToolPolicyEntry,
  args: Record<string, unknown>,
): string[] {
  if (!policy.commandsField) return [];
  const raw = args[policy.commandsField];
  if (typeof raw === "string") return splitCommandLines(raw);
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => splitCommandLines(value));
  }
  return [];
}

function buildSummary(
  policy: ToolPolicyEntry,
  commands: string[],
  deviceName: string | null,

  args?: Record<string, unknown>,
): string {
  const target = deviceName ? `«${deviceName}»` : "el dispositivo seleccionado";
  if (policy.kind === "cli") {
    const preview = commands.slice(0, 3).join(" ; ");
    const sufijo = commands.length > 3 ? " …" : "";
    return `${policy.label}: ejecutar ${commands.length} comando(s) de configuración en ${target} → ${preview}${sufijo}`;
  }
  if (policy.kind === "internal") {

    return `${policy.label}${describeArgs(args)}`;
  }
  return `${policy.label} en ${target}`;
}

function describeArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const claves = ["name", "id", "title", "systemPrompt"];
  const partes: string[] = [];
  for (const clave of claves) {
    const valor = args[clave];
    if (valor === undefined || valor === null || valor === "") continue;
    const texto = String(valor);
    partes.push(`${clave}=«${texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}»`);
  }
  return partes.length > 0 ? `: ${partes.join(", ")}` : "";
}

function emitTerminalCommand(
  ctx: RequestUser | undefined,
  toolCallId: string,
  toolName: string,
  commands: string[],
  device: DeviceInfo,
  providerId: string | null,
): void {
  if (!ctx?.approvalChannel) return;

  if (commands.length === 0) return;

  const routed = providerId
    ? terminalSessionHub.hasMatch(ctx.id, providerId, device.fingerprint)
    : (() => {
      const snapshot = ctx.terminalSessionId
        ? terminalSessionHub.getSnapshotForUser(ctx.id, ctx.terminalSessionId)
        : terminalSessionHub.getActiveSnapshot(ctx.id);
      return !!snapshot && snapshot.alive;
    })();
  ctx.approvalChannel.emit("terminal_command", {
    toolCallId,
    name: toolName,
    deviceName: device.deviceName,
    protocol: device.protocol,
    commands,
    routed,
  });
}

function emitAgentProgress(
  ctx: RequestUser | undefined,
  toolCallId: string,
  toolName: string,
  commands: string[],
): void {
  if (!ctx?.approvalChannel) return;

  if (commands.length === 0) return;
  ctx.approvalChannel.emit("agent_progress", {
    phase: "sending",
    toolCallId,
    name: toolName,
    detail: commands.slice(0, 2).join(" ; "),
  });
}

function buildBlockedText(
  prefix: string,
  policy: ToolPolicyEntry,
  attempts: number,
): string {
  const accion = `«${policy.label}»`;
  if (prefix === APPROVAL_MESSAGE_PREFIXES.roleBlocked) {
    return `${prefix} Tu rol (USER) no puede ejecutar acciones de configuración (${accion}). Explica al usuario que necesita rol STAFF o ADMIN y no intentes ejecutarla por otra vía.`;
  }
  if (prefix === APPROVAL_MESSAGE_PREFIXES.expired) {
    const base = `${prefix} La solicitud de aprobación de ${accion} expiró sin respuesta del usuario.`;
    return attempts >= 2
      ? `${base} Se acumulan ${attempts} intentos bloqueados: DETENTE, no vuelvas a llamar esta herramienta y pide al usuario que confirme manualmente si desea ejecutarla.`
      : `${base} No reintentes automáticamente: informa al usuario y espera su confirmación.`;
  }
  const base = `${prefix} El usuario rechazó la ejecución de ${accion}.`;
  return attempts >= 2
    ? `${base} Se acumulan ${attempts} rechazos: DETENTE por completo, no vuelvas a intentar esta acción ni variantes. Responde al usuario con el motivo del bloqueo.`
    : `${base} No insistas ni busques alternativas: informa al usuario que la acción fue cancelada y espera nuevas instrucciones.`;
}

export function createApprovalMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "ApprovalMiddleware",
    wrapToolCall: async (request, handler) => {
      const ctx = requestContext.getStore();
      const toolName = request.toolCall.name;
      const toolCallId = String(request.toolCall.id ?? "");
      const args = (request.toolCall.args ?? {}) as Record<string, unknown>;
      const providerId =
        typeof args.providerId === "string" ? args.providerId : null;
      const policy = getToolPolicy(toolName);
      const commands = extractCommands(policy, args);
      const isMutating =
        policy.access !== "readonly" && policy.kind !== "internal";

      const snapshot = ctx?.id
        ? ctx.terminalSessionId
          ? terminalSessionHub.getSnapshotForUser(ctx.id, ctx.terminalSessionId)
          : terminalSessionHub.getActiveSnapshot(ctx.id)
        : null;
      const prompt = snapshot?.prompt ?? null;

      const profile =
        commands.length > 0
          ? await resolveVendorForConsole({
              providerId:
                snapshot?.providerId ?? ctx?.connectionProviderId ?? null,
              prompt,
            })
          : undefined;

      const classification =
        commands.length > 0
          ? classifyCommands(commands, prompt, profile)
          : null;
      const isDangerous = !!classification?.dangerousCommands.length;

      const hayMezclaDeCierre =
        classification !== null &&
        classification.sessionCommands.length > 0 &&
        classification.sessionCommands.length < commands.length;
      const sufijoResumen = hayMezclaDeCierre
        ? " (se omitirán comandos de cierre de sesión)"
        : "";

      if (!toolCallId && isMutating) {
        return new ToolMessage({
          content: `${APPROVAL_MESSAGE_PREFIXES.rejected} No se pudo identificar la llamada a la herramienta; vuelve a intentarlo.`,
          tool_call_id: "",
          name: toolName,
          status: "error",
        });
      }

      if (ctx?.connectionProviderId && CLI_DIRECT_CONNECTION_TOOLS.has(toolName)) {
        const match = terminalSessionHub.findMatch(
          ctx.id,
          ctx.connectionProviderId,
          ctx.connectionFingerprint ?? null,
        );
        if (!match) {
          const mensaje = `La conexión seleccionada «${ctx.connectionName ?? ctx.connectionProviderId}» no tiene una consola abierta. Indica al usuario que conecte la consola del dispositivo y espera; no abras conexiones directas.`;
          ctx.approvalChannel?.emit("agent_progress", {
            phase: "terminal_required",
            detail: mensaje,
          });
          return new ToolMessage({
            content: JSON.stringify({
              success: false,
              code: "TERMINAL_REQUIRED",
              message: mensaje,
              suggestedProviderId: ctx.connectionProviderId,
            }),
            tool_call_id: toolCallId,
            name: toolName,
            status: "error",
          });
        }
      }

      if (ctx?.role === "USER" && policy.access === "mutating") {
        return new ToolMessage({
          content: buildBlockedText(
            APPROVAL_MESSAGE_PREFIXES.roleBlocked,
            policy,
            0,
          ),
          tool_call_id: toolCallId,
          name: toolName,
          status: "error",
        });
      }

      if (
        policy.kind === "cli" &&
        classification !== null &&
        commands.length > 0 &&
        !isDangerous &&
        classification.sessionCommands.length === commands.length
      ) {
        return new ToolMessage({
          content: `${APPROVAL_MESSAGE_PREFIXES.sessionProtected} Los comandos de cierre de sesión (exit/logout/quit/disconnect/close) están bloqueados en el prompt raíz: cerrarían la consola interactiva del usuario. Usa exit/quit solo dentro de un sub-modo de configuración (prompt de configuración anidado del equipo; en Cisco termina en ')#').`,
          tool_call_id: toolCallId,
          name: toolName,
          status: "error",
        });
      }

      if (
        policy.access === "readonly" ||
        policy.autoApprove === true ||
        (policy.kind === "internal" && policy.access !== "mutating")
      ) {
        if (policy.kind === "cli") {
          const device = await resolveDeviceInfo(providerId);
          emitTerminalCommand(
            ctx,
            toolCallId,
            toolName,
            commands,
            device,
            providerId,
          );
          emitAgentProgress(ctx, toolCallId, toolName, commands);
        }
        return handler(request);
      }

      if (policy.kind === "cli" && classification?.level === "readonly") {
        const device = await resolveDeviceInfo(providerId);
        emitTerminalCommand(
          ctx,
          toolCallId,
          toolName,
          commands,
          device,
          providerId,
        );
        emitAgentProgress(ctx, toolCallId, toolName, commands);
        return handler(request);
      }

      if (ctx?.autonomous === true && !isDangerous) {
        const device = await resolveDeviceInfo(providerId);
        emitTerminalCommand(
          ctx,
          toolCallId,
          toolName,
          commands,
          device,
          providerId,
        );
        if (policy.kind === "cli") {
          emitAgentProgress(ctx, toolCallId, toolName, commands);
        }
        Logger.info({
          message: "[APPROVAL] Acción mutante auto-aprobada (modo autónomo)",
          data: { toolName, toolCallId, providerId, commands },
        });
        return handler(request);
      }

      if (isDangerous && !ctx?.approvalChannel) {
        Logger.warning({
          message:
            "[APPROVAL] Comando destructivo bloqueado sin canal de aprobación",
          data: { toolName, toolCallId, userId: ctx?.id ?? null, providerId, commands },
        });
        return new ToolMessage({
          content: `${APPROVAL_MESSAGE_PREFIXES.rejected} Comando destructivo bloqueado fuera de una sesión interactiva: no hay un usuario que pueda aprobarlo. No reintentes esta acción; informa del bloqueo.`,
          tool_call_id: toolCallId,
          name: toolName,
          status: "error",
        });
      }

      if (!ctx?.approvalChannel) {
        const device = await resolveDeviceInfo(providerId);
        emitTerminalCommand(
          ctx,
          toolCallId,
          toolName,
          commands,
          device,
          providerId,
        );
        Logger.warning({
          message:
            "[APPROVAL] Herramienta mutante auto-aprobada sin canal de aprobación",
          data: { toolName, toolCallId, userId: ctx?.id ?? null, providerId, commands },
        });
        return handler(request);
      }

      const device = await resolveDeviceInfo(providerId);
      const summary = `${buildSummary(policy, commands, device.deviceName, request.toolCall?.args as Record<string, unknown> | undefined)}${sufijoResumen}`;
      const rejectionKey = `${ctx.approvalChannel.chatId}:${toolName}`;

      if ((rejectionsByTool.get(rejectionKey) ?? 0) >= 2) {
        return new ToolMessage({
          content: `${APPROVAL_MESSAGE_PREFIXES.rejected} Se alcanzó el límite de intentos bloqueados para esta acción; no insistas y explica al usuario.`,
          tool_call_id: toolCallId,
          name: toolName,
          status: "error",
        });
      }

      let approvalId = "";

      const decision: ApprovalDecision = await approvalBroker.request(
        {
          chatId: ctx.approvalChannel.chatId,
          userId: ctx.id,
          toolCallId,
          toolName,
          toolLabel: policy.label,
          commands,
          deviceName: device.deviceName,
          providerId,
          summary,
        },
        {
          onPending: (snapshot: ApprovalSnapshot) => {
            approvalId = snapshot.approvalId;
            ctx.approvalChannel?.emit("tool_approval_required", {
              approvalId: snapshot.approvalId,
              toolCallId,
              name: toolName,
              toolLabel: policy.label,
              level: "config",
              commands: snapshot.commands,
              deviceName: snapshot.deviceName,
              providerId,
              summary: snapshot.summary,
              expiresAt: new Date(snapshot.expiresAt).toISOString(),
              risk: isDangerous ? "dangerous" : "config",
            });
          },
        },
      );

      if (decision !== "approved") {
        const attempts = (rejectionsByTool.get(rejectionKey) ?? 0) + 1;
        rejectionsByTool.set(rejectionKey, attempts);
        ctx.approvalChannel.emit("tool_approval_resolved", {
          approvalId,
          toolCallId,
          decision,
        });
        const prefix =
          decision === "rejected"
            ? APPROVAL_MESSAGE_PREFIXES.rejected
            : APPROVAL_MESSAGE_PREFIXES.expired;
        return new ToolMessage({
          content: buildBlockedText(prefix, policy, attempts),
          tool_call_id: toolCallId,
          name: toolName,
          status: "error",
        });
      }

      rejectionsByTool.delete(rejectionKey);
      ctx.approvalChannel.emit("tool_approval_resolved", {
        approvalId,
        toolCallId,
        decision,
      });
      emitTerminalCommand(
        ctx,
        toolCallId,
        toolName,
        commands,
        device,
        providerId,
      );
      if (policy.kind === "cli") {
        emitAgentProgress(ctx, toolCallId, toolName, commands);
      }
      return handler(request);
    },
  });
}

export const approvalMiddleware = createApprovalMiddleware();
