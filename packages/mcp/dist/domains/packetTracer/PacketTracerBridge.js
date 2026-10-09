"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packetTracerBridge = void 0;
exports.timeoutDeHerramienta = timeoutDeHerramienta;
exports.operacionOk = operacionOk;
exports.llamarPacketTracer = llamarPacketTracer;
const PacketTracerBridgeServer_1 = require("./PacketTracerBridgeServer.js");
const EnvConfig_1 = require("../../config/EnvConfig.js");
const Logger_1 = require("../../utils/Logger.js");
const errors_1 = require("../../core/errors.js");
const TIMEOUT_POR_HERRAMIENTA = {
    listDeviceModels: 15_000,
    getDeviceInfo: 15_000,
    readDeviceConsole: 15_000,
    listDeviceModules: 15_000,
    getCommandLog: 15_000,
    getRoutingTable: 30_000,
    getVlanConfiguration: 30_000,
    getDeviceConfigSnapshot: 45_000,
    getDeviceMetrics: 45_000,
    validateSecurityConfig: 45_000,
    runDeviceCommands: 60_000,
    runCommandAsync: 30_000,
    pollCommandResult: 25_000,
    getNetwork: 45_000,
    validateTopology: 45_000,
    getSimulationStatus: 10_000,
    setSimulationMode: 30_000,
    stepSimulation: 30_000,
    getPduResults: 30_000,
    sendPdu: 45_000,
    moveDevice: 15_000,
    addDevice: 20_000,
    removeDevice: 20_000,
    addLink: 20_000,
    removeLink: 20_000,
    renameDevice: 20_000,
    configurePcIp: 30_000,
    setPower: 30_000,
    clearWorkspace: 30_000,
    applyDeviceConfig: 120_000,
    simulateLinkFailure: 30_000,
    restoreLink: 30_000,
    pingDevices: 60_000,
    reachabilityMatrix: 90_000,
    exportWorkspace: 90_000,
    importWorkspace: 90_000,
};
const TIMEOUT_POR_DEFECTO = 60_000;
function timeoutDeHerramienta(nombre) {
    return TIMEOUT_POR_HERRAMIENTA[nombre] ?? TIMEOUT_POR_DEFECTO;
}
class PacketTracerBridge {
    temporizadores = new Map();
    get url() {
        return `http://${EnvConfig_1.envConfig.MCP_BRIDGE_HOST}:${EnvConfig_1.envConfig.MCP_BRIDGE_PORT}`;
    }
    async callTool(nombre, input, opciones = {}) {
        const timeoutMs = opciones.timeoutMs && opciones.timeoutMs > 0
            ? opciones.timeoutMs
            : timeoutDeHerramienta(nombre);
        return new Promise((resolver, rechazar) => {
            let toolCallId;
            try {
                toolCallId = (0, PacketTracerBridgeServer_1.solicitarTool)(nombre, input).toolCallId;
            }
            catch (error) {
                Logger_1.Logger.debug(`Llamada a '${nombre}' descartada antes de emitirse: ${String(error)}`);
                rechazar(error);
                return;
            }
            const temporizador = setTimeout(() => {
                this.temporizadores.delete(toolCallId);
                (0, PacketTracerBridgeServer_1.olvidarLlamada)(toolCallId);
                rechazar((0, errors_1.errorNoDisponible)(`Packet Tracer no respondió a '${nombre}' en ${Math.round(timeoutMs / 1000)} s.`, "El comando pudo haberse encolado igualmente en la extensión, así que NO lo repitas a ciegas: " +
                    "comprueba el estado con una lectura (packet_tracer_get_network o packet_tracer_read_console). " +
                    "Si la consola quedó bloqueada por un diálogo, reinicia Packet Tracer. " +
                    `Verifica también que la extensión está conectada al bridge del MCP (${this.url}) ` +
                    `y que MCP_BRIDGE_PORT=${EnvConfig_1.envConfig.MCP_BRIDGE_PORT} es el puerto al que se conecta.`));
            }, timeoutMs);
            this.temporizadores.set(toolCallId, temporizador);
            (0, PacketTracerBridgeServer_1.esperarResultado)(toolCallId).then((valor) => {
                clearTimeout(temporizador);
                this.temporizadores.delete(toolCallId);
                resolver(desenvolverEnvoltorio(valor));
            }, (error) => {
                clearTimeout(temporizador);
                this.temporizadores.delete(toolCallId);
                rechazar(error);
            });
        });
    }
    async cerrar() {
        for (const [id, temporizador] of this.temporizadores) {
            clearTimeout(temporizador);
            (0, PacketTracerBridgeServer_1.olvidarLlamada)(id);
        }
        this.temporizadores.clear();
    }
}
function desenvolverEnvoltorio(valor) {
    let actual = valor;
    let vueltas = 0;
    while (vueltas < 5 &&
        actual &&
        typeof actual === "object" &&
        typeof actual.code === "string" &&
        "result" in actual) {
        actual = actual.result;
        vueltas++;
    }
    return actual;
}
exports.packetTracerBridge = new PacketTracerBridge();
function operacionOk(resultado) {
    if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) {
        return false;
    }
    const bruto = resultado;
    if (bruto.success === false)
        return false;
    if (bruto.succes === false)
        return false;
    if (bruto.error)
        return false;
    return true;
}
async function llamarPacketTracer(nombre, input, opciones = {}) {
    try {
        return await exports.packetTracerBridge.callTool(nombre, input, opciones);
    }
    catch (error) {
        if (error instanceof errors_1.McpToolError)
            throw error;
        throw (0, errors_1.normalizarError)(error);
    }
}
//# sourceMappingURL=PacketTracerBridge.js.map