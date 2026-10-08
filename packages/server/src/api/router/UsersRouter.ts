import { Role } from "@/prisma/generated/enums";
import { Router } from "express";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { BcryptAdapter } from "@/utils/BcryptAdapter";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { z } from "zod";

const router = Router();
const input = z.object({ username: z.string().min(2).max(100), password: z.string().min(6).max(200), role: z.nativeEnum(Role).optional() });
const select = { id: true, username: true, role: true, createdAt: true, updatedAt: true } as const;
router.use(authMiddleware);
router.get("/", async (_req, res, next) => { try { const users = await prismaClient.user.findMany({ select, orderBy: { createdAt: "desc" } }); res.json({ success: true, message: "Usuarios obtenidos", data: users }); } catch (e) { next(e); } });
router.post("/", requireRoles(Role.ADMIN), async (req, res, next) => { try { const value = input.parse(req.body); const user = await prismaClient.user.create({ data: { username: value.username, password: BcryptAdapter.hash(value.password), role: value.role ?? Role.USER }, select }); res.status(201).json({ success: true, message: "Usuario creado", data: user }); } catch (e) { next(e); } });
router.put("/:id", requireRoles(Role.ADMIN), async (req, res, next) => { try { const value = input.partial().parse(req.body); const data: any = { ...value }; if (value.password) data.password = BcryptAdapter.hash(value.password); else delete data.password; const user = await prismaClient.user.update({ where: { id: String(req.params.id) }, data, select }); res.json({ success: true, message: "Usuario actualizado", data: user }); } catch (e) { next(e); } });
router.delete("/:id", requireRoles(Role.ADMIN), async (req, res, next) => { try { await prismaClient.user.delete({ where: { id: String(req.params.id) } }); res.json({ success: true, message: "Usuario eliminado", data: null }); } catch (e) { next(e); } });
export default router;
