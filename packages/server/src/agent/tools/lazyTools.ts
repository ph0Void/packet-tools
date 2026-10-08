import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { z } from "zod";
import { envConfig } from "@/config/EnvConfig";

export const LOAD_TOOLS_NAME = "load_tools";

export const PT_TOOLS_EAGER: readonly string[] = [
  "getNetwork",
  "getDeviceInfo",
  "runDeviceCommand",
  "readDeviceConsole",
  "sendPdu",
  "pingTopology",
  "validateTopology",
  "getRoutingTable",
];

const LOAD_TOOLS_DESCRIPTION = [
  "Search and activate the Packet Tracer tools that are NOT currently bound to you. Only a small core set is bound by default to keep the prompt small; everything else (addDevice, addLink, configureIosDevice, saveDeviceConfig, exportTopologyFile, generateNetworkReport, …) must be loaded here first.",
  "Call it with keywords (query) or with exact names (tools). The response gives the name, the purpose and the input schema of each match, and those tools stay available for the rest of the turn.",
].join(" ");

export function createLoadToolsTool(
  catalogo: () => ToolLike[],
) {
  return tool(
    async ({ query, tools }) => {
      const registro = catalogo();
      const Consultados = resolverTools(registro, { query, tools });
      if (Consultados.length === 0) {
        return JSON.stringify({
          activated: [],
          tools: [],
          available: registro.map((t) => t.name),
          message:
            "No tool matched. Use 'available' to see the names of the tools you can still load, or call it again with a different keyword.",
        });
      }
      return JSON.stringify({
        activated: Consultados.map((t) => t.name),
        tools: Consultados.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: esquemaDeTool(t),
        })),
        message: `Activated for the rest of this turn: ${Consultados.map((t) => t.name).join(", ")}.`,
      });
    },
    {
      name: LOAD_TOOLS_NAME,
      description: LOAD_TOOLS_DESCRIPTION,
      schema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            "Keywords of what you need, e.g. 'add device', 'configure ios', 'export', 'report', 'snapshot'",
          ),
        tools: z
          .array(z.string())
          .optional()
          .describe("Exact tool names, if you already know them"),
      }),
    },
  );
}

export interface ToolLike {
  name: string;
  description?: string;
  schema?: unknown;
}

export function esquemaDeTool(tool_: ToolLike): unknown {
  const schema = tool_.schema as { toJSONSchema?: () => unknown } | undefined;
  if (schema && typeof schema.toJSONSchema === "function") {
    try {
      return schema.toJSONSchema();
    } catch {
      return {};
    }
  }
  return {};
}

