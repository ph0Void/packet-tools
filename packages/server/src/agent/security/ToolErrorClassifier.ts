import {
  resultadoIndicaFallo,
  textoDeSenalesDeFallo,
} from "../tools/readCacheMiddleware";

export type ToolErrorClass = "transient" | "definitive" | "unknown";

export interface ToolErrorInput {

  texto?: unknown;

  status?: string | null;

  error?: unknown;
}

export interface ToolErrorVerdict {
  clase: ToolErrorClass;

  motivo: string;

  reintentable: boolean;

  etiqueta: string;
}

const PREFIJOS_DEFINITIVOS: Array<[RegExp, string]> = [
  [/\[APROBACION_RECHAZADA\]/i, "el usuario rechazo la accion"],
  [/\[APROBACION_EXPIRADA\]/i, "la aprobacion expiro sin respuesta"],
  [/\[BLOQUEADO_ROL\]/i, "el rol del usuario no permite esta accion"],
  [/\[SESION_PROTEGIDA\]/i, "el lote cerraria la consola del usuario"],
  [/"code"\s*:\s*"TERMINAL_REQUIRED"/i, "el dispositivo objetivo no tiene consola abierta"],
  [/no tiene una consola abierta/i, "el dispositivo objetivo no tiene consola abierta"],
  [/\bACCESS_DENIED\b|\bDENIED\b|\bPROHIBIDO\b/i, "la accion esta bloqueada por politica"],
];

const PATRONES_DEFINITIVOS: Array<[RegExp, string]> = [

  [
    /%\s*\b(invalid input|incomplete command|ambiguous command|unknown command|unrecognized (command|input)|bad ip address|unknown host)\b/i,
    "el CLI rechazo la linea enviada",
  ],
  [
    /\bZodError\b|argumentos? invalids?|validacion fallida|invalid (type|value|argument)\b/i,
    "los argumentos de la llamada no son validos",
  ],
  [
    /\b(device|dispositivo|topology|topologia|node|nodo|project|proyecto|provider|skill|chat|file|equipo|usuario)\b[^\n]{0,40}\b(not found|no existe|no encontrado|desconocid[oa]|inexistente)\b/i,
    "el objeto de la llamada no existe",
  ],
  [
    /\b(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|no route to host|no such device)\b/i,
    "el destino no acepta conexiones ahora mismo",
  ],
  [
    /\bstatus(Code)?\W{0,3}4\d\d\b|\b(HTTP\s*)?(400|401|403|404|409|410|422)\b[^\n]{0,24}\b(error|status)\b/i,
    "el servidor rechazo la peticion",
  ],
  [/\b(puerto|port)\b[^\n]{0,30}\b(cerrado|closed|not open|no disponible)\b/i, "el recurso no esta disponible"],
  [/\bno (puedo|puedes|podemos) (acceder|conectar|ejecutar|enviar)\b/i, "la accion no se puede ejecutar sobre ese objetivo"],
  [/\b(debe|falta)\b[^\n]{0,30}\b(deviceName|providerId|id|nombre|numero)\b/i, "falta un argumento obligatorio"],
];

const PATRONES_TRANSITORIOS: Array<[RegExp, string]> = [
  [
    /\b(ETIMEDOUT|ECONNRESET|EPIPE|EAI_AGAIN|ECONNABORTED|socket hang up|read timed out|client timeout)\b/i,
    "la red fallo y puede recuperarse",
  ],
  [/\b(timed? ?out|timeout|tiempo de espera agotado)\b/i, "la operacion agoto su tiempo y puede reintentarse"],
  [
    /\b(status|http|error|servidor|server|devolvi[oó]|respuesta|c[oó]digo|code)[^\n]{0,30}\b(429|5\d\d)\b|\b(429|5\d\d)\b[^\n]{0,30}\b(status|http|error|servidor|server|response)\b/i,
    "el servidor devolvio un error recuperable",
  ],
  [/\b(rate limit|too many requests|demasiadas peticiones|throttl)\w*/i, "la peticion fue limitada por cuota"],
  [/\b(session|sesion|consola|terminal)\b[^\n]{0,30}\b(busy|ocupad|en uso|already in use)\b/i, "la sesion esta ocupada"],
  [/\b(try again|reintenta|reintentable|temporalmente)\b/i, "el propio error indica que se puede reintentar"],
  [
    /\b(extension|bridge|packet tracer|gns3)\b[^\n]{0,40}\b(not connected|desconectad[oa]|unavailable|no disponible)\b/i,
    "el puente con la simulacion no esta disponible",
  ],
  [
    /\b(dbus|chromadb|chroma|vector store|indice)\b[^\n]{0,40}\b(error|fallo|unavailable|no disponible)\b/i,
    "el servicio de apoyo no esta disponible",
  ],
];

