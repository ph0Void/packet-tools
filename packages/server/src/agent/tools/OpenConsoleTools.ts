import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Gns3Client } from "@/client/Gns3Client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  terminalOpenBroker,
  type TerminalOpenPayload,
  type TerminalOpenResolution,
} from "@/agent/approval/TerminalOpenBroker";
import {
  buildTerminalFingerprint,
  terminalSessionHub,
  type TerminalSession,
} from "@/sockets/TerminalSessionHub";
import { requestContext } from "@/utils/RequestContext";

const TTL_APERTURA_MS = 60 * 1000;

const ESPERA_SESION_MS = 10_000;

const ESPERA_PROMPT_MS = 5_000;

function extraerToolCallId(runtime: unknown): string {
  const candidato = runtime as
    | { toolCallId?: unknown; toolCall?: { id?: unknown } }
    | undefined;
  const id = candidato?.toolCallId ?? candidato?.toolCall?.id;
  return typeof id === "string" ? id : "";
}

export async function solicitarApertura(params: {
  toolName: string;
  summary: string;
  payload: TerminalOpenPayload;
  toolCallId: string;
}): Promise<TerminalOpenResolution> {
  const ctx = requestContext.getStore();
  const chatId = ctx?.approvalChannel?.chatId;
  if (!ctx || !chatId) {
    throw new Error("La apertura de consola requiere un chat interactivo.");
  }

  let requestId = "";

  const resultado = await terminalOpenBroker.request(
    {
      chatId,
      userId: ctx.id,
      toolCallId:
        params.toolCallId ||
        `open-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolName: params.toolName,
      summary: params.summary,
      payload: params.payload,
    },
    {
      ttlMs: TTL_APERTURA_MS,
      onPending: (snapshot) => {
        requestId = snapshot.requestId;
        ctx.approvalChannel?.emit("terminal_open_requested", {
          requestId: snapshot.requestId,
          toolCallId: params.toolCallId || undefined,
          toolName: params.toolName,
          summary: snapshot.summary,
          autoOpen: ctx.autonomous === true,
          payload: snapshot.payload,
        });
      },
    },
  );

  ctx.approvalChannel?.emit("terminal_open_resolved", {
    requestId,
    accepted: resultado.accepted,
    sessionId: resultado.sessionId ?? undefined,
    error: resultado.error ?? undefined,
  });

  return resultado;
}

export async function esperarSesion(
  userId: string,
  providerId: string | null,
  fingerprint: string | null,
  timeoutMs: number = ESPERA_SESION_MS,
): Promise<TerminalSession | null> {
  const inicio = Date.now();
  while (true) {
    const sesion = terminalSessionHub.findMatch(userId, providerId, fingerprint);
    if (sesion) return sesion;
    if (Date.now() - inicio >= timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function resultadoRechazo(resultado: TerminalOpenResolution): string {
  const mensaje =
    resultado.error === "expired"
      ? "La confirmación para abrir la consola expiró sin respuesta del usuario."
      : "El usuario rechazó/canceló la apertura de la consola.";
  return JSON.stringify({ success: false, message: mensaje });
}

async function aplicarSesionConfirmada(
  resultado: TerminalOpenResolution,
  payload: TerminalOpenPayload,
  fingerprint: string | null,
): Promise<string> {
  const ctx = requestContext.getStore();
  if (!ctx?.id) {
    return JSON.stringify({
      success: true,
      message: "Consola confirmada, pero aún no aparece registrada.",
      sessionId: null,
    });
  }

  let sessionId = resultado.sessionId ?? null;
  if (!sessionId) {
    const sesion = await esperarSesion(
      ctx.id,
      payload.providerId ?? null,
      fingerprint,
      ESPERA_SESION_MS,
    );
    sessionId = sesion?.socketId ?? null;
  }

  if (!sessionId) {
    return JSON.stringify({
      success: true,
      message: "Consola confirmada, pero aún no aparece registrada.",
      sessionId: null,
    });
  }

  ctx.terminalSessionId = sessionId;

  const session = terminalSessionHub.get(sessionId);
  if (!session) {
    return JSON.stringify({
      success: true,
      sessionId,
      message: "Consola confirmada; la sesión aún no expone información.",
    });
  }

  const snapshot = await terminalSessionHub.waitForPrompt(session, {
    timeoutMs: ESPERA_PROMPT_MS,
  });

  return JSON.stringify({
    success: true,
    sessionId,
    prompt: snapshot.prompt,
    lines: snapshot.lastLines.slice(-40),
  });
}

type TipoConsola = "SSH" | "TELNET" | "SERIAL";

function normalizarTipo(
  valor: string | null | undefined,
  tieneSerial: boolean,
): TipoConsola | null {
  const tipo = String(valor ?? "").trim().toUpperCase();
  if (tipo === "SSH" || tipo === "TELNET" || tipo === "SERIAL") return tipo;
  if (tieneSerial) return "SERIAL";
  return null;
}

async function buscarProviderSerial(serialPort: string) {
  const candidatos = await prismaClient.deviceProviders.findMany({
    where: { protocol: "SERIAL", serialPort: { not: null } },
  });
  const buscado = serialPort.trim().toUpperCase();
  return (
    candidatos.find(
      (proveedor) =>
        String(proveedor.serialPort ?? "").trim().toUpperCase() === buscado,
    ) ?? null
  );
}

async function buscarProviderPorHost(host: string, port?: number) {
  return prismaClient.deviceProviders.findFirst({
    where: {
      host: { equals: host.trim() },
      ...(typeof port === "number" ? { port } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

function resumirApertura(payload: TerminalOpenPayload): string {
  if (payload.type === "SERIAL") {
    return `Abrir consola serial ${payload.serialPort} (${payload.baudRate ?? 9600} baudios)`;
  }
  const protocolo = payload.type === "SSH" ? "SSH" : "Telnet";
  return `Abrir consola ${protocolo} a ${payload.host}:${payload.port}`;
}

export const openTerminalConsoleTool = tool(
  async (input, runtime) => {
    const { providerId, protocol, host, port, username, serialPort, baudRate } =
      input;

    let provider = null;
    if (providerId) {
      provider = await prismaClient.deviceProviders.findUnique({
        where: { id: providerId },
      });
      if (!provider) {
        throw new Error(
          `No existe el dispositivo proveedor '${providerId}'. Usa listDeviceProviders para ver los dispositivos reales.`,
        );
      }
    } else if (serialPort) {
      provider = await buscarProviderSerial(serialPort);
      if (!provider) {

        provider = await prismaClient.deviceProviders.create({
          data: {
            name: `${serialPort.trim().toUpperCase()} (temporal)`,
            typeDevice: "GENERIC",
            protocol: "SERIAL",
            serialPort: serialPort.trim(),
            serialBaudrate: baudRate ?? 9600,
            status: "OFFLINE",
            isTemporary: true,
          },
        });
      }
    } else if (host) {
      provider = await buscarProviderPorHost(host, port);
    } else {
      throw new Error(
        "Indica 'providerId' o los datos de conexión ('serialPort' para serial, 'host'/'port' para SSH/Telnet) para abrir la consola.",
      );
    }

    const tipo = normalizarTipo(protocol ?? provider?.protocol ?? null, Boolean(
      serialPort ?? provider?.serialPort,
    ));
    if (!tipo) {
      throw new Error(
        `El dispositivo '${provider?.name ?? providerId ?? host ?? serialPort}' no tiene un protocolo de consola soportado (SSH, Telnet o Serial).`,
      );
    }

    const payload: TerminalOpenPayload = { providerId: provider?.id, type: tipo };
    const nombreVisible = provider?.name ?? input.deviceName ?? null;
    if (nombreVisible) payload.deviceName = nombreVisible;

    if (tipo === "SERIAL") {
      const puertoSerial = (serialPort ?? provider?.serialPort ?? "").trim();
      if (!puertoSerial) {
        throw new Error(
          "El dispositivo no tiene un puerto serial configurado: indica 'serialPort' (p. ej. COM6).",
        );
      }
      payload.serialPort = puertoSerial;
      payload.baudRate = baudRate ?? provider?.serialBaudrate ?? 9600;
    } else {
      const hostFinal = (host ?? provider?.host ?? "").trim();
      if (!hostFinal) {
        throw new Error(
          `El dispositivo '${nombreVisible ?? providerId}' no tiene host configurado: indica 'host' (y 'port' si aplica).`,
        );
      }
      payload.host = hostFinal;
      payload.port = port ?? provider?.port ?? (tipo === "SSH" ? 22 : 23);
      const usuarioFinal = username ?? provider?.username ?? null;
      if (usuarioFinal) payload.username = usuarioFinal;
    }

    const fingerprint = buildTerminalFingerprint({
      protocol: payload.type,
      host: payload.host ?? null,
      port: payload.port ?? null,
      serialPort: payload.serialPort ?? null,
      baudRate: payload.baudRate ?? null,
    });

    const resultado = await solicitarApertura({
      toolName: "open_terminal_console",
      summary: resumirApertura(payload),
      payload,
      toolCallId: extraerToolCallId(runtime),
    });

    if (!resultado.accepted) return resultadoRechazo(resultado);
    return aplicarSesionConfirmada(resultado, payload, fingerprint);
  },
  {
    name: "open_terminal_console",
    description:
      "Ask the user to open a persistent SSH/Telnet/serial console in the dashboard and wait for confirmation. After it opens, operate with send_command/read_terminal/wait_for_prompt instead of opening parallel connections.",
    schema: z.object({
      providerId: z
        .string()
        .optional()
        .describe(
          "Registered provider id (from listDeviceProviders)",
        ),
      protocol: z
        .enum(["SSH", "TELNET", "SERIAL"])
        .optional()
        .describe("Console protocol to open (defaults to the provider protocol)"),
      host: z
        .string()
        .optional()
        .describe("Device host/IP (SSH/Telnet) when there is no providerId"),
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("TCP port (default 22 for SSH, 23 for Telnet)"),
      username: z
        .string()
        .optional()
        .describe("SSH/Telnet username when there is no providerId"),
      serialPort: z
        .string()
        .optional()
        .describe("Serial port of the device (e.g. COM6 or /dev/ttyUSB0)"),
      baudRate: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Serial baud rate (default 9600)"),
      deviceName: z
        .string()
        .optional()
        .describe("Human-readable name shown on the confirmation card"),
    }),
  },
);

function resolverNodoGns3(nodos: any[], nodeId?: string, nodeName?: string) {
  const idBuscado = nodeId?.trim();
  if (idBuscado) {
    const encontrado = nodos.find((nodo) => nodo?.node_id === idBuscado);
    if (!encontrado) {
      throw new Error(
        `No se encontró el nodo con node_id '${idBuscado}' en el proyecto. Usa listGns3Nodes para ver los nodos reales.`,
      );
    }
    return encontrado;
  }

  const nombreBuscado = nodeName?.trim().toLowerCase();
  if (!nombreBuscado) {
    throw new Error(
      "Debes indicar 'nodeId' o 'nodeName' para elegir el nodo de destino.",
    );
  }

  const exactos = nodos.filter(
    (nodo) => String(nodo?.name ?? "").toLowerCase() === nombreBuscado,
  );
  const candidatos =
    exactos.length > 0
      ? exactos
      : nodos.filter((nodo) =>
          String(nodo?.name ?? "").toLowerCase().includes(nombreBuscado),
        );

  if (candidatos.length === 0) {
    throw new Error(
      `No se encontró ningún nodo cuyo nombre coincida con '${nodeName}'. Usa listGns3Nodes para ver los nombres reales.`,
    );
  }
  if (candidatos.length > 1) {
    const nombres = candidatos.map((nodo) => `"${nodo?.name}"`).join(", ");
    throw new Error(
      `Ambigüedad: varios nodos coinciden con '${nodeName}': ${nombres}. Repite la operación con 'nodeId' para elegir uno.`,
    );
  }
  return candidatos[0];
}

export const openGns3ConsoleTool = tool(
  async ({ projectId, nodeId, nodeName }, runtime) => {
    const client = await Gns3Client.forRequest();

    const proyecto =
      projectId?.trim() ||
      (requestContext.getStore() as { gns3ProjectId?: string | null } | undefined)
        ?.gns3ProjectId ||
      null;
    if (!proyecto) {
      throw new Error(
        "No hay proyecto GNS3 activo. Usa listGns3Projects y openGns3Project primero.",
      );
    }

    const nodos = (await client.getNodes(proyecto)) ?? [];
    const nodo = resolverNodoGns3(nodos, nodeId, nodeName);

    if (nodo.status !== "started") {
      throw new Error(
        `El nodo "${nodo.name}" está apagado. Enciéndelo con controlGns3NodePower y reinténtalo.`,
      );
    }
    if (nodo.console_type !== "telnet") {
      throw new Error(
        `La consola del nodo "${nodo.name}" es de tipo "${nodo.console_type}" y no puede abrirse como terminal interactiva (solo se soporta consola Telnet).`,
      );
    }
    const host =
      typeof nodo.console_host === "string" ? nodo.console_host.trim() : "";
    const puerto = Number(nodo.console);
    if (!host || !Number.isFinite(puerto)) {
      throw new Error(
        `El nodo "${nodo.name}" no tiene una consola Telnet accesible (console/console_host ausentes).`,
      );
    }

    const payload: TerminalOpenPayload = {
      type: "TELNET",
      host,
      port: puerto,
      deviceName: `GNS3 · ${nodo.name}`,
    };
    const summary = `Abrir consola del nodo ${nodo.name} en ${host}:${puerto}`;
    const fingerprint = buildTerminalFingerprint({
      protocol: "TELNET",
      host,
      port: puerto,
    });

    const resultado = await solicitarApertura({
      toolName: "openGns3Console",
      summary,
      payload,
      toolCallId: extraerToolCallId(runtime),
    });

    if (!resultado.accepted) return resultadoRechazo(resultado);
    return aplicarSesionConfirmada(resultado, payload, fingerprint);
  },
  {
    name: "openGns3Console",
    description:
      "Ask the user to open the Telnet console of a STARTED GNS3 node in the chat dashboard (only 'telnet' console type is supported) and wait for confirmation. Identify the node with 'nodeName' (e.g. R1) or 'nodeId'.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat active project",
        ),
      nodeId: z
        .string()
        .optional()
        .describe("Node id (alternative to nodeName)"),
      nodeName: z
        .string()
        .optional()
        .describe(
          "Node name (e.g. R1); case-insensitive exact match, then partial",
        ),
    }),
  },
);
