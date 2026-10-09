"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpToolError = void 0;
exports.errorDeValidacion = errorDeValidacion;
exports.errorDeConfiguracion = errorDeConfiguracion;
exports.errorNoDisponible = errorNoDisponible;
exports.normalizarError = normalizarError;
exports.conErroresNormalizados = conErroresNormalizados;
class McpToolError extends Error {
    code;
    sugerencia;
    detalle;
    constructor(code, message, opciones = {}) {
        super(message);
        this.name = "McpToolError";
        this.code = code;
        this.sugerencia = opciones.sugerencia;
        this.detalle = opciones.detalle;
    }
    toModelMessage() {
        return this.sugerencia
            ? `[${this.code}] ${this.message}\n\nQué hacer ahora: ${this.sugerencia}`
            : `[${this.code}] ${this.message}`;
    }
}
exports.McpToolError = McpToolError;
function errorDeValidacion(message, sugerencia = "Revisa los parámetros y vuelve a llamar a la herramienta con valores válidos.") {
    return new McpToolError("VALIDACION", message, { sugerencia });
}
function errorDeConfiguracion(message, sugerencia) {
    return new McpToolError("NO_CONFIGURADO", message, { sugerencia });
}
function errorNoDisponible(message, sugerencia) {
    return new McpToolError("NO_DISPONIBLE", message, { sugerencia });
}
function normalizarError(error) {
    if (error instanceof McpToolError)
        return error;
    if (error instanceof Error) {
        return new McpToolError("INTERNO", error.message, {
            sugerencia: "Es un fallo del servidor MCP, no de los parámetros. Repórtalo al usuario con este mensaje y no repitas la misma llamada esperando otro resultado.",
            detalle: { stack: error.stack },
        });
    }
    return new McpToolError("INTERNO", String(error), {
        sugerencia: "Es un fallo del servidor MCP, no de los parámetros. Repórtalo al usuario y no repitas la llamada.",
    });
}
function conErroresNormalizados(handler) {
    return async (args) => {
        try {
            return await handler(args);
        }
        catch (error) {
            throw normalizarError(error);
        }
    };
}
//# sourceMappingURL=errors.js.map