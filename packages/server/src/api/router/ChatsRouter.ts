import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { approvalBroker } from "@/agent/approval/ApprovalBroker";
import { terminalOpenBroker } from "@/agent/approval/TerminalOpenBroker";
import {
  cuerpoEnvioRechazado,
  registrarTurnosEnCurso,
  type ReservaTurno,
} from "@/api/router/turnoEnCurso";
import {
  ErrorPaginacion,
  ORDEN_CHATS,
  ORDEN_MENSAJES,
  construirMetaPaginacion,
  parsearPaginacion,
  takeDePaginacion,
  whereDeCursor,
} from "@/api/router/paginacion";
import {
  DIRECTORIO_ADJUNTOS,
  LIMITE_ADJUNTO_BYTES,
  ErrorAdjunto,
  borrarAdjuntoDeDisco,
  escribirAdjuntoEnDisco,
  existeAdjuntoEnDisco,
  leerAdjuntoDeDisco,
  maximoCharsDataUrl,
  nombreSeguro,
  persistirAdjuntosEntrantes,
  type AdjuntoEntrante,
  type AdjuntoPreparado,
} from "@/api/router/adjuntos";
import {
  avisarTailEnContent,
  ejecutarTurnoEnStream,
  type LineasTerminal,
} from "@/api/router/turnoStream";
import { contieneAvisoDeCorte } from "@/api/router/corteTurno";
import { Prisma } from "@/prisma/generated/client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { Role } from "@/prisma/generated/enums";
import { Logger } from "@/utils/Logger";
import { envConfig } from "@/config/EnvConfig";
import { messagesLimiter } from "@/config/RateLimiterConfig";

export {
  CIERRE_DELEGACION_FIN_TURNO,
  MARCADORES_FIN_DE_TURNO,
  cerrarSegmentosPendientes,
  clasificarEstadoToolResult,
  detectarMarcadorFinDeTurno,
  type EstadoFinalTool,
  type EstadoTool,
  type MarcadorFinDeTurno,
  type MotivoBarridoTurno,
  type SegmentoStream,
  type ToolExecution,
} from "@/api/router/turnoStream";

async function validarSeleccionChat(body: { modelProviderId?: string | null; connectionId?: string | null; gns3ProjectId?: string | null }, role: string): Promise<string | null> {
  if (body.modelProviderId) {
    const provider = await prismaClient.modelProvider.findUnique({ where: { id: body.modelProviderId } });
    const allowed = (provider?.userPermission ?? "").split(",").map((t) => t.trim().toUpperCase()).includes(role.toUpperCase());
    if (!provider || !provider.isActive || !allowed) return "modelProviderId inválido o sin permiso para tu rol";
  }
  if (body.connectionId) {
    const device = await prismaClient.deviceProviders.findUnique({ where: { id: body.connectionId } });
    if (!device) return "connectionId no existe";
  }
  if (body.gns3ProjectId !== undefined && body.gns3ProjectId !== null && body.gns3ProjectId.trim() === "") {
    return "gns3ProjectId no puede ser una cadena vacía";
  }
  return null;
}

