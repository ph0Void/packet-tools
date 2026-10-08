import type { NextFunction, Request, Response } from "express";
import { JwtAdapter } from "@/utils/JwtAdapter";
import { prismaClient } from "@/prisma/lib/PrismaClient";

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const token = (req.cookies?.["packet-tools-cookie"] as string | undefined) ?? bearer;
  const payload = token ? JwtAdapter.verifyToken<{ id: string; username: string; role: any }>(token) : null;
  if (!payload?.id) return res.status(401).json({ success: false, message: "Autenticación requerida", data: null });
  const user = await prismaClient.user.findFirst({ where: { id: payload.id, token } });
  if (!user) return res.status(401).json({ success: false, message: "Sesión inválida", data: null });
  req.user = { id: user.id, username: user.username, role: user.role };
  return next();
}
