
import { envConfig } from "@/config/EnvConfig";


type NivelLog = "info" | "warning" | "error" | "debug";


function emitir(nivel: NivelLog, mensaje: string, datos?: unknown): void {
  if (nivel === "debug" && !envConfig.MCP_DEBUG) return;

  const marca = new Date().toISOString();
  const etiqueta = nivel.toUpperCase();
  const cola = datos === undefined ? "" : ` ${serializar(datos)}`;

  
  process.stderr.write(`[${marca}] [MCP] [${etiqueta}] ${mensaje}${cola}\n`);
}


function serializar(datos: unknown): string {
  if (typeof datos === "string") return datos;
  try {
    return JSON.stringify(datos);
  } catch {
    return "[datos no serializables]";
  }
}


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
  
  traza(mensaje: string, datos?: unknown): void {
    if (!envConfig.MCP_TRACE_TOOLS) return;
    emitir("debug", mensaje, datos);
  },
};
