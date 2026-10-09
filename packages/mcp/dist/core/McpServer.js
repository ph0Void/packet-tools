"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.construirServidor = construirServidor;
exports.arrancarServidor = arrancarServidor;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const ToolRegistry_1 = require("./ToolRegistry.js");
const EnvConfig_1 = require("../config/EnvConfig.js");
const Logger_1 = require("../utils/Logger.js");
const PrismaClient_1 = require("../prisma/lib/PrismaClient.js");
const registro_1 = require("../domains/registro.js");
const SkillResources_1 = require("../skills/SkillResources.js");
const PacketTracerBridgeServer_1 = require("../domains/packetTracer/PacketTracerBridgeServer.js");
const NOMBRE_SERVIDOR = "packet-tools-mcp";
const VERSION_SERVIDOR = "1.2.3";
function construirServidor() {
    const server = new mcp_js_1.McpServer({ name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR }, {
        capabilities: {
            tools: {},
            resources: {},
        },
        instructions: construirInstrucciones(),
    });
    (0, registro_1.registrarDominios)();
    ToolRegistry_1.toolRegistry.conectarAServidor(server);
    (0, SkillResources_1.registrarSkillsComoRecursos)(server);
    return server;
}
function construirInstrucciones() {
    const dominios = ToolRegistry_1.toolRegistry
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
            EnvConfig_1.envConfig.MCP_BRIDGE_PORT +
            "`); no hace falta ningún otro servicio. Si falla, empieza por `packet_tracer_connection_status`, que dice si el bridge está escuchando y si la extensión está conectada.",
        "- Antes de configurar un equipo real, identifica su fabricante: `serial_list_ports` / `*_detect_vendor` te dicen con qué sintaxis hablarle.",
        "- Para tareas de varios pasos usa `plan_task` para acordar el plan y `execute_plan` para ejecutarlo; así queda un registro auditable en markdown.",
        "- Las instrucciones propias del usuario viven en skills: míralas con `list_skills` y léelas con `read_skill` antes de actuar en su dominio.",
        "",
        "Los errores devuelven un código y una sugerencia explícita de qué hacer a continuación: léela antes de reintentar.",
    ].join("\n");
}
async function arrancarServidor() {
    const server = construirServidor();
    const transport = new stdio_js_1.StdioServerTransport();
    const puenteListo = (0, PacketTracerBridgeServer_1.iniciarBridge)().catch((error) => {
        Logger_1.Logger.error("No se pudo iniciar el bridge de Packet Tracer.", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    await server.connect(transport);
    await puenteListo;
    Logger_1.Logger.info(`Servidor MCP listo: ${ToolRegistry_1.toolRegistry.contarTools()} herramientas de ${ToolRegistry_1.toolRegistry.obtenerModulos().length} dominios.`);
    const puente = (0, PacketTracerBridgeServer_1.estadoBridge)();
    Logger_1.Logger.info(puente.activo
        ? `Bridge de Packet Tracer escuchando en ${puente.url} (extensión conectada: ${puente.extensionConectada ? "sí" : "todavía no"}).`
        : `Bridge de Packet Tracer INACTIVO: las herramientas packet_tracer_* fallarán hasta reiniciar el MCP con MCP_BRIDGE_PORT=${EnvConfig_1.envConfig.MCP_BRIDGE_PORT} libre.`);
    let cerrando = false;
    const cerrar = async (motivo) => {
        if (cerrando)
            return;
        cerrando = true;
        Logger_1.Logger.info(`Cerrando servidor MCP (${motivo}).`);
        await (0, PacketTracerBridgeServer_1.detenerBridge)().catch((error) => {
            Logger_1.Logger.debug("Error al detener el bridge de Packet Tracer.", { error: String(error) });
        });
        try {
            await server.close();
        }
        catch (error) {
            Logger_1.Logger.debug("Error al cerrar el servidor MCP.", { error: String(error) });
        }
        await (0, PrismaClient_1.disconnectPrisma)().catch(() => undefined);
        process.exit(0);
    };
    process.on("SIGINT", () => void cerrar("SIGINT"));
    process.on("SIGTERM", () => void cerrar("SIGTERM"));
    process.stdin.on("close", () => void cerrar("stdin cerrado"));
}
//# sourceMappingURL=McpServer.js.map