import type { NextFunction, Request, Response } from "express";
import type { Role } from "@/prisma/generated/enums";

export const requireRoles = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ success: false, message: "Permisos insuficientes", data: null });
  next();
};

export const checkRole = (roles: Role[]) => requireRoles(...roles);
