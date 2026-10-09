"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.recortarParaLog = recortarParaLog;
const EnvConfig_1 = require("../config/EnvConfig.js");
function emitir(nivel, mensaje, datos) {
    if (nivel === "debug" && !EnvConfig_1.envConfig.MCP_DEBUG)
        return;
    const marca = new Date().toISOString();
    const etiqueta = nivel.toUpperCase();
    const cola = datos === undefined ? "" : ` ${serializar(datos)}`;
    process.stderr.write(`[${marca}] [MCP] [${etiqueta}] ${mensaje}${cola}\n`);
}
function serializar(datos) {
    if (typeof datos === "string")
        return datos;
    try {
        return JSON.stringify(datos);
    }
    catch {
        return "[datos no serializables]";
    }
}
function recortarParaLog(texto, maximo = 400) {
    const limpio = String(texto ?? "");
    return limpio.length > maximo ? `${limpio.slice(0, maximo)}...(+${limpio.length - maximo})` : limpio;
}
exports.Logger = {
    info(mensaje, datos) {
        emitir("info", mensaje, datos);
    },
    warning(mensaje, datos) {
        emitir("warning", mensaje, datos);
    },
    error(mensaje, datos) {
        emitir("error", mensaje, datos);
    },
    debug(mensaje, datos) {
        emitir("debug", mensaje, datos);
    },
    traza(mensaje, datos) {
        if (!EnvConfig_1.envConfig.MCP_TRACE_TOOLS)
            return;
        emitir("debug", mensaje, datos);
    },
};
//# sourceMappingURL=Logger.js.map