function desconocido(motivo = "el resultado no declara un fallo"): ToolErrorVerdict {
  return {
    clase: "unknown",
    motivo,
    reintentable: true,
    etiqueta: "[SIN CLASIFICAR]",
  };
}

function aTexto(valor: unknown): string {
  if (valor == null) return "";
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.map(aTexto).join("\n");
  if (typeof valor === "object") {
    const bloque = valor as { content?: unknown; text?: unknown };
    if (bloque.content != null) return aTexto(bloque.content);
    if (bloque.text != null) return aTexto(bloque.text);
    try {
      return JSON.stringify(valor);
    } catch {
      return String(valor);
    }
  }
  return String(valor);
}

function textoDeEntrada(entrada: ToolErrorInput): string {
  const partes = [aTexto(entrada.texto)];
  if (entrada.error != null) {
    if (entrada.error instanceof Error) {
      partes.push(entrada.error.message, entrada.error.name);
    } else {
      partes.push(aTexto(entrada.error));
    }
  }

  return partes
    .filter(Boolean)
    .map((parte) => textoDeSenalesDeFallo(parte))
    .filter(Boolean)
    .join("\n");
}

export function resultadoEsFallo(entrada: ToolErrorInput): boolean {
  if (entrada.status === "error") return true;
  if (entrada.error != null) return true;
  const texto = aTexto(entrada.texto);
  if (!texto) return false;
  return resultadoIndicaFallo(texto);
}

export function clasificarErrorDeTool(entrada: ToolErrorInput): ToolErrorVerdict {
  const texto = textoDeEntrada(entrada);
  if (!texto.trim()) return desconocido();

  for (const [patron, motivo] of PREFIJOS_DEFINITIVOS) {
    if (patron.test(texto)) {
      return {
        clase: "definitive",
        motivo,
        reintentable: false,
        etiqueta: "[ERROR DEFINITIVO]",
      };
    }
  }

  for (const [patron, motivo] of PATRONES_DEFINITIVOS) {
    if (patron.test(texto)) {
      return {
        clase: "definitive",
        motivo,
        reintentable: false,
        etiqueta: "[ERROR DEFINITIVO]",
      };
    }
  }

  for (const [patron, motivo] of PATRONES_TRANSITORIOS) {
    if (patron.test(texto)) {
      return {
        clase: "transient",
        motivo,
        reintentable: true,
        etiqueta: "[ERROR TRANSITORIO]",
      };
    }
  }

  return desconocido(`el fallo no encaja en ningun patron conocido: ${primeraLinea(texto)}`);
}

function primeraLinea(texto: string): string {
  const linea = texto.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return linea.trim().slice(0, 160);
}

export function clasificarToolMessage(mensaje: {
  content?: unknown;
  status?: string | null;
  name?: string;
}): ToolErrorVerdict {
  return clasificarErrorDeTool({
    texto: mensaje.content,
    status: mensaje.status ?? null,
  });
}

export const REGLA_DE_REINTENTOS =
  "- Tool errors: [ERROR TRANSITORIO] (timeout, 5xx, busy session, quota) can be retried the same way; [ERROR DEFINITIVO] (invalid input, unknown command, missing device, rejected approval, blocked role) cannot: repeating the identical call returns the identical error. Fix the action (syntax, target, plan) or tell the user what blocks it.";
