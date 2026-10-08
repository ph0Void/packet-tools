import { Router } from "express";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { Role } from "@/prisma/generated/enums";

const router = Router();
const schema = z.object({ title: z.string().min(1), description: z.string().min(1), severity: z.string().min(1), topologyId: z.string().min(1), resolved: z.boolean().optional() });
router.use(authMiddleware);
router.get("/", async (req, res, next) => { try { const where = req.user!.role === Role.ADMIN || req.user!.role === Role.STAFF ? {} : { userId: req.user!.id }; const data = await prismaClient.alert.findMany({ where, orderBy: { createdAt: "desc" } }); res.json({ success: true, message: "Alertas obtenidas", data }); } catch (error) { next(error); } });
router.get("/:id", async (req, res, next) => { try { const data = await prismaClient.alert.findUnique({ where: { id: String(req.params.id) } }); if (!data || (req.user!.role === Role.USER && data.userId !== req.user!.id)) return res.status(404).json({ success: false, message: "Alerta no encontrada", data: null }); res.json({ success: true, message: "Alerta obtenida", data }); } catch (error) { next(error); } });
router.post("/", async (req, res, next) => { try { const value = schema.parse(req.body); const data = await prismaClient.alert.create({ data: { ...value, userId: req.user!.id } }); res.status(201).json({ success: true, message: "Alerta creada", data }); } catch (error) { next(error); } });
router.put("/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => { try { const data = await prismaClient.alert.update({ where: { id: String(req.params.id) }, data: schema.partial().parse(req.body) }); res.json({ success: true, message: "Alerta actualizada", data }); } catch (error) { next(error); } });
router.delete("/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => { try { await prismaClient.alert.delete({ where: { id: String(req.params.id) } }); res.json({ success: true, message: "Alerta eliminada", data: null }); } catch (error) { next(error); } });
export default router;
