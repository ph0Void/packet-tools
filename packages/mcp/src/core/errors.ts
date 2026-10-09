/**
 * Errores del servidor MCP con mensajes **accionables**.
 *
 * FILOSOFÍA: quien lee estos mensajes es un LLM que acaba de llamar a una tool y
 * tiene que decidir qué hacer después. Un "Error 500" o un "fallo" no le sirve
 * de nada: no puede distinguir "reintenta", "corrige el parámetro" o "pídele
 * algo al usuario". Por eso cada error dice tres cosas: qué pasó, por qué, y qué
 * debería hacer el modelo a continuación.
 *
 * Se siguen usando `Error` normales (con un `code` adjunto) en vez de una
 * jerarquía de clases para que el SDK de MCP y el `try/catch` de los handlers
 * los traten sin ceremonia.
 */

/** Códigos estables, pensados para que el modelo pueda ramificar por ellos. */
export type CodigoErrorMcp =
  | "VALIDACION" // el input no cumple el schema: el modelo puede corregirlo
  | "NO_CONFIGURADO" // falta configuración (BD, credenciales): lo arregla el usuario
  | "NO_DISPONIBLE" // el servicio remoto no responde (Packet Tracer, GNS3)
  | "NO_ENCONTRADO" // el recurso pedido no existe: el modelo puede listar y reintentar
  | "SIN_SESION" // hace falta abrir sesión antes
  | "TIMEOUT" // se agotó el tiempo
  | "OPERACION_FALLIDA" // el equipo respondió con un error
  | "INTERNO"; // fallo nuestro, no del modelo

export class McpToolError extends Error {
  readonly code: CodigoErrorMcp;
  /** Sugerencia explícita de qué hacer después (viaja en el texto al modelo). */
  readonly sugerencia?: string;
  /** Detalle estructurado para diagnóstico (no se muestra como texto crudo). */
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

  /**
   * Texto final que recibe el modelo.
   *
   * Incluye la sugerencia en línea (y no como campo aparte) porque el contenido
   * de una tool MCP viaja como texto: un campo estructurado se perdería.
   */
  toModelMessage(): string {
    return this.sugerencia
      ? `[${this.code}] ${this.message}\n\nQué hacer ahora: ${this.sugerencia}`
      : `[${this.code}] ${this.message}`;
  }
}

/** Azúcar para el caso más común: el input no pasó la validación de zod. */
export function errorDeValidacion(
  message: string,
  sugerencia = "Revisa los parámetros y vuelve a llamar a la herramienta con valores válidos.",
): McpToolError {
  return new McpToolError("VALIDACION", message, { sugerencia });
}

/**
 * Falta configuración que solo el usuario puede resolver (una fila en la BD, una
 * variable de entorno). El modelo NO debe reintentar en bucle: debe parar y
 * pedírselo al usuario.
 */
export function errorDeConfiguracion(
  message: string,
  sugerencia: string,
): McpToolError {
  return new McpToolError("NO_CONFIGURADO", message, { sugerencia });
}

/** El servicio remoto no está disponible (Packet Tracer cerrado, GNS3 caído). */
export function errorNoDisponible(
  message: string,
  sugerencia: string,
): McpToolError {
  return new McpToolError("NO_DISPONIBLE", message, { sugerencia });
}

/**
 * Convierte cualquier cosa lanzada en un `McpToolError`.
 *
 * Los `McpToolError` se devuelven tal cual (conservan su código y sugerencia);
 * el resto se envuelve como `INTERNO` conservando el mensaje original, porque un
 * mensaje técnico es más útil que uno genérico cuando algo se rompe de verdad.
 */
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

/**
 * Envuelve el handler de una tool para que ningún error salga sin normalizar.
 *
 * Centralizarlo aquí evita que cada dominio repita el mismo `try/catch` y, sobre
 * todo, garantiza que TODO error llegue al modelo con sugerencia.
 */
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