function normaliza(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MAX_POR_LLAMADA = 4;

export function resolverTools(
  catalogo: readonly ToolLike[],
  filtro: { query?: string | null; tools?: readonly string[] | null },
): ToolLike[] {
  const registro = catalogo.filter((t) => t.name !== LOAD_TOOLS_NAME);

  const porNombre = (filtro.tools ?? [])
    .map((pedido) => registro.find((t) => t.name === String(pedido).trim()))
    .filter((t): t is ToolLike => !!t);
  if (porNombre.length > 0) return porNombre.slice(0, MAX_POR_LLAMADA);

  const consulta = normaliza(String(filtro.query ?? ""));
  if (!consulta) return [];
  const palabras = consulta.split(" ").filter((p) => p.length > 2);
  if (palabras.length === 0) return [];

  const puntuados = registro
    .map((tool_) => {
      const nombre = normaliza(tool_.name);
      const descripcion = normaliza(tool_.description ?? "");
      let puntos = 0;
      for (const palabra of palabras) {
        if (nombre.includes(palabra)) puntos += 3;
        if (descripcion.includes(palabra)) puntos += 1;
      }
      return { tool_, puntos };
    })
    .filter((candidato) => candidato.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.tool_.name.localeCompare(b.tool_.name));

  return puntuados.slice(0, MAX_POR_LLAMADA).map((candidato) => candidato.tool_);
}

const activadosPorHilo = new Map<string, Set<string>>();

const MAX_HILOS = 200;

function claveDeHilo(threadId?: string): string {
  return threadId ?? "sin-hilo";
}

export function toolsActivadas(threadId?: string): string[] {
  return Array.from(activadosPorHilo.get(claveDeHilo(threadId)) ?? []);
}

export function registrarToolsActivadas(
  threadId: string | undefined,
  nombres: readonly string[],
): void {
  if (nombres.length === 0) return;
  const clave = claveDeHilo(threadId);
  const actual = activadosPorHilo.get(clave) ?? new Set<string>();
  for (const nombre of nombres) actual.add(nombre);

  activadosPorHilo.delete(clave);
  activadosPorHilo.set(clave, actual);
  while (activadosPorHilo.size > MAX_HILOS) {
    const masAntiguo = activadosPorHilo.keys().next().value;
    if (masAntiguo === undefined) break;
    activadosPorHilo.delete(masAntiguo);
  }
}

export function resetToolsActivadas(threadId?: string): void {
  if (!threadId) {
    activadosPorHilo.clear();
    return;
  }
  activadosPorHilo.delete(claveDeHilo(threadId));
}

export function nombresActivadosEn(contenido: unknown): string[] {
  if (typeof contenido !== "string" || !contenido.trim().startsWith("{")) {
    return [];
  }
  try {
    const payload = JSON.parse(contenido) as { activated?: unknown };
    if (!Array.isArray(payload.activated)) return [];
    return payload.activated
      .filter((n): n is string => typeof n === "string")
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export interface LazyToolLayer<T extends ToolLike = ToolLike> {

  declaradas: Array<T | ReturnType<typeof createLoadToolsTool>>;

  middleware: AgentMiddleware;

  eager: string[];

  diferidas: string[];

  diferidasSet: Set<string>;
}

export const LAZY_TOOLS_RULE = [
  "Toolset on demand: only the core tools above are bound right now (reads, PDU, validation and routing table). The rest of the Packet Tracer tools are NOT available until you load them with 'load_tools' (pass keywords or exact names): it returns what each one does and its input schema, and they stay bound for the rest of the turn. Load a tool BEFORE you need it, and never assume a tool you have not loaded exists.",
].join(" ");

export function buildLazyToolLayer<T extends ToolLike>(
  catalogo: readonly T[],
): LazyToolLayer<T> {
  const registro = catalogo.filter((t) => t.name !== LOAD_TOOLS_NAME);
  const eagerSet = new Set(PT_TOOLS_EAGER);
  const eager = registro.filter((t) => eagerSet.has(t.name));
  const diferidas = registro.filter((t) => !eagerSet.has(t.name));
  const loadTools = createLoadToolsTool(() => registro);
  const diferidasSet = new Set(diferidas.map((t) => t.name));

  return {
    declaradas: [...registro, loadTools],
    eager: eager.map((t) => t.name),
    diferidas: diferidas.map((t) => t.name),
    diferidasSet,
    middleware: lazyToolsMiddleware({ diferidas: diferidasSet }),
  };
}

export function capaDeToolsPerezosas<T extends ToolLike>(
  catalogo: readonly T[],
  habilitadas: boolean = lazyToolsHabilitadas(),
): LazyToolLayer<T> | null {
  if (!habilitadas) return null;
  return buildLazyToolLayer(catalogo);
}

export interface LazyToolsMiddlewareOptions {

  diferidas: ReadonlySet<string>;
}

export function lazyToolsMiddleware(
  options: LazyToolsMiddlewareOptions,
): AgentMiddleware {
  const diferidas = options.diferidas;

  return createMiddleware({
    name: "LazyTools",

    beforeAgent: (_state, runtime) => {
      resetToolsActivadas(runtime.configurable?.thread_id);
    },
    afterAgent: (_state, runtime) => {
      resetToolsActivadas(runtime.configurable?.thread_id);
    },

    wrapToolCall: async (request, handler) => {
      const resultado = await handler(request);
      if (request.toolCall.name !== LOAD_TOOLS_NAME) return resultado;
      const threadId = request.runtime?.configurable?.thread_id;
      const activadas = ToolMessage.isInstance(resultado)
        ? nombresActivadosEn(resultado.content)
        : [];
      registrarToolsActivadas(threadId, activadas);
      return resultado;
    },

    wrapModelCall: async (request, handler) => {
      const threadId = request.runtime?.configurable?.thread_id;
      const activadas = new Set(toolsActivadas(threadId));
      const ligadas = Array.isArray(request.tools)
        ? request.tools.filter((t) => {
            const nombre = (t as { name?: string }).name ?? "";
            if (!diferidas.has(nombre)) return true;
            return activadas.has(nombre);
          })
        : request.tools;
      return handler({ ...request, tools: ligadas });
    },
  });
}

export function lazyToolsHabilitadas(): boolean {
  return envConfig.AGENT_LAZY_TOOLS !== false;
}
