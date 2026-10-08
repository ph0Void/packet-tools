import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";

export const TOOLS_LECTURA_PT = [
  "getNetwork",
  "getDeviceInfo",
  "getSimulationStatus",
  "getPduResults",
  "getCommandLog",

  "runDeviceCommand",
  "validateTopology",
  "listDeviceModels",
  "listDeviceModules",
  "subnetCalc",
  "getDeviceConfig",
  "generateNetworkReport",
  "listDeviceProviders",
  "findDeviceByName",
] as const;

export const NOTA_CACHE = "[caché del turno] resultado sin cambios intermedias: ";

const MAX_NODOS_FALLO = 4000;

const MAX_PROFUNDIDAD_FALLO = 6;

const ESTADO_DE_ERROR = new Set(["error", "failed", "fallido", "ko"]);

function esFalloDeCadena(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  const normalizado = valor.trim().toLowerCase();
  return ESTADO_DE_ERROR.has(normalizado);
}

function esSenalDeFallo(llave: string, valor: unknown): boolean {
  switch (llave.toLowerCase()) {

    case "success":
    case "succes":
      return valor === false;
    case "timedout":
      return valor === true;

    case "verificacionok":
      return valor === false;
    case "status":
      return esFalloDeCadena(valor);
    case "error":
    case "errormessage":
    case "error_message":

      return valor !== undefined && valor !== null && valor !== "";
    default:
      return false;
  }
}

const MARCA_DE_FALLO_TEXTUAL =
  /% ?(?:invalid input|incomplete command|ambiguous command|unknown command|unrecognized|bad ip address|error)/i;

function buscaFallo(
  nodo: unknown,
  profundidad: number,
  estado: { nodos: number },
): boolean {
  if (nodo === null || typeof nodo !== "object") return false;
  if (profundidad >= MAX_PROFUNDIDAD_FALLO) return false;

  for (const [llave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    if (++estado.nodos > MAX_NODOS_FALLO) return false;
    if (esSenalDeFallo(llave, valor)) return true;
    if (Array.isArray(valor)) {

      for (const item of valor) {
        if (buscaFallo(item, profundidad + 1, estado)) return true;
      }
    } else if (typeof valor === "string") {

      if (MARCA_DE_FALLO_TEXTUAL.test(valor)) return true;
    } else if (buscaFallo(valor, profundidad + 1, estado)) {
      return true;
    }
  }
  return false;
}

export function resultadoIndicaFallo(contenido: string): boolean {
  const texto = contenido.trim();
  if (!texto) return true; // Sin contenido no hay lectura que servir.
  if (texto.startsWith("{") || texto.startsWith("[")) {
    try {
      return buscaFallo(JSON.parse(texto), 0, { nodos: 0 });
    } catch {

    }
  }
  return MARCA_DE_FALLO_TEXTUAL.test(texto);
}

function esJsonDePayload(texto: string): boolean {
  return texto.startsWith("{") || texto.startsWith("[");
}

function senalesDePayload(nodo: unknown, salida: string[], estado: { nodos: number }): void {
  if (nodo === null || typeof nodo !== "object") return;
  if (estado.nodos++ > MAX_NODOS_FALLO) return;

  if (Array.isArray(nodo)) {
    for (const item of nodo) senalesDePayload(item, salida, estado);
    return;
  }

  for (const [llave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    if (estado.nodos++ > MAX_NODOS_FALLO) return;
    if (valor === null || typeof valor === "boolean") {

      if (esSenalDeFallo(llave, valor)) salida.push(`"${llave}": ${JSON.stringify(valor)}`);
      continue;
    }
    if (typeof valor === "number") {
      if (valor !== 0) salida.push(`"${llave}": ${valor}`);
      continue;
    }
    if (typeof valor === "string") {
      if (valor.trim().length > 0) salida.push(`"${llave}": ${JSON.stringify(valor)}`);
      continue;
    }
    const anidado: string[] = [];
    senalesDePayload(valor, anidado, estado);
    if (anidado.length > 0) salida.push(`{${anidado.join(", ")}}`);
  }
}

export function textoDeSenalesDeFallo(contenido: string): string {
  const texto = String(contenido ?? "");
  const recortado = texto.trim();
  if (!esJsonDePayload(recortado)) return texto;
  try {
    const salida: string[] = [];
    senalesDePayload(JSON.parse(recortado), salida, { nodos: 0 });

    return salida.join("\n");
  } catch {

    return texto;
  }
}

const MAX_ENTRADAS = 512;

const entradas = new Map<string, string>();

function prefijoDe(threadId?: string): string {
  return `${threadId ?? "sin-hilo"}::`;
}

function claveDe(
  threadId: string | undefined,
  herramienta: string,
  args: unknown,
): string {
  return `${prefijoDe(threadId)}${herramienta}::${JSON.stringify(args)}`;
}

export function resetReadCache(threadId?: string): void {
  if (!threadId) {
    entradas.clear();
    return;
  }
  const prefijo = prefijoDe(threadId);
  for (const clave of Array.from(entradas.keys())) {
    if (clave.startsWith(prefijo)) entradas.delete(clave);
  }
}

function guardar(clave: string, texto: string): void {

  entradas.delete(clave);
  while (entradas.size >= MAX_ENTRADAS) {
    const masAntigua = entradas.keys().next().value;
    if (masAntigua === undefined) break;
    entradas.delete(masAntigua);
  }
  entradas.set(clave, texto);
}

export interface ReadCacheOptions {

  tools?: readonly string[];
}

export function readCacheMiddleware(
  options: ReadCacheOptions = {},
): AgentMiddleware {
  const lecturas = new Set<string>(options.tools ?? TOOLS_LECTURA_PT);

  return createMiddleware({
    name: "ReadCache",

    beforeAgent: (_state, runtime) => {
      resetReadCache(runtime.configurable?.thread_id);
    },

    wrapToolCall: async (request, handler) => {
      const threadId = request.runtime?.configurable?.thread_id;
      const herramienta = request.toolCall.name;

      if (!lecturas.has(herramienta)) {
        resetReadCache(threadId);
        return handler(request);
      }

      const clave = claveDe(threadId, herramienta, request.toolCall.args);
      const guardado = entradas.get(clave);
      if (guardado !== undefined) {

        return new ToolMessage({
          tool_call_id: request.toolCall.id ?? "",
          name: herramienta,
          content: NOTA_CACHE + guardado,
        });
      }

      const resultado = await handler(request);
      if (
        ToolMessage.isInstance(resultado) &&
        resultado.status !== "error" &&
        typeof resultado.content === "string" &&
        resultado.content.length > 0 &&

        !resultadoIndicaFallo(resultado.content)
      ) {
        guardar(clave, resultado.content);
      }
      return resultado;
    },

    afterAgent: (_state, runtime) => {
      resetReadCache(runtime.configurable?.thread_id);
    },
  });
}