const columnasChat = {
  id: true,
  title: true,
  modelProviderId: true,
  connectionId: true,
  gns3ProjectId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res, next) => {
  try {
    const paginacion = parsearPaginacion(req.query as Record<string, never>);
    const incluirMensajes = String(req.query.include ?? "") === "messages";

    const marca = paginacion.cursor
      ? await prismaClient.chat.findFirst({
          where: { id: paginacion.cursor, userId: req.user!.id },
          select: { updatedAt: true },
        })
      : null;
    const where =
      whereDeCursor(ORDEN_CHATS, paginacion.cursor, marca, { userId: req.user!.id }) ?? {
        userId: req.user!.id,
      };
    const filas = await prismaClient.chat.findMany({
      where,

      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: takeDePaginacion(paginacion),
      skip: paginacion.skip,
      select: {
        ...columnasChat,

        _count: { select: { messages: true } },
        ...(incluirMensajes
          ? {
              messages: {
                include: { attachments: true },
                orderBy: { createdAt: "asc" as const },
              },
            }
          : {}),
      },
    });
    const { filas: chats, meta } = construirMetaPaginacion(
      filas as unknown as Array<{ id: string }>,
      paginacion,
    );

    const ids = chats.map((chat: any) => chat.id);
    const conteoAdjuntos = new Map<string, number>();
    if (ids.length > 0) {
      const mensajes = await prismaClient.message.findMany({
        where: { chatId: { in: ids } },
        select: { chatId: true, _count: { select: { attachments: true } } },
      });
      for (const mensaje of mensajes) {
        conteoAdjuntos.set(
          mensaje.chatId,
          (conteoAdjuntos.get(mensaje.chatId) ?? 0) + mensaje._count.attachments,
        );
      }
    }
    const data = chats.map((fila: any) => ({
      id: fila.id,
      title: fila.title,
      modelProviderId: fila.modelProviderId,
      connectionId: fila.connectionId,
      gns3ProjectId: fila.gns3ProjectId,
      createdAt: fila.createdAt,
      updatedAt: fila.updatedAt,
      messageCount: fila._count?.messages ?? 0,
      attachmentCount: Array.isArray(fila.messages)
        ? fila.messages.reduce((total: number, m: any) => total + (m.attachments?.length ?? 0), 0)
        : (conteoAdjuntos.get(fila.id) ?? 0),
      ...(Array.isArray(fila.messages) ? { messages: fila.messages } : {}),
    }));
    res.json({ success: true, message: "Chats obtenidos", data, meta });
  } catch (error) {
    if (error instanceof ErrorPaginacion) {
      return res.status(400).json({ success: false, message: error.message, data: null });
    }
    next(error);
  }
});

