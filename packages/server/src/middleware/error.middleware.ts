import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {

  if (error instanceof ZodError) {
    return res.status(400).json({ success: false, message: "Datos de entrada inválidos", data: error.issues });
  }

  if ((error as any)?.code === "P2002") {
    return res.status(409).json({ success: false, message: "El registro ya existe", data: null });
  }
  const message = error instanceof Error ? error.message : "Error interno del servidor";
  return res.status(500).json({ success: false, message, data: null });
};
