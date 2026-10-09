


export type CodigoErrorMcp =
  | "VALIDACION" 
  | "NO_CONFIGURADO" 
  | "NO_DISPONIBLE" 
  | "NO_ENCONTRADO" 
  | "SIN_SESION" 
  | "TIMEOUT" 
  | "OPERACION_FALLIDA" 
  | "INTERNO"; 

export class McpToolError extends Error {
  readonly code: CodigoErrorMcp;
  
  readonly sugerencia?: string;
  
  readonly detalle?: Record<string, unknown>;

  constructor(
    code: CodigoErrorMcp,
    message: string,
    opciones: { sugerencia?: string; detalle?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.sugerencia = opciones.sugerencia;
    this.detalle = opciones.detalle;
  }

  
  toModelMessage(): string {
    return this.sugerencia
      ? `[${this.code}] ${this.message}\n\nQué hacer ahora: ${this.sugerencia}`
      : `[${this.code}] ${this.message}`;
  }
}


export function errorDeValidacion(
  message: string,
  sugerencia = "Revisa los parámetros y vuelve a llamar a la herramienta con valores válidos.",
): McpToolError {
  return new McpToolError("VALIDACION", message, { sugerencia });
}


export function errorDeConfiguracion(
  message: string,
  sugerencia: string,
): McpToolError {
  return new McpToolError("NO_CONFIGURADO", message, { sugerencia });
}


export function errorNoDisponible(
  message: string,
  sugerencia: string,
): McpToolError {
  return new McpToolError("NO_DISPONIBLE", message, { sugerencia });
}


export function normalizarError(error: unknown): McpToolError {
  if (error instanceof McpToolError) return error;

  if (error instanceof Error) {
    return new McpToolError("INTERNO", error.message, {
      sugerencia:
        "Es un fallo del servidor MCP, no de los parámetros. Repórtalo al usuario con este mensaje y no repitas la misma llamada esperando otro resultado.",
      detalle: { stack: error.stack },
    });
  }

  return new McpToolError("INTERNO", String(error), {
    sugerencia:
      "Es un fallo del servidor MCP, no de los parámetros. Repórtalo al usuario y no repitas la llamada.",
  });
}


export function conErroresNormalizados<A, R>(
  handler: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      throw normalizarError(error);
    }
  };
}
