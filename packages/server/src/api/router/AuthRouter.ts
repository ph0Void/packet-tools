import { Router } from "express";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { BcryptAdapter } from "@/utils/BcryptAdapter";
import { JwtAdapter } from "@/utils/JwtAdapter";
import { authMiddleware } from "@/middleware/auth.middleware";
import { generalLimiter } from "@/config/RateLimiterConfig";

const credentials = z.object({ username: z.string().min(2).max(100), password: z.string().min(6).max(200) });
const publicUser = (user: any) => ({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt });
const router = Router();
router.use(generalLimiter);

router.post("/register", async (req, res, next) => {
  try {
    const input = credentials.parse(req.body);
    const exists = await prismaClient.user.findUnique({ where: { username: input.username } });
    if (exists) return res.status(409).json({ success: false, message: "El usuario ya existe", data: null });
    const user = await prismaClient.user.create({ data: { username: input.username, password: BcryptAdapter.hash(input.password), role: "USER" } });
    res.status(201).json({ success: true, message: "Usuario registrado", data: publicUser(user) });
  } catch (error) { next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const input = credentials.parse(req.body);
    const user = await prismaClient.user.findUnique({ where: { username: input.username } });
    if (!user || !BcryptAdapter.compare(input.password, user.password)) return res.status(401).json({ success: false, message: "Usuario o contraseña inválidos", data: null });
    const token = JwtAdapter.generateToken({ id: user.id, username: user.username, role: user.role });
    await prismaClient.user.update({ where: { id: user.id }, data: { token } });
    res.cookie("packet-tools-cookie", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === "production" });
    res.json({ success: true, message: "Inicio de sesión exitoso", data: publicUser(user) });
  } catch (error) { next(error); }
});

router.post("/logout", authMiddleware, async (req, res, next) => {
  try { await prismaClient.user.update({ where: { id: req.user!.id }, data: { token: null } }); res.clearCookie("packet-tools-cookie"); res.json({ success: true, message: "Sesión cerrada", data: null }); } catch (error) { next(error); }
});
router.get("/me", authMiddleware, async (req, res) => res.json({ success: true, message: "Usuario autenticado", data: req.user }));
export default router;
