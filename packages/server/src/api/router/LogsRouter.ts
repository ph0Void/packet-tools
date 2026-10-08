import { z } from "zod";
import { Role } from "@/prisma/generated/enums";
import { Router } from "express";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { NIVELES_LOG_CANONICOS } from "@/agent/deep/agentLog";

const router = Router();
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  level: z.string().optional(),

  chatId: z.string().optional(),
});

router.use(authMiddleware);

router.get("/", async (req, res, next) => {
  try {
    const { page, limit, level, chatId } = query.parse(req.query);
    const esAdmin = req.user!.role === Role.ADMIN;

    const where = {
      ...(esAdmin ? {} : { userId: req.user!.id }),
      ...(level ? { level } : {}),
      ...(chatId ? { chatId } : {}),
    };
    const [items, total] = await Promise.all([
      prismaClient.log.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prismaClient.log.count({ where }),
    ]);

    const ids = Array.from(
      new Set(items.map((item) => item.userId).filter((id): id is string => Boolean(id))),
    );
    const actores = await prismaClient.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, role: true },
    });
    const porId = new Map(
      actores.map((actor) => [actor.id, { id: actor.id, username: actor.username, role: String(actor.role) }]),
    );

    res.json({
      success: true,
      message: "Logs obtenidos",
      data: {
        items: items.map((item) => ({
          ...item,

          actor: item.userId ? (porId.get(item.userId) ?? null) : null,
        })),
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/levels", async (_req, res, next) => {
  try {
    const presentes = await prismaClient.log.findMany({
      distinct: ["level"],
      select: { level: true },
    });
    const extra = presentes
      .map((row) => row.level)
      .filter((level) => typeof level === "string" && level.length > 0)
      .filter((level) => !NIVELES_LOG_CANONICOS.includes(level))
      .sort((a, b) => a.localeCompare(b));

    res.json({
      success: true,
      message: "Niveles de log obtenidos",
      data: [...NIVELES_LOG_CANONICOS, ...extra],
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireRoles(Role.ADMIN), async (req, res, next) => {
  try {
    const result = await prismaClient.log.deleteMany({ where: { id: String(req.params.id) } });
    if (result.count === 0) return res.status(404).json({ success: false, message: "Log no encontrado", data: null });
    res.json({ success: true, message: "Log eliminado", data: null });
  } catch (error) {
    next(error);
  }
});

router.delete("/", requireRoles(Role.ADMIN), async (_req, res, next) => {
  try {
    const result = await prismaClient.log.deleteMany({});
    res.json({ success: true, message: "Historial de logs eliminado", data: { count: result.count } });
  } catch (error) {
    next(error);
  }
});

export default router;
