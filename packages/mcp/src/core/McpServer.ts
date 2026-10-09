/**
 * Servidor MCP de Packet Tools.
 *
 * Capa de transporte del protocolo: crea el `McpServer` sobre **stdio** (el
 * estándar que consumen Claude Code, Codex CLI, OpenCode, GitHub Copilot, LM
 * Studio y cualquier cliente MCP) y le conecta las tools del registro.
 *
 * NO hay lógica condicional por cliente. El protocolo MCP ya es agnóstico: si
 * esto implementa bien el estándar, funciona igual en todos. Cualquier `if`
 * mirando el `clientInfo` sería un error de diseño.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolRegistry } from "@/core/ToolRegistry";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import { disconnectPrisma } from "@/prisma/lib/PrismaClient";
import { registrarDominios } from "@/domains/registro";
import { registrarSkillsComoRecursos } from "@/skills/SkillResources";
import {
  detenerBridge,
  estadoBridge,
  iniciarBridge,
} from "@/domains/packetTracer/PacketTracerBridgeServer";

/** Nombre y versión que el servidor declara ante el cliente MCP. */
const NOMBRE_SERVIDOR = "packet-tools-mcp";
const VERSION_SERVIDOR = "1.0.0";

/**
 * Construye el servidor MCP con todo registrado, sin arrancarlo.
 *
 * Se separa del arranque para poder reutilizarlo desde las pruebas (llamar a
 * las tools sin abrir stdio) y para que el orden de inicialización sea explícito.
 */
export function construirServidor(): McpServer {
  const server = new McpServer(
    { name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR },
    {
      capabilities: {
        tools: {},
        // `resources` se usa para exponer las skills del usuario como contenido
        // legible por el cliente (ver `skills/SkillResources.ts`). Los clientes
        // que no lo soporten siguen teniendo las tools `list_skills`/`read_skill`.
        resources: {},
      },
      instructions: construirInstrucciones(),
    },
  );

  registrarDominios();
  toolRegistry.conectarAServidor(server);
  registrarSkillsComoRecursos(server);

  return server;
}

/**
 * Instrucciones globales que el cliente MCP entrega al modelo.
 *
 * Es el único sitio donde se puede inyectar "contexto de sistema" de forma
 * estándar: MCP no tiene un canal de system prompt propio, así que el campo
 * `instructions` es la vía correcta (los clientes que lo ignoren pierden esto,
 * pero no el resto de la funcionalidad).
 */
function construirInstrucciones(): string {
  const dominios = toolRegistry
    .obtenerModulos()
    .map((modulo) => `- ${modulo.prefix}* — ${modulo.description}`)
    .join("\n");

  return [
    "Servidor MCP de Packet Tools: automatiza topologías de red sobre Cisco Packet Tracer, GNS3 y equipos reales (serial, telnet, ssh).",
    "",
    "Dominios disponibles (el prefijo de cada herramienta indica su dominio):",
    dominios,
    "",
    "Convenciones:",
    "- Los nombres de las herramientas llevan el prefijo del dominio: úsalo para saber qué herramienta corresponde a la petición del usuario.",
    "- Packet Tracer necesita la extensión de Packet Tracer conectada al bridge que aloja ESTE servidor MCP (por defecto `http://127.0.0.1:" +
      envConfig.MCP_BRIDGE_PORT +
      "`); no hace falta ningún otro servicio. Si falla, empieza por `packet_tracer_connection_status`, que dice si el bridge está escuchando y si la extensión está conectada.",
    "- Antes de configurar un equipo real, identifica su fabricante: `serial_list_ports` / `*_detect_vendor` te dicen con qué sintaxis hablarle.",
    "- Para tareas de varios pasos usa `plan_task` para acordar el plan y `execute_plan` para ejecutarlo; así queda un registro auditable en markdown.",
    "- Las instrucciones propias del usuario viven en skills: míralas con `list_skills` y léelas con `read_skill` antes de actuar en su dominio.",
    "",
    "Los errores devuelven un código y una sugerencia explícita de qué hacer a continuación: léela antes de reintentar.",
  ].join("\n");
}

/**
 * Arranca el servidor sobre stdio y deja el proceso vivo.
 *
 * stdio no tiene un evento de "cierre" fiable, así que la limpieza se engancha a
 * las señales del proceso. Es importante cerrar Prisma: si no, SQLite puede
 * quedarse con el archivo bloqueado.
 *
 * ORDEN DE ARRANQUE: el puente de Packet Tracer se lanza en paralelo, sin
 * bloquear el handshake de stdio. El handshake es lo único que el cliente está
 * esperando de verdad, y un puerto ocupado (u otro fallo al escuchar) NO puede
 * dejar al cliente MCP colgado sin servidor; solo deja sin Packet Tracer a este
 * proceso, y con un mensaje accionable.
 */
export async function arrancarServidor(): Promise<void> {
  const server = construirServidor();
  const transport = new StdioServerTransport();

  // Se dispara sin esperar: `iniciarBridge` no propaga fallos (los registra y
  // deja el puente inactivo), y el `catch` solo cubre lo que se le escapara.
  const puenteListo = iniciarBridge().catch((error: unknown) => {
    Logger.error("No se pudo iniciar el bridge de Packet Tracer.", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await server.connect(transport);

  // Se espera solo a que la promesa quede resuelta (o rechazada y registrada) para
  // que el mensaje de "listo" sea coherente con el estado real del puente.
  await puenteListo;

  Logger.info(
    `Servidor MCP listo: ${toolRegistry.contarTools()} herramientas de ${toolRegistry.obtenerModulos().length} dominios.`,
  );
  const puente = estadoBridge();
  Logger.info(
    puente.activo
      ? `Bridge de Packet Tracer escuchando en ${puente.url} (extensión conectada: ${puente.extensionConectada ? "sí" : "todavía no"}).`
      : `Bridge de Packet Tracer INACTIVO: las herramientas packet_tracer_* fallarán hasta reiniciar el MCP con MCP_BRIDGE_PORT=${envConfig.MCP_BRIDGE_PORT} libre.`,
  );

  let cerrando = false;
  const cerrar = async (motivo: string): Promise<void> => {
    if (cerrando) return;
    cerrando = true;
    Logger.info(`Cerrando servidor MCP (${motivo}).`);
    // El bridge se detiene ANTES de cerrar el transporte: si se dejara, el puerto
    // seguiría ocupado y el siguiente arranque se encontraría un EADDRINUSE.
    await detenerBridge().catch((error: unknown) => {
      Logger.debug("Error al detener el bridge de Packet Tracer.", { error: String(error) });
    });
    try {
      await server.close();
    } catch (error) {
      Logger.debug("Error al cerrar el servidor MCP.", { error: String(error) });
    }
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => void cerrar("SIGINT"));
  process.on("SIGTERM", () => void cerrar("SIGTERM"));
  // Cuando el cliente MCP cierra stdin, la sesión terminó.
  process.stdin.on("close", () => void cerrar("stdin cerrado"));
}
