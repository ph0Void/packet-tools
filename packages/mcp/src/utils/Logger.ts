/**
 * Logger del servidor MCP.
 *
 * REGLA CRÍTICA: **nunca escribe en stdout**. Un servidor MCP sobre stdio usa
 * stdout como canal exclusivo del protocolo JSON-RPC; un `console.log` suelto
 * inyecta texto que el cliente no puede parsear y rompe la sesión entera (el
 * síntoma típico es "el servidor MCP no responde" sin más pista).
 *
 * Por eso todo sale por stderr, que es donde el cliente y el usuario lo esperan.
 */
import { envConfig } from "@/config/EnvConfig";

/** Niveles que se emiten siempre (aunque MCP_DEBUG esté apagado). */
type NivelLog = "info" | "warning" | "error" | "debug";

/**
 * Escribe una línea de log por stderr.
 *
 * `debug` solo se emite con `MCP_DEBUG=true` para no llenar el log del cliente
 * con el detalle de cada tool en uso normal.
 */
function emitir(nivel: NivelLog, mensaje: string, datos?: unknown): void {
  if (nivel === "debug" && !envConfig.MCP_DEBUG) return;

  const marca = new Date().toISOString();
  const etiqueta = nivel.toUpperCase();
  const cola = datos === undefined ? "" : ` ${serializar(datos)}`;

  // stderr, NUNCA stdout (ver cabecera del módulo).
  process.stderr.write(`[${marca}] [MCP] [${etiqueta}] ${mensaje}${cola}\n`);
}

/** Serializa datos de log sin reventar con referencias circulares. */
function serializar(datos: unknown): string {
  if (typeof datos === "string") return datos;
  try {
    return JSON.stringify(datos);
  } catch {
    return "[datos no serializables]";
  }
}

/** Recorta textos largos en los logs (una consola entera no aporta nada). */
export function recortarParaLog(texto: string, maximo = 400): string {
  const limpio = String(texto ?? "");
  return limpio.length > maximo ? `${limpio.slice(0, maximo)}...(+${limpio.length - maximo})` : limpio;
}

export const Logger = {
  info(mensaje: string, datos?: unknown): void {
    emitir("info", mensaje, datos);
  },
  warning(mensaje: string, datos?: unknown): void {
    emitir("warning", mensaje, datos);
  },
  error(mensaje: string, datos?: unknown): void {
    emitir("error", mensaje, datos);
  },
  debug(mensaje: string, datos?: unknown): void {
    emitir("debug", mensaje, datos);
  },
  /**
   * Traza de una llamada a tool. Se separa de `debug` porque se puede activar
   * sola con `MCP_TRACE_TOOLS` sin activar todo el modo depuración.
   */
  traza(mensaje: string, datos?: unknown): void {
    if (!envConfig.MCP_TRACE_TOOLS) return;
    emitir("debug", mensaje, datos);
  },
};
