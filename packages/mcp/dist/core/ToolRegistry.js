"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolRegistry = void 0;
exports.definirTool = definirTool;
const Logger_1 = require("../utils/Logger.js");
function definirTool(tool) {
    return tool;
}
class ToolRegistry {
    modulos = [];
    nombresRegistrados = new Set();
    registrar(modulo) {
        if (modulo.tools.length === 0) {
            throw new Error(`El dominio '${modulo.id}' no expone ninguna tool: revisa que el módulo las esté declarando.`);
        }
        for (const tool of modulo.tools) {
            if (!tool.name.startsWith(modulo.prefix)) {
                throw new Error(`La tool '${tool.name}' del dominio '${modulo.id}' no empieza por su prefijo '${modulo.prefix}'. ` +
                    `El prefijo no es decorativo: es lo que permite al modelo saber de qué dominio es la herramienta.`);
            }
            if (this.nombresRegistrados.has(tool.name)) {
                throw new Error(`La tool '${tool.name}' ya está registrada por otro dominio. Los nombres deben ser únicos en todo el servidor.`);
            }
            this.nombresRegistrados.add(tool.name);
        }
        this.modulos.push(modulo);
        Logger_1.Logger.debug(`Dominio registrado: ${modulo.id} (${modulo.tools.length} herramientas)`);
    }
    obtenerModulos() {
        return this.modulos;
    }
    obtenerTools() {
        return this.modulos.flatMap((modulo) => modulo.tools);
    }
    contarTools() {
        return this.nombresRegistrados.size;
    }
    conectarAServidor(server) {
        for (const tool of this.obtenerTools()) {
            server.registerTool(tool.name, {
                description: tool.description,
                inputSchema: tool.inputSchema,
            }, (async (args) => {
                const inicio = Date.now();
                Logger_1.Logger.traza(`→ ${tool.name}`, args);
                try {
                    const resultado = await tool.handler(args);
                    Logger_1.Logger.traza(`← ${tool.name} OK (${Date.now() - inicio} ms)`);
                    return aRespuestaMcp(resultado);
                }
                catch (error) {
                    const mensaje = error instanceof Error ? error.message : String(error);
                    Logger_1.Logger.warning(`← ${tool.name} FALLÓ (${Date.now() - inicio} ms): ${mensaje}`);
                    return aRespuestaMcp(error && typeof error === "object" && "toModelMessage" in error
                        ? error.toModelMessage()
                        : `Error inesperado en '${tool.name}': ${mensaje}`, true);
                }
            }));
        }
    }
}
function aRespuestaMcp(valor, isError = false) {
    const texto = typeof valor === "string" ? valor : JSON.stringify(valor ?? null, null, 2);
    return {
        content: [{ type: "text", text: texto }],
        ...(isError ? { isError: true } : {}),
    };
}
exports.toolRegistry = new ToolRegistry();
//# sourceMappingURL=ToolRegistry.js.map