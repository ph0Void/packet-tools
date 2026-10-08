import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { Role } from "@/prisma/generated/enums";
import { vectorStoreService } from "@/service/VectorStoreService";
import { invalidateSkillsCache } from "@/agent/skills/loader";
import { Logger } from "@/utils/Logger";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const documentsDir = path.resolve(process.cwd(), "uploads", "documents");
const publicDocument = { id: true, title: true, description: true, fileUrl: true, createdAt: true, updatedAt: true } as const;

router.use(authMiddleware);

router.get("/", async (_req, res, next) => {
  try {

    const rows = await prismaClient.knowledgeBase.findMany({ where: { type: "DATA" }, select: publicDocument, orderBy: { updatedAt: "desc" } });
    res.json({ success: true, message: "Documentos obtenidos", data: rows });
  } catch (error) { next(error); }
});

router.post("/", requireRoles(Role.ADMIN, Role.STAFF), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Archivo requerido", data: null });
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (![".pdf", ".txt", ".md"].includes(extension)) return res.status(400).json({ success: false, message: "Solo se permiten PDF, TXT y MD", data: null });
    const title = z.string().min(1).max(200).parse(req.body.title ?? path.basename(req.file.originalname, extension));
    await fs.mkdir(documentsDir, { recursive: true });
    const filename = `${randomUUID()}${extension}`;
    const absolutePath = path.join(documentsDir, filename);
    const parser = extension === ".pdf" ? new PDFParse({ data: req.file.buffer }) : null;
    const content = parser ? (await parser.getText()).text : req.file.buffer.toString("utf8");
    if (parser) await parser.destroy();

    if (!content || content.trim() === "") return res.status(400).json({ success: false, message: "El documento no contiene texto extraíble.", data: null });
    await fs.writeFile(absolutePath, req.file.buffer);
    const row = await prismaClient.knowledgeBase.create({ data: { title, content, description: req.file.mimetype, fileUrl: path.join("uploads", "documents", filename).replaceAll("\\", "/"), createdById: req.user!.id }, select: publicDocument });

    let indexed = true;
    let indexError: unknown = null;
    try { await vectorStoreService.indexDocuments([{ id: row.id, title: row.title, content }]); } catch (error) { indexed = false; indexError = error; }
    let message = "Archivo cargado e indexado";
    if (!indexed) {
      const motivo = indexError instanceof Error ? indexError.message : String(indexError);
      Logger.error({ message: "[DataRouter] Falló la indexación del documento cargado", data: { documentId: row.id, error: motivo } });

      message = motivo.includes("EMBEDDING activo")
        ? "Archivo cargado (pendiente de indexación: configura un modelo EMBEDDING activo)"
        : `Archivo cargado, pero la indexación falló: ${motivo}`;
    }
    res.status(201).json({ success: true, message, data: row });
  } catch (error) { next(error); }
});

const skillRow = { id: true, title: true, description: true, content: true, updatedAt: true } as const;

router.get("/skills", async (req, res, next) => {
  try {
    const query = z.string().max(200).optional().parse(req.query.q ?? undefined);
    const rows = await prismaClient.knowledgeBase.findMany({
      where: {
        type: "SKILL",
        ...(query
          ? { title: { contains: query } }
          : {}),
      },
      select: skillRow,
      orderBy: { updatedAt: "desc" },
    });
    res.json({ success: true, message: "Skills obtenidas", data: rows });
  } catch (error) { next(error); }
});

router.post("/skills", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const body = z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(1024).optional(),
        content: z.string().min(1).max(100_000),
      })
      .parse(req.body);

    const existente = await prismaClient.knowledgeBase.findFirst({
      where: { type: "SKILL", title: body.title },
    });
    if (existente) {
      return res
        .status(409)
        .json({ success: false, message: "Ya existe una skill con ese título", data: null });
    }
    const row = await prismaClient.knowledgeBase.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        content: body.content,
        type: "SKILL",
        createdById: req.user!.id,
      },
      select: skillRow,
    });

    invalidateSkillsCache();
    res.status(201).json({ success: true, message: "Skill creada", data: row });
  } catch (error) { next(error); }
});

router.put("/skills/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(1024).nullable().optional(),
        content: z.string().min(1).max(100_000).optional(),
      })
      .parse(req.body);
    const actual = await prismaClient.knowledgeBase.findFirst({ where: { id, type: "SKILL" } });
    if (!actual) return res.status(404).json({ success: false, message: "Skill no encontrada", data: null });
    const row = await prismaClient.knowledgeBase.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
      },
      select: skillRow,
    });
    invalidateSkillsCache();
    res.json({ success: true, message: "Skill actualizada", data: row });
  } catch (error) { next(error); }
});

router.delete("/skills/:id", requireRoles(Role.ADMIN), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const actual = await prismaClient.knowledgeBase.findFirst({ where: { id, type: "SKILL" } });
    if (!actual) return res.status(404).json({ success: false, message: "Skill no encontrada", data: null });
    await prismaClient.knowledgeBase.delete({ where: { id } });
    invalidateSkillsCache();
    res.json({ success: true, message: "Skill eliminada", data: null });
  } catch (error) { next(error); }
});

router.get("/:id/file", async (req, res, next) => {
  try {
    const row = await prismaClient.knowledgeBase.findUnique({ where: { id: String(req.params.id) } });
    if (!row?.fileUrl) return res.status(404).json({ success: false, message: "Archivo no encontrado", data: null });
    const absolutePath = path.resolve(process.cwd(), row.fileUrl);
    await fs.access(absolutePath);
    res.type(row.fileUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" : row.description ?? "text/plain");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.title)}`);
    res.sendFile(absolutePath);
  } catch (error) { next(error); }
});

router.delete("/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const row = await prismaClient.knowledgeBase.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ success: false, message: "Documento no encontrado", data: null });
    await prismaClient.knowledgeBase.delete({ where: { id: row.id } });
    if (row.fileUrl) await fs.rm(path.resolve(process.cwd(), row.fileUrl), { force: true });
    await vectorStoreService.deleteDocument(row.id);
    res.json({ success: true, message: "Documento eliminado", data: null });
  } catch (error) { next(error); }
});

export default router;
