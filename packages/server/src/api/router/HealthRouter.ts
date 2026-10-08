import { formatDate } from "@/utils/FormatDate";
import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Servidor " + process.env.NAME + " funcionando correctamente",
    timestamp: formatDate(new Date()),
    environment: process.env.NODE_ENV,
    version: process.env.VERSION || "1.0.0",
  });
});