router.get("/attachments/:id", async (req, res, next) => {
  try {
    const adjunto = await prismaClient.attachment.findUnique({
      where: { id: String(req.params.id) },
      include: { message: { select: { chat: { select: { userId: true } } } } },
    });
    if (!adjunto) return res.status(404).json({ success: false, message: "Adjunto no encontrado", data: null });
    const esDueño =
      adjunto.userId === req.user!.id ||
      adjunto.message.chat.userId === req.user!.id;
    if (!esDueño && req.user!.role !== Role.ADMIN) {

      return res.status(404).json({ success: false, message: "Adjunto no encontrado", data: null });
    }
    const mime = adjunto.mimeType ?? "application/octet-stream";

    const disposicion = adjunto.fileType === "IMAGE" ? "inline" : "attachment";
    const cabeceras: Record<string, string> = {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${disposicion}; filename="${nombreSeguro(adjunto.fileName)}"`,
    };
    if (adjunto.storagePath) {
      const bytes = await leerAdjuntoDeDisco(DIRECTORIO_ADJUNTOS, adjunto.storagePath);
      if (!bytes) {
        Logger.warning({
          message: "[CHAT_ATTACH] Falta el archivo del adjunto en disco",
          data: { attachmentId: adjunto.id, storagePath: adjunto.storagePath },
        });
        return res
          .status(410)
          .json({ success: false, message: "El archivo de este adjunto ya no está disponible", data: null });
      }
      res.set(cabeceras);
      res.send(bytes);
      return;
    }

    const dataUrl = typeof adjunto.fileUrl === "string" ? adjunto.fileUrl : "";
    const coincidencia = dataUrl.match(/^data:([^;,]*);base64,(.*)$/s);
    if (!coincidencia) {
      return res
        .status(410)
        .json({ success: false, message: "El contenido de este adjunto ya no está disponible", data: null });
    }
    res.set(cabeceras);
    res.send(Buffer.from(coincidencia[2], "base64"));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {

    const body = z.object({ title: z.string().max(200).optional(), modelProviderId: z.string().max(200).nullable().optional(), connectionId: z.string().max(200).nullable().optional(), gns3ProjectId: z.string().max(200).nullable().optional() }).parse(req.body);
    const errorSeleccion = await validarSeleccionChat(body, req.user!.role);
    if (errorSeleccion) return res.status(400).json({ success: false, message: errorSeleccion, data: null });
    const data = await prismaClient.chat.create({ data: { userId: req.user!.id, title: body.title ?? "Nueva conversación", modelProviderId: body.modelProviderId ?? null, connectionId: body.connectionId ?? null, gns3ProjectId: body.gns3ProjectId ?? null } });
    res.status(201).json({ success: true, message: "Chat creado", data });
  } catch (error) { next(error); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const body = z.object({ modelProviderId: z.string().max(200).nullable().optional(), connectionId: z.string().max(200).nullable().optional(), gns3ProjectId: z.string().max(200).nullable().optional() }).parse(req.body);
    const chat = await prismaClient.chat.findUnique({ where: { id: String(req.params.id) } });
    if (!chat) return res.status(404).json({ success: false, message: "Chat no encontrado", data: null });
    if (chat.userId !== req.user!.id) return res.status(403).json({ success: false, message: "No tienes permiso para modificar este chat", data: null });
    const errorSeleccion = await validarSeleccionChat(body, req.user!.role);
    if (errorSeleccion) return res.status(400).json({ success: false, message: errorSeleccion, data: null });

    const data: Prisma.ChatUpdateInput = {};
    if (body.modelProviderId !== undefined) data.modelProviderId = body.modelProviderId;
    if (body.connectionId !== undefined) data.connectionId = body.connectionId;
    if (body.gns3ProjectId !== undefined) data.gns3ProjectId = body.gns3ProjectId;
    const actualizado = await prismaClient.chat.update({ where: { id: chat.id }, data });
    res.json({ success: true, message: "Chat actualizado", data: actualizado });
  } catch (error) { next(error); }
});

router.get("/:id/messages", async (req, res, next) => {
  try {
    const paginacion = parsearPaginacion(req.query as Record<string, never>);
    const chat = await prismaClient.chat.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!chat) return res.status(404).json({ success: false, message: "Chat no encontrado", data: null });
    const marca = paginacion.cursor
      ? await prismaClient.message.findFirst({
          where: { id: paginacion.cursor, chatId: chat.id },
          select: { createdAt: true },
        })
      : null;
    const where = whereDeCursor(ORDEN_MENSAJES, paginacion.cursor, marca, { chatId: chat.id }) ?? {
      chatId: chat.id,
    };
    const filas = await prismaClient.message.findMany({
      where,
      include: { attachments: true },

      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: takeDePaginacion(paginacion),
      skip: paginacion.skip,
    });
    const { filas: mensajes, meta } = construirMetaPaginacion(
      filas as unknown as Array<{ id: string }>,
      paginacion,
    );
    res.json({ success: true, message: "Mensajes obtenidos", data: mensajes, meta });
  } catch (error) {
    if (error instanceof ErrorPaginacion) {
      return res.status(400).json({ success: false, message: error.message, data: null });
    }
    next(error);
  }
});

router.post("/approvals/:approvalId", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const body = z.object({ decision: z.enum(["approve", "reject"]) }).parse(req.body);
    const entry = approvalBroker.resolve(
      String(req.params.approvalId),
      body.decision === "approve" ? "approved" : "rejected",
      { id: req.user!.id },
    );
    if (!entry) return res.status(404).json({ success: false, message: "Aprobación no encontrada, expirada o no autorizada", data: null });
    res.json({ success: true, message: "Decisión registrada", data: { approvalId: entry.approvalId, decision: entry.status } });
  } catch (error) { next(error); }
});

router.post("/terminal-open/:requestId", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const body = z.object({
      accepted: z.boolean(),
      sessionId: z.string().max(200).nullable().optional(),
      error: z.string().max(500).nullable().optional(),
    }).parse(req.body);
    const entry = terminalOpenBroker.resolve(
      String(req.params.requestId),
      { accepted: body.accepted, sessionId: body.sessionId, error: body.error },
      { id: req.user!.id },
    );
    if (!entry) return res.status(404).json({ success: false, message: "Solicitud de apertura no encontrada, expirada o no autorizada", data: null });

    res.json({ success: true, message: "Apertura registrada", data: { requestId: entry.requestId, accepted: entry.status === "accepted" } });
  } catch (error) { next(error); }
});

const cuerpoMensajeSchema = z.object({
  content: z.string().min(1).max(100_000),
  provider: z.string().optional(),
  connectionType: z.string().optional(),
  connectionId: z.string().max(200).optional(),
  modelProviderId: z.string().optional(),
  gns3ProjectId: z.string().max(200).nullable().optional(),
  terminalSessionId: z.string().max(200).optional(),
  terminalContextLines: z
    .union([z.literal(0), z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .default(0),
  terminalTail: z.string().max(20_000).optional(),
  origin: z.enum(["terminal", "chat"]).default("chat"),
  stream: z.boolean().default(true),
  clientMessageId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string().max(300),
        fileType: z.enum(["IMAGE", "DOCUMENT"]).default("IMAGE"),

        fileUrl: z.string().max(45_000_000).optional(),
        mimeType: z.string().optional(),
        attachmentId: z.string().max(200).optional(),
      }),
    )
    .max(4)
    .default([]),
  autonomousMode: z.boolean().default(false),
});

function responderErrorAdjunto(res: any, error: unknown): void {
  if (error instanceof ErrorAdjunto) {
    const esCuerpoGrande = error.codigo === "CUERPO_DEMASIADO_GRANDE";
    Logger.warning({
      message: "[CHAT_ATTACH] Adjunto rechazado",
      data: { codigo: error.codigo, detalle: error.message },
    });
    res.status(esCuerpoGrande ? 413 : 400).json({
      success: false,
      message: error.message,
      code: error.codigo,
      data: null,
    });
    return;
  }
  throw error;
}

router.post(
  "/:id/messages",
  requireRoles(Role.USER, Role.STAFF, Role.ADMIN),
  messagesLimiter,
  async (req, res, next) => {

    let reserva: ReservaTurno | null = null;

    let creados: string[] = [];
    try {
      const body = cuerpoMensajeSchema.parse(req.body);
      const chat = await prismaClient.chat.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
      });
      if (!chat)
        return res.status(404).json({ success: false, message: "Chat no encontrado", data: null });
      const errorSeleccion = await validarSeleccionChat(body, req.user!.role);
      if (errorSeleccion)
        return res.status(400).json({ success: false, message: errorSeleccion, data: null });

      if (body.clientMessageId) {
        const existente = await prismaClient.message.findFirst({
          where: { chatId: chat.id, clientMessageId: body.clientMessageId },
          include: { attachments: true },
        });
        if (existente) {
          Logger.info({
            message: "[CHAT_IDEMPOTENCIA] Envío duplicado ignorado (mismo clientMessageId)",
            data: { chatId: chat.id, messageId: existente.id },
          });
          return res
            .status(409)
            .json(cuerpoEnvioRechazado("DUPLICADO", { id: existente.id, message: existente }));
        }
      }

      reserva = registrarTurnosEnCurso.reservar(chat.id, {
        clientMessageId: body.clientMessageId ?? null,
      });
      if (!reserva) {
        Logger.warning({
          message: "[CHAT_IDEMPOTENCIA] Envío rechazado: ya hay un turno en curso en el chat",
          data: { chatId: chat.id },
        });
        return res.status(409).json(cuerpoEnvioRechazado("TURNO_EN_CURSO"));
      }

      const entrantes: AdjuntoEntrante[] = [];
      const reutilizados: Array<{
        fileName: string;
        fileType: "IMAGE" | "DOCUMENT";
        mimeType: string | null;
        storagePath: string | null;
        sha256: string | null;
        sizeBytes: number | null;
        userId: string;
      }> = [];
      for (const adjunto of body.attachments) {
        if (adjunto.attachmentId && !adjunto.fileUrl) {
          const previo = await prismaClient.attachment.findUnique({
            where: { id: adjunto.attachmentId },
            include: { message: { select: { chat: { select: { userId: true } } } } },
          });
          const esDueño =
            previo?.userId === req.user!.id || previo?.message.chat.userId === req.user!.id;
          if (!previo || (!esDueño && req.user!.role !== Role.ADMIN)) {

            return res
              .status(404)
              .json({ success: false, message: "Adjunto no encontrado", data: null });
          }
          if (!previo.storagePath || !await existeAdjuntoEnDisco(DIRECTORIO_ADJUNTOS, previo.storagePath)) {
            return res.status(410).json({
              success: false,
              message: "El contenido de ese adjunto ya no está disponible",
              data: null,
            });
          }
          reutilizados.push({
            fileName: nombreSeguro(previo.fileName),
            fileType: previo.fileType,
            mimeType: previo.mimeType,
            storagePath: previo.storagePath,
            sha256: previo.sha256,
            sizeBytes: previo.sizeBytes,
            userId: req.user!.id,
          });
          continue;
        }
        entrantes.push(adjunto);
      }
      let escritos: Array<{ adjunto: AdjuntoPreparado; storagePath: string }> = [];
      try {
        escritos = await persistirAdjuntosEntrantes(
          DIRECTORIO_ADJUNTOS,
          entrantes,
          LIMITE_ADJUNTO_BYTES,
        );
        creados = escritos.map((e) => e.storagePath);
      } catch (error) {
        reserva.liberar();
        reserva = null;
        return responderErrorAdjunto(res, error);
      }

      const filasAdjunto = [
        ...escritos.map((escrito) => ({
          fileName: escrito.adjunto.fileName,
          fileType: escrito.adjunto.fileType,
          mimeType: escrito.adjunto.mimeType,
          storagePath: escrito.storagePath,
          sha256: escrito.adjunto.sha256,
          sizeBytes: escrito.adjunto.sizeBytes,
          userId: req.user!.id,
        })),
        ...reutilizados,
      ];
      let message;
      try {
        message = await prismaClient.message.create({
          data: {
            chatId: chat.id,
            role: "user",
            content: body.content,
            ...(body.clientMessageId ? { clientMessageId: body.clientMessageId } : {}),
            attachments: { create: filasAdjunto },
          },
          include: { attachments: true },
        });
      } catch (error) {

        reserva.liberar();
        reserva = null;
        if (body.clientMessageId && (error as { code?: string } | null)?.code === "P2002") {
          const ganador = await prismaClient.message.findFirst({
            where: { chatId: chat.id, clientMessageId: body.clientMessageId },
            include: { attachments: true },
          });
          return res
            .status(409)
            .json(cuerpoEnvioRechazado("DUPLICADO", { id: ganador?.id, message: ganador }));
        }

        for (const storagePath of creados) await borrarAdjuntoDeDisco(DIRECTORIO_ADJUNTOS, storagePath);
        creados = [];
        throw error;
      }
      reserva.registrarMensaje(message.id);

      avisarTailEnContent(body.content, chat.id);

      const seleccionChat: Prisma.ChatUpdateInput = {};
      if (body.modelProviderId !== undefined) seleccionChat.modelProviderId = body.modelProviderId;
      if (body.connectionId !== undefined) seleccionChat.connectionId = body.connectionId;
      if (body.gns3ProjectId !== undefined) seleccionChat.gns3ProjectId = body.gns3ProjectId;
      await prismaClient.chat.update({
        where: { id: chat.id },
        data: { updatedAt: new Date(), ...seleccionChat },
      });

      if (!body.stream) {
        reserva.liberar();
        reserva = null;
        return res.status(201).json({ success: true, message: "Mensaje guardado", data: message });
      }
      await ejecutarTurnoEnStream({
        req,
        res,
        chat,
        usuario: { id: req.user!.id, username: req.user!.username, role: req.user!.role },
        mensaje: {
          id: message.id,
          content: message.content,
          attachments: message.attachments.map((adjunto) => ({
            fileName: adjunto.fileName,
            fileType: adjunto.fileType,
            mimeType: adjunto.mimeType,
            storagePath: adjunto.storagePath,
            fileUrl: adjunto.fileUrl,
          })),
        },
        seleccion: {
          modelProviderId: body.modelProviderId,
          connectionType: body.connectionType,
          provider: body.provider,
          gns3ProjectId: body.gns3ProjectId,
          connectionId: body.connectionId,
          terminalSessionId: body.terminalSessionId,
          terminalContextLines: body.terminalContextLines as LineasTerminal,
          terminalTail: body.terminalTail,
          origin: body.origin,
          autonomousMode: body.autonomousMode,
        },
        reserva,
      });
      reserva = null;
    } catch (error) {

      reserva?.liberar();
      reserva = null;
      for (const storagePath of creados) {
        await borrarAdjuntoDeDisco(DIRECTORIO_ADJUNTOS, storagePath);
      }
      if (!res.headersSent) next(error);
      else res.end();
    }
  },
);

router.post(
  "/:id/messages/:messageId/retry",
  requireRoles(Role.USER, Role.STAFF, Role.ADMIN),
  messagesLimiter,
  async (req, res, next) => {
    let reserva: ReservaTurno | null = null;
    try {
      const chat = await prismaClient.chat.findFirst({
        where: { id: String(req.params.id), userId: req.user!.id },
      });
      if (!chat)
        return res.status(404).json({ success: false, message: "Chat no encontrado", data: null });

      const mensaje = await prismaClient.message.findFirst({
        where: { id: String(req.params.messageId), chatId: chat.id, role: "user" },
        include: { attachments: true },
      });
      if (!mensaje)
        return res.status(404).json({
          success: false,
          message: "Mensaje de usuario no encontrado en esta conversación",
          data: null,
        });

      const { hayTurnoCompleto, mensajeAssistant } = await buscarTurnoCompletoDe(chat.id, {
        id: mensaje.id,
        createdAt: mensaje.createdAt,
      });
      if (hayTurnoCompleto) {
        Logger.info({
          message: "[CHAT_RETRY] Reintento ignorado: el mensaje ya tiene respuesta",
          data: { chatId: chat.id, messageId: mensaje.id },
        });
        return res
          .status(409)
          .json(cuerpoEnvioRechazado("YA_REINTENTADO", { assistantMessageId: mensajeAssistant }));
      }

      reserva = registrarTurnosEnCurso.reservar(chat.id);
      if (!reserva) {
        Logger.warning({
          message: "[CHAT_RETRY] Reintento rechazado: ya hay un turno en curso en el chat",
          data: { chatId: chat.id },
        });
        return res.status(409).json(cuerpoEnvioRechazado("TURNO_EN_CURSO"));
      }
      reserva.registrarMensaje(mensaje.id);
      Logger.info({
        message: "[CHAT_RETRY] Reintentando turno sobre el mensaje existente",
        data: { chatId: chat.id, messageId: mensaje.id },
      });

      await ejecutarTurnoEnStream({
        req,
        res,
        chat,
        usuario: { id: req.user!.id, username: req.user!.username, role: req.user!.role },
        mensaje: {
          id: mensaje.id,
          content: mensaje.content,
          attachments: mensaje.attachments.map((adjunto) => ({
            fileName: adjunto.fileName,
            fileType: adjunto.fileType,
            mimeType: adjunto.mimeType,
            storagePath: adjunto.storagePath,
            fileUrl: adjunto.fileUrl,
          })),
        },
        seleccion: {
          modelProviderId: chat.modelProviderId ?? undefined,
          connectionId: chat.connectionId ?? undefined,
          gns3ProjectId: chat.gns3ProjectId,
          terminalContextLines: 0,
          origin: "chat",
          autonomousMode: false,
        },
        reserva,

        emitirUserMessage: false,
      });
      reserva = null;
    } catch (error) {
      reserva?.liberar();
      reserva = null;
      if (!res.headersSent) next(error);
      else res.end();
    }
  },
);

async function buscarTurnoCompletoDe(
  chatId: string,
  mensajeUsuario: { id: string; createdAt: Date },
): Promise<{ hayTurnoCompleto: boolean; mensajeAssistant: string | null }> {
  const posteriores = await prismaClient.message.findMany({
    where: { chatId, createdAt: { gte: mensajeUsuario.createdAt } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, role: true, content: true },
  });
  for (const candidato of posteriores) {
    if (candidato.id === mensajeUsuario.id) continue;

    if (candidato.role === "user") break;
    if (candidato.role !== "assistant") continue;
    if (!contieneAvisoDeCorte(candidato.content)) {
      return { hayTurnoCompleto: true, mensajeAssistant: candidato.id };
    }
  }
  return { hayTurnoCompleto: false, mensajeAssistant: null };
}

router.delete("/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const chat = await prismaClient.chat.findUnique({ where: { id: String(req.params.id) } });
    if (!chat) return res.status(404).json({ success: false, message: "Chat no encontrado", data: null });

    if (req.user!.role !== Role.ADMIN && chat.userId !== req.user!.id) {
      return res.status(403).json({ success: false, message: "No tienes permiso para eliminar este chat", data: null });
    }
    const deleted = await prismaClient.chat.delete({ where: { id: chat.id } });
    res.json({ success: true, message: "Chat eliminado", data: { id: deleted.id } });
  } catch (error) { next(error); }
});
export default router;
