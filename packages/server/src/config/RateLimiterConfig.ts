import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { envConfig } from "./EnvConfig";

function maxMensajes(): number {
  return Number(process.env.CHAT_MESSAGES_RATE_LIMIT) || envConfig.CHAT_MESSAGES_RATE_LIMIT;
}

export const messagesLimiter = rateLimit({
  windowMs: 60_000,
  max: () => maxMensajes(),

  keyGenerator: (req) => {
    const userId = (req as { user?: { id?: string } }).user?.id;
    return userId ? `u:${userId}` : `ip:${ipKeyGenerator(String(req.ip ?? ""))}`;
  },
  message: { success: false, message: "Demasiados mensajes, intenta de nuevo en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalLimiter = rateLimit({
  windowMs: envConfig.RATE_LIMIT_REFRESH, // 15 minutos
  max: envConfig.RATE_LIMIT_REQUESTS, // 100 requests
  message: {
    success: false,
    message:
      "Demasiadas solicitudes desde esta IP, por favor intenta de nuevo después de 15 minutos.",
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});
