import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { Role } from "@/prisma/generated/enums";
import { cronJobService } from "@/service/CronJobService";
import { jobScheduler } from "@/service/JobScheduler";

const router = Router();

const scheduledAtSchema = z.iso.datetime({ offset: true }).optional()
  .refine((value) => value == null || new Date(value).getTime() > Date.now(), { message: "La fecha de ejecución debe ser futura." });
const input = z.object({ name: z.string().min(1), description: z.string().optional(), prompt: z.string().optional(), schedule: z.string().optional(), cronExpression: z.string().optional(), type: z.string().optional(), actionType: z.enum(["STANDARD", "INTELLIGENT"]).optional(), config: z.record(z.string(), z.any()).optional(), payload: z.string().optional(), enabled: z.boolean().optional(), isActive: z.boolean().optional(), scheduledAt: scheduledAtSchema, deviceProviderId: z.string().optional(), topologyId: z.string().optional() });
type JobInput = z.infer<typeof input>;

const toCreateData = (value: JobInput, userId?: string) => ({ name: value.name, description: value.description, prompt: value.prompt, cronExpression: value.cronExpression ?? value.schedule ?? "* * * * *", actionType: value.actionType ?? (value.type === "INTELLIGENCE" ? "INTELLIGENT" : "STANDARD"), payload: value.payload ?? (value.config ? JSON.stringify(value.config) : undefined), isActive: value.isActive ?? value.enabled ?? true, deviceProviderId: value.deviceProviderId, topologyId: value.topologyId, ...(userId ? { userId } : {}) });

const toUpdateData = (value: Partial<JobInput>) => {
  const data: Record<string, unknown> = {};
  if (value.name !== undefined) data.name = value.name;
  if (value.description !== undefined) data.description = value.description;
  if (value.prompt !== undefined) data.prompt = value.prompt;
  if (value.cronExpression !== undefined || value.schedule !== undefined) data.cronExpression = value.cronExpression ?? value.schedule;
  if (value.actionType !== undefined || value.type !== undefined) data.actionType = value.actionType ?? (value.type === "INTELLIGENCE" ? "INTELLIGENT" : "STANDARD");
  if (value.payload !== undefined) data.payload = value.payload;
  else if (value.config !== undefined) data.payload = JSON.stringify(value.config);
  if (value.isActive !== undefined || value.enabled !== undefined) data.isActive = value.isActive ?? value.enabled ?? true;
  if (value.deviceProviderId !== undefined) data.deviceProviderId = value.deviceProviderId;
  if (value.topologyId !== undefined) data.topologyId = value.topologyId;

  if (typeof value.scheduledAt === "string") data.scheduledAt = new Date(value.scheduledAt);
  return data;
};

router.use(authMiddleware);

router.get("/", async (req, res, next) => {
  try {
    const usuario = { id: req.user!.id, role: String(req.user!.role) };
    const resultado = await cronJobService.findAllVisible(usuario);

    if (!resultado.success) return next(new Error(resultado.message));
    res.json({ success: true, message: resultado.message, data: resultado.data });
  } catch (error) {
    next(error);
  }
});

router.get("/scheduler", requireRoles(Role.ADMIN, Role.STAFF), (_req, res) => {
  try {
    res.json({
      success: true,
      message: "Estado del planificador obtenido",
      data: jobScheduler.instantaneaProgramador(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error obteniendo el planificador", data: null });
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const usuario = { id: req.user!.id, role: String(req.user!.role) };
    const resultado = await cronJobService.findVisibleById(String(req.params.id), usuario);
    if (!resultado.success) return next(new Error(resultado.message));

    if (!resultado.data) return res.status(404).json({ success: false, message: "Trabajo no encontrado", data: null });
    res.json({ success: true, message: "Trabajo obtenido", data: resultado.data });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const value = input.parse(req.body);
    const scheduledAt = typeof value.scheduledAt === "string" ? new Date(value.scheduledAt) : undefined;
    const resultado = await cronJobService.create({
      ...toCreateData(value, req.user!.id),

      ...(scheduledAt ? { scheduledAt, cronExpression: null } : {}),
    } as never);
    if (!resultado.success) {
      return res.status(400).json({ success: false, message: resultado.message, data: null });
    }
    res.status(201).json({ success: true, message: "Trabajo creado", data: resultado.data });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const value = input.partial().parse(req.body);
    const resultado = await cronJobService.update(String(req.params.id), toUpdateData(value) as never);
    if (!resultado.success) {
      return res.status(400).json({ success: false, message: resultado.message, data: null });
    }
    res.json({ success: true, message: "Trabajo actualizado", data: resultado.data });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const resultado = await cronJobService.delete(String(req.params.id));
    if (!resultado.success) {
      return res.status(400).json({ success: false, message: resultado.message, data: null });
    }
    res.json({ success: true, message: "Trabajo eliminado", data: null });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/run", requireRoles(Role.ADMIN, Role.STAFF), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const actual = await cronJobService.findById(id);
    if (!actual.data) return res.status(404).json({ success: false, message: "Trabajo no encontrado", data: null });

    const resultado = await jobScheduler.ejecutarJobAhora(id);
    const tras = await cronJobService.findById(id);

    res.json({
      success: true,
      message: "Trabajo ejecutado",
      data: {
        ...(resultado ?? {
          jobId: id,
          nombre: actual.data.name,
          ejecutado: false,
          ok: false,
          duracionMs: 0,
          error: "No se pudo ejecutar el trabajo (puede que ya estuviera en ejecución).",
        }),

        status: tras.data?.status ?? null,
        isActive: tras.data?.isActive ?? null,
        nextRun: tras.data?.nextRun ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
