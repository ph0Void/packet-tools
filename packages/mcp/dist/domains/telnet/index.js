"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moduloTelnet = void 0;
exports.cerrarSesionesTelnet = cerrarSesionesTelnet;
const zod_1 = require("zod");
const ToolRegistry_1 = require("../../core/ToolRegistry.js");
const adapters_1 = require("../../transports/adapters.js");
const commandEngine_1 = require("../../transports/commandEngine.js");
const sesiones = new Map();
function claveSesion(host, puerto) {
    return `${host}:${puerto}`;
}
async function obtenerSesion(host, puerto, credenciales) {
    const clave = claveSesion(host, puerto);
    const existente = sesiones.get(clave);
    if (existente?.isConnected())
        return existente;
    const transporte = (0, adapters_1.crearTransporte)({
        protocol: "TELNET",
        host,
        port: puerto,
        username: credenciales.username,
        password: credenciales.password,
    });
    await transporte.connect();
    sesiones.set(clave, transporte);
    return transporte;
}
async function cerrarSesionesTelnet() {
    for (const transporte of sesiones.values()) {
        await transporte.disconnect().catch(() => undefined);
    }
    sesiones.clear();
}
const herramientas = [
    (0, ToolRegistry_1.definirTool)({
        name: "telnet_detect_vendor",
        description: "Se conecta por Telnet a un equipo, lee su prompt y determina el FABRICANTE (Cisco IOS, Huawei VRP, MikroTik, ArubaOS, JunOS o genérico). " +
            "Úsala antes de configurar un equipo del que no conozcas la marca, para que los comandos se envíen con la sintaxis correcta.",
        inputSchema: {
            host: zod_1.z.string().describe("IP o nombre del equipo"),
            port: zod_1.z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Puerto Telnet (por defecto 23)"),
            username: zod_1.z
                .string()
                .optional()
                .describe("Usuario, si el equipo lo pide"),
            password: zod_1.z
                .string()
                .optional()
                .describe("Contraseña, si el equipo la pide"),
        },
        handler: async ({ host, port, username, password }) => {
            const transporte = await obtenerSesion(host, port ?? 23, {
                username,
                password,
            });
            const resultado = await (0, commandEngine_1.ejecutarComandos)(transporte, [], {}, { sinPreambulo: true });
            return {
                success: true,
                host,
                port: port ?? 23,
                vendor: resultado.vendorId,
                vendorLabel: resultado.vendorLabel,
                prompt: resultado.prompt,
                confiable: resultado.vendorId !== "conservative",
                nota: (0, commandEngine_1.notaVendorConservador)(resultado),
            };
        },
    }),
    (0, ToolRegistry_1.definirTool)({
        name: "telnet_send_commands",
        description: "Envía comandos por Telnet y devuelve la salida de cada uno. " +
            "Detecta el fabricante, aplica el preámbulo para desactivar la paginación y descarta los comandos que cerrarían la sesión. " +
            "El equipo debe tener Telnet habilitado: si no, usa el dominio ssh_.",
        inputSchema: {
            host: zod_1.z.string().describe("IP o nombre del equipo"),
            commands: zod_1.z
                .array(zod_1.z.string())
                .min(1)
                .describe("Comandos a enviar, en orden"),
            port: zod_1.z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Puerto Telnet (por defecto 23)"),
            username: zod_1.z
                .string()
                .optional()
                .describe("Usuario, si el equipo lo pide"),
            password: zod_1.z
                .string()
                .optional()
                .describe("Contraseña, si el equipo la pide"),
            idleMs: zod_1.z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Silencio para dar la salida por terminada (por defecto 700 ms)"),
            maxMs: zod_1.z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Espera máxima por comando (por defecto 20000 ms)"),
        },
        handler: async ({ host, commands, port, username, password, idleMs, maxMs, }) => {
            const transporte = await obtenerSesion(host, port ?? 23, {
                username,
                password,
            });
            const resultado = await (0, commandEngine_1.ejecutarComandos)(transporte, commands, {}, { idleMs, maxMs });
            return {
                success: true,
                host,
                vendor: resultado.vendorId,
                vendorLabel: resultado.vendorLabel,
                prompt: resultado.prompt,
                duracionMs: resultado.duracionMs,
                output: resultado.output,
                nota: (0, commandEngine_1.notaVendorConservador)(resultado),
            };
        },
    }),
    (0, ToolRegistry_1.definirTool)({
        name: "telnet_disconnect",
        description: "Cierra la sesión Telnet con un equipo para liberarla.",
        inputSchema: {
            host: zod_1.z.string().describe("IP o nombre del equipo"),
            port: zod_1.z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Puerto Telnet (por defecto 23)"),
        },
        handler: async ({ host, port }) => {
            const clave = claveSesion(host, port ?? 23);
            const transporte = sesiones.get(clave);
            if (!transporte) {
                return {
                    success: true,
                    cerrada: false,
                    mensaje: `No había sesión abierta con ${host}:${port ?? 23}.`,
                };
            }
            await transporte.disconnect();
            sesiones.delete(clave);
            return {
                success: true,
                cerrada: true,
                mensaje: `Sesión con ${host}:${port ?? 23} cerrada.`,
            };
        },
    }),
];
exports.moduloTelnet = {
    id: "telnet",
    prefix: "telnet_",
    description: "Sesiones Telnet contra equipos reales: detectar el fabricante y enviar comandos de configuración con la sintaxis correcta.",
    tools: herramientas,
};
//# sourceMappingURL=index.js.map