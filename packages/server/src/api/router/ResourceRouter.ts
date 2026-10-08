import { Router } from "express";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { Role } from "@/prisma/generated/enums";
import { Logger } from "@/utils/Logger";

type Model = "user" | "chat" | "alert" | "deviceProviders" | "topology" | "modelProvider" | "configuration" | "cronJob" | "knowledgeBase";
const dataSchema = z.record(z.string(), z.any());
const safe = (value: any): any => { if (!value) return value; if (Array.isArray(value)) return value.map(safe); const copy = { ...value }; delete copy.password; delete copy.token; if (copy.apiKey) copy.apiKey = "[configured]"; return copy; };

export function resourceRouter(model: Model, options: { roles?: Role[]; ownerField?: string; scopeReads?: boolean; adminMutations?: boolean; afterWrite?: () => void | Promise<void> } = {}) {
  const router = Router();
  const db = () => (prismaClient as any)[model];
  const roles = options.roles ?? [Role.ADMIN, Role.STAFF, Role.USER];

  const sanitizePayload = (payload: Record<string, any>) => {
    if (model !== "modelProvider" || payload.apiKey !== "[configured]") return payload;
    const clean = { ...payload };
    delete clean.apiKey;
    return clean;
  };

  const runAfterWrite = async () => {
    if (!options.afterWrite) return;
    try {
      await options.afterWrite();
    } catch (error) {

      Logger.error({ message: "resourceRouter: error en el callback afterWrite", data: error });
    }
  };

  router.use(authMiddleware);
  router.get("/", async (req, res, next) => { try { const where = options.scopeReads !== false && options.ownerField && req.user?.role !== Role.ADMIN && req.user?.role !== Role.STAFF ? { [options.ownerField]: req.user!.id } : {}; const rows = await db().findMany({ where, orderBy: { createdAt: "desc" } }); res.json({ success: true, message: "Datos obtenidos", data: safe(rows) }); } catch (e) { next(e); } });
  router.get("/:id", async (req, res, next) => { try { const row = await db().findUnique({ where: { id: req.params.id } }); if (!row) return res.status(404).json({ success: false, message: "Recurso no encontrado", data: null }); res.json({ success: true, message: "Dato obtenido", data: safe(row) }); } catch (e) { next(e); } });
  router.post("/", requireRoles(...roles), async (req, res, next) => { try { const input = dataSchema.parse(req.body); const data = { ...sanitizePayload(input) }; if (options.ownerField && !data[options.ownerField]) data[options.ownerField] = req.user!.id; const row = await db().create({ data }); await runAfterWrite(); res.status(201).json({ success: true, message: "Recurso creado", data: safe(row) }); } catch (e) { next(e); } });
  router.put("/:id", requireRoles(...roles), async (req, res, next) => { try { const row = await db().update({ where: { id: req.params.id }, data: sanitizePayload(dataSchema.parse(req.body)) }); await runAfterWrite(); res.json({ success: true, message: "Recurso actualizado", data: safe(row) }); } catch (e) { next(e); } });
  router.patch("/:id", requireRoles(...roles), async (req, res, next) => { try { const row = await db().update({ where: { id: req.params.id }, data: sanitizePayload(dataSchema.parse(req.body)) }); await runAfterWrite(); res.json({ success: true, message: "Recurso actualizado", data: safe(row) }); } catch (e) { next(e); } });
  router.delete("/:id", requireRoles(...roles), async (req, res, next) => { try { const row = await db().delete({ where: { id: req.params.id } }); await runAfterWrite(); res.json({ success: true, message: "Recurso eliminado", data: safe(row) }); } catch (e) { next(e); } });
  return router;
}
