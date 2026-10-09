
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


const NOMBRE_SERVIDOR = "packet-tools-mcp";
const VERSION_SERVIDOR = "1.2.3";


export function construirServidor(): McpServer {
  const server = new McpServer(
    { name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR },
    {
      capabilities: {
        tools: {},
        
        
        
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


export async function arrancarServidor(): Promise<void> {
  const server = construirServidor();
  const transport = new StdioServerTransport();

  
  
  const puenteListo = iniciarBridge().catch((error: unknown) => {
    Logger.error("No se pudo iniciar el bridge de Packet Tracer.", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await server.connect(transport);

  
  
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
  
  process.stdin.on("close", () => void cerrar("stdin cerrado"));
}
