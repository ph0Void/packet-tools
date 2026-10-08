import { z } from "zod";
import { Role, TypeModel } from "@/prisma/generated/enums";
import { Router } from "express";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { getModelEmbeddingProvider, getModelTextProvider } from "@/config/ModelProviderConfig";
import { configService } from "@/service/ConfigService";
import { vectorStoreService } from "@/service/VectorStoreService";
import { resourceRouter } from "./ResourceRouter";

const router = Router();
const input = z.object({ systemPrompt: z.string() });

const TEST_TIMEOUT_MS = 15000;
const MASKED_API_KEY = "[configured]";

function mapTestError(error: unknown, modelName: string): string {
  const err = error as any;
  if (err?.__connectionTestTimeout) return "La prueba excedió el tiempo de espera (15 s).";

  const message = typeof err?.message === "string" ? err.message : String(error ?? "");
  const lower = message.toLowerCase();
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? 0);
  const code = String(err?.code ?? err?.cause?.code ?? err?.cause?.cause?.code ?? "").toUpperCase();

  if (
    ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code) ||
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("connection refused") ||
    lower.includes("socket hang up")
  ) {
    return "No se pudo conectar con el endpoint configurado.";
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("api key not valid") ||
    lower.includes("forbidden") ||
    lower.includes("permission denied")
  ) {
    return "API Key inválida o sin permisos para el proveedor.";
  }

  if (status === 404 || lower.includes("not found") || lower.includes("does not exist") || lower.includes("no such model") || lower.includes("model_not_found")) {
    return `El modelo "${modelName}" no existe o no está disponible.`;
  }

  if (lower.includes("api key") || lower.includes("apikey") || lower.includes("api_key")) {
    return message;
  }

  return message || "No se pudo completar la prueba de conexión.";
}

router.post("/models/test", authMiddleware, requireRoles(Role.ADMIN), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, any>;
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const modelName = typeof body.modelName === "string" ? body.modelName.trim() : "";
  if (!provider) return res.status(400).json({ success: false, message: "El campo provider es obligatorio." });
  if (!modelName) return res.status(400).json({ success: false, message: "El campo modelName es obligatorio." });

  const typeModel = String(body.typeModel ?? "CHAT").toUpperCase() === "EMBEDDING" ? "EMBEDDING" : "CHAT";
  const rawApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  let stored: { apiKey: string | null; baseUrl: string | null; temperature: number } | null = null;
  if (!rawApiKey || rawApiKey === MASKED_API_KEY) {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Falta la API Key: envía una apiKey o el id de un proveedor guardado para reutilizar sus credenciales.",
      });
    }
    stored = await prismaClient.modelProvider.findUnique({ where: { id } });
    if (!stored) return res.status(404).json({ success: false, message: "No se encontró el proveedor guardado con el id indicado." });
  }

  const apiKey = rawApiKey && rawApiKey !== MASKED_API_KEY ? rawApiKey : stored?.apiKey ?? "";
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : stored?.baseUrl ?? undefined;
  const temperature = typeof body.temperature === "number" ? body.temperature : stored?.temperature ?? 0.7;

  const startedAt = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {

    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        const error: any = new Error("Tiempo de espera agotado");
        error.__connectionTestTimeout = true;
        reject(error);
      }, TEST_TIMEOUT_MS);
    });

    const probe = (async () => {
      if (typeModel === "EMBEDDING") {
        const embeddings: any = getModelEmbeddingProvider({ provider, model: modelName, apiKey, baseUrl, temperature });
        await embeddings.embedQuery("ping");
      } else {
        const chat: any = getModelTextProvider({ provider, model: modelName, apiKey, baseUrl, temperature });
        await chat.invoke("ping");
      }
    })();

    await Promise.race([probe, timeout]);

    const latencyMs = Date.now() - startedAt;
    return res.json({
      success: true,
      message: `Conexión correcta (${latencyMs} ms).`,
      data: { ok: true, latencyMs, provider, model: modelName },
    });
  } catch (error) {

    return res.status(400).json({ success: false, message: mapTestError(error, modelName) });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
});

router.use(
  "/models",
  resourceRouter("modelProvider", {
    roles: [Role.ADMIN],

    afterWrite: () => vectorStoreService.resetMemoryStore(),
  }),
);

const DEFAULT_PROMPT = "Eres un asistente de red útil y profesional.";

router.get("/available-models", authMiddleware, async (req, res, next) => {
  try {
    const role = req.user!.role as string;
    const models = await prismaClient.modelProvider.findMany({
      where: {
        isActive: true,
        typeModel: TypeModel.CHAT,
        userPermission: { contains: role },
      },
      orderBy: { createdAt: "desc" },
    });

    const safe = models.map((m) => {
      const copy: any = { ...m };
      if (copy.apiKey) copy.apiKey = "[configured]";
      return copy;
    });
    res.json({ success: true, message: "Modelos disponibles", data: safe });
  } catch (error) {
    next(error);
  }
});

router.get("/", authMiddleware, async (_req, res, next) => {
  try {
    let config = await prismaClient.configuration.findFirst();
    if (!config) {
      config = await prismaClient.configuration.create({ data: { systemPrompt: DEFAULT_PROMPT } });
    } else if (config.systemPrompt == null) {

      config = await prismaClient.configuration.update({
        where: { id: config.id },
        data: { systemPrompt: DEFAULT_PROMPT },
      });
    }
    res.json({
      success: true,
      message: "Configuración obtenida",
      data: {
        id: config.id,
        systemPrompt: config.systemPrompt,

        agentLogsEnabled: config.agentLogsEnabled ?? true,
      },
    });
  } catch (error) {
    next(error);
  }
});

const logsInput = z.object({ agentLogsEnabled: z.boolean() });

router.put("/logs", authMiddleware, requireRoles(Role.ADMIN), async (req, res, next) => {
  try {
    const value = logsInput.parse(req.body);
    const agentLogsEnabled = await configService.setAgentLogsEnabled(value.agentLogsEnabled);
    res.json({
      success: true,
      message: agentLogsEnabled
        ? "Traza del agente activada"
        : "Traza del agente desactivada",
      data: { agentLogsEnabled },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", authMiddleware, requireRoles(Role.ADMIN), async (req, res, next) => {
  try {
    const value = input.parse(req.body);
    const existing = await prismaClient.configuration.findFirst();
    const data = existing
      ? await prismaClient.configuration.update({ where: { id: existing.id }, data: { systemPrompt: value.systemPrompt } })
      : await prismaClient.configuration.create({ data: { systemPrompt: value.systemPrompt } });
    res.json({ success: true, message: "Configuración actualizada", data });
  } catch (error) {
    next(error);
  }
});

export default router;
