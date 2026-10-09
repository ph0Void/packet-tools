"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gns3McpClient = void 0;
exports.resolverCredencialesGns3 = resolverCredencialesGns3;
exports.crearClienteGns3 = crearClienteGns3;
const EnvConfig_1 = require("../../config/EnvConfig.js");
const PrismaClient_1 = require("../../prisma/lib/PrismaClient.js");
const Logger_1 = require("../../utils/Logger.js");
const errors_1 = require("../../core/errors.js");
const BASE_POR_DEFECTO = "http://localhost:3080/v2";
const TIMEOUT_MS = 15_000;
function normalizarBaseUrl(host) {
    const valor = (host ?? EnvConfig_1.envConfig.MCP_GNS3_URL ?? "").trim().replace(/\/+$/, "");
    if (!valor)
        return BASE_POR_DEFECTO;
    return valor.endsWith("/v2") ? valor : `${valor}/v2`;
}
async function resolverCredencialesGns3(providerId) {
    try {
        const fila = providerId?.trim()
            ? await PrismaClient_1.prismaClient.deviceProviderMcp.findUnique({ where: { id: providerId.trim() } })
            : await PrismaClient_1.prismaClient.deviceProviderMcp.findFirst({
                where: { typeDevice: "GNS3" },
                orderBy: { updatedAt: "desc" },
            });
        if (fila) {
            if (fila.typeDevice !== "GNS3" && providerId) {
                throw (0, errors_1.errorDeConfiguracion)(`El dispositivo '${fila.name}' no es de tipo GNS3 (es ${fila.typeDevice}).`, "Usa el id de un dispositivo GNS3 o llama a gns3_list_configured_servers para ver los que hay configurados.");
            }
            return {
                baseUrl: normalizarBaseUrl(fila.host),
                username: fila.username ?? null,
                password: fila.password ?? null,
            };
        }
    }
    catch (error) {
        if (error instanceof errors_1.McpToolError)
            throw error;
        Logger_1.Logger.debug("No se pudieron leer las credenciales de GNS3 de la BD del MCP.", {
            error: String(error),
        });
    }
    return {
        baseUrl: normalizarBaseUrl(null),
        username: null,
        password: null,
    };
}
class Gns3McpClient {
    baseUrl;
    authHeader;
    constructor(credenciales) {
        this.baseUrl = credenciales.baseUrl;
        this.authHeader =
            credenciales.username && credenciales.password
                ? `Basic ${Buffer.from(`${credenciales.username}:${credenciales.password}`).toString("base64")}`
                : null;
    }
    get url() {
        return this.baseUrl;
    }
    async request(endpoint, options = {}, parseAs = "json") {
        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
        let respuesta;
        try {
            respuesta = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                signal: controlador.signal,
                headers: {
                    "Content-Type": "application/json",
                    ...(this.authHeader ? { Authorization: this.authHeader } : {}),
                    ...(options.headers ?? {}),
                },
            });
        }
        catch (error) {
            clearTimeout(temporizador);
            const mensaje = error instanceof Error ? error.message : String(error);
            throw (0, errors_1.errorNoDisponible)(`No se pudo contactar con el servidor GNS3 en ${this.baseUrl}: ${mensaje}`, "Comprueba que el servidor GNS3 está arrancado y que la URL es correcta (por defecto http://localhost:3080/v2). " +
                "Si tu GNS3 está en otra máquina o puerto, configura el dispositivo GNS3 con esa URL.");
        }
        clearTimeout(temporizador);
        if (!respuesta.ok) {
            const detalle = await respuesta.text().catch(() => "");
            const recortado = detalle.slice(0, 300);
            if (respuesta.status === 401 || respuesta.status === 403) {
                throw (0, errors_1.errorDeConfiguracion)(`GNS3 rechazó la autenticación (HTTP ${respuesta.status}).`, "Revisa el usuario y la contraseña del dispositivo GNS3 en la configuración del MCP.");
            }
            throw new errors_1.McpToolError("OPERACION_FALLIDA", `GNS3 respondió HTTP ${respuesta.status} en ${endpoint}${recortado ? `: ${recortado}` : ""}`, {
                sugerencia: "Comprueba que el proyecto y los identificadores existen (usa las herramientas gns3_list_* para ver los reales) y que el servidor GNS3 está operativo.",
            });
        }
        if (respuesta.status === 204)
            return null;
        try {
            if (parseAs === "text")
                return await respuesta.text();
            if (parseAs === "buffer")
                return Buffer.from(await respuesta.arrayBuffer());
            return await respuesta.json();
        }
        catch {
            return null;
        }
    }
    async get(endpoint, parseAs = "json") {
        return this.request(endpoint, { method: "GET" }, parseAs);
    }
    async post(endpoint, cuerpo) {
        return this.request(endpoint, {
            method: "POST",
            ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        });
    }
    async put(endpoint, cuerpo) {
        return this.request(endpoint, {
            method: "PUT",
            ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        });
    }
    async del(endpoint) {
        return this.request(endpoint, { method: "DELETE" });
    }
}
exports.Gns3McpClient = Gns3McpClient;
async function crearClienteGns3(providerId) {
    const credenciales = await resolverCredencialesGns3(providerId);
    return new Gns3McpClient(credenciales);
}
//# sourceMappingURL=Gns3McpClient.js.map