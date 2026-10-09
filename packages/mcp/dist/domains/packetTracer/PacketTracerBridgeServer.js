"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iniciarBridge = iniciarBridge;
exports.detenerBridge = detenerBridge;
exports.estadoBridge = estadoBridge;
exports.getExtensionSocket = getExtensionSocket;
exports.solicitarTool = solicitarTool;
exports.esperarResultado = esperarResultado;
exports.olvidarLlamada = olvidarLlamada;
const node_http_1 = require("node:http");
const node_crypto_1 = require("node:crypto");
const socket_io_1 = require("socket.io");
const EnvConfig_1 = require("../../config/EnvConfig.js");
const Logger_1 = require("../../utils/Logger.js");
const errors_1 = require("../../core/errors.js");
const VIGENCIA_LLAMADA_MS = 300_000;
const MAX_LLAMADAS_PENDIENTES = 512;
let io = null;
let httpServer = null;
let puertoEfectivo = null;
let extensionSocket = null;
const llamadasPendientes = new Map();
function urlBridge() {
    return `http://${EnvConfig_1.envConfig.MCP_BRIDGE_HOST}:${puertoEfectivo ?? EnvConfig_1.envConfig.MCP_BRIDGE_PORT}`;
}
function errorExtensionAusente() {
    return (0, errors_1.errorNoDisponible)(`La extensión de Packet Tracer no está conectada al bridge del servidor MCP (${urlBridge()}).`, "Abre Packet Tracer con la extensión cargada y comprueba el estado con packet_tracer_connection_status. " +
        "Si la extensión se conecta a otra URL, ajusta MCP_BRIDGE_HOST y MCP_BRIDGE_PORT en el servidor MCP y " +
        "reinícialo. NO hace falta que el backend de Packet Tools esté arrancado: el puente vive en el MCP.");
}
function errorBridgeInactivo() {
    return (0, errors_1.errorNoDisponible)(`El bridge de Packet Tracer del servidor MCP no está escuchando en ${urlBridge()}.`, "Comprueba que MCP_BRIDGE_ENABLED no sea false y que el puerto esté libre (si hay otra instancia del MCP o " +
        "el backend de Packet Tools ocupando el puerto, cambia MCP_BRIDGE_PORT y reinicia el servidor MCP). " +
        "El resto de dominios del MCP (GNS3, serie, SSH, telnet, planes y skills) siguen funcionando.");
}
function esClienteSimulador(socket) {
    const clientType = String(socket.handshake?.query?.clientType ?? "");
    const userAgent = String(socket.handshake?.headers?.["user-agent"] ?? "");
    return clientType === "packet-tracer" || userAgent.includes("Qt");
}
function secretoVigente() {
    return EnvConfig_1.envConfig.PT_EXTENSION_SECRET;
}
function secretoPresentado(socket) {
    const fromAuth = socket.handshake?.auth?.secret;
    const fromHeader = socket.handshake?.headers?.["x-packet-tools-secret"];
    return ((typeof fromAuth === "string" ? fromAuth : "") ||
        (typeof fromHeader === "string" ? fromHeader : ""));
}
function autenticar(socket, next) {
    if (!esClienteSimulador(socket)) {
        Logger_1.Logger.warning(`[BRIDGE_MCP] Conexión rechazada: el puente solo acepta la extensión de Packet Tracer [ID: ${socket.id}]`, {
            clientType: socket.handshake?.query?.clientType,
            userAgent: socket.handshake?.headers?.["user-agent"],
        });
        next(new Error("El bridge MCP solo acepta la extensión de Packet Tracer"));
        return;
    }
    const secreto = secretoVigente();
    if (secreto && secretoPresentado(socket) !== secreto) {
        Logger_1.Logger.warning(`[BRIDGE_MCP] Secreto de extensión inválido; se rechaza [ID: ${socket.id}]`);
        next(new Error("Secreto de extensión inválido"));
        return;
    }
    next();
}
function esExtensionDePacketTracer(socket) {
    return extensionSocket !== null && extensionSocket.id === socket.id;
}
function entregar(llamada, valor) {
    if (llamada.espera) {
        clearTimeout(llamada.espera.temporizador);
        llamada.espera.resolver(valor);
        llamada.espera = null;
        return;
    }
    llamada.resultadoListo = { valor };
}
function cortar(llamada, error) {
    if (!llamada.espera)
        return;
    clearTimeout(llamada.espera.temporizador);
    llamada.espera.rechazar(error);
    llamada.espera = null;
}
function errorCaducada(toolCallId) {
    return (0, errors_1.errorNoDisponible)(`La llamada '${toolCallId}' caducó antes de que la extensión respondiera (${Math.round(VIGENCIA_LLAMADA_MS / 1000)} s).`, "El comando pudo haberse aplicado igualmente en Packet Tracer: comprueba el estado con una lectura antes de repetirlo.");
}
function podarLlamadas(ahora) {
    for (const [id, llamada] of llamadasPendientes) {
        if (llamada.expiraEn > ahora)
            continue;
        cortar(llamada, errorCaducada(id));
        llamadasPendientes.delete(id);
    }
    while (llamadasPendientes.size >= MAX_LLAMADAS_PENDIENTES) {
        const masAntigua = [...llamadasPendientes.keys()][0];
        if (masAntigua === undefined)
            break;
        const llamada = llamadasPendientes.get(masAntigua);
        if (llamada) {
            cortar(llamada, (0, errors_1.errorNoDisponible)(`La llamada '${masAntigua}' se descartó por superar el máximo de ${MAX_LLAMADAS_PENDIENTES} llamadas en vuelo.`, "Reduce el número de operaciones concurrentes de Packet Tracer (espera a que terminen las anteriores) y vuelve a intentarlo."));
        }
        llamadasPendientes.delete(masAntigua);
    }
}
function registrarLlamada(toolCallId, socketOrigen) {
    const ahora = Date.now();
    podarLlamadas(ahora);
    if (llamadasPendientes.has(toolCallId))
        return false;
    llamadasPendientes.set(toolCallId, {
        socketOrigen,
        expiraEn: ahora + VIGENCIA_LLAMADA_MS,
        espera: null,
        resultadoListo: null,
    });
    return true;
}
function tomarLlamada(toolCallId) {
    const llamada = llamadasPendientes.get(toolCallId);
    if (!llamada)
        return null;
    llamadasPendientes.delete(toolCallId);
    return llamada.expiraEn <= Date.now() ? null : llamada;
}
function olvidarLlamadasDe(socketId, motivo) {
    for (const [id, llamada] of llamadasPendientes) {
        if (llamada.socketOrigen !== socketId)
            continue;
        cortar(llamada, (0, errors_1.errorNoDisponible)(`La extensión de Packet Tracer se desconectó con la llamada '${id}' en vuelo (${motivo}).`, "Reabre Packet Tracer con la extensión cargada y comprueba con packet_tracer_connection_status. " +
            "El comando pudo haberse aplicado igualmente: verifica con una lectura antes de repetirlo."));
        llamadasPendientes.delete(id);
    }
}
async function iniciarBridge(opciones = {}) {
    if (io) {
        Logger_1.Logger.debug(`[BRIDGE_MCP] iniciarBridge() ignorado: ya hay un puente escuchando en ${urlBridge()}.`);
        return;
    }
    if (!EnvConfig_1.envConfig.MCP_BRIDGE_ENABLED) {
        Logger_1.Logger.warning("[BRIDGE_MCP] MCP_BRIDGE_ENABLED=false: el puente no se arranca y las herramientas de Packet Tracer fallarán.", { urlEsperada: urlBridge() });
        return;
    }
    const puerto = opciones.puerto ?? EnvConfig_1.envConfig.MCP_BRIDGE_PORT;
    const host = opciones.host ?? EnvConfig_1.envConfig.MCP_BRIDGE_HOST;
    const http = (0, node_http_1.createServer)();
    const servidor = new socket_io_1.Server(http, { cors: { origin: true } });
    try {
        await new Promise((resolver, rechazar) => {
            const alError = (error) => {
                http.off("listening", alListo);
                rechazar(error);
            };
            const alListo = () => {
                http.off("error", alError);
                resolver();
            };
            http.once("error", alError);
            http.once("listening", alListo);
            http.listen(puerto, host);
        });
    }
    catch (error) {
        const codigo = error?.code;
        Logger_1.Logger.error(`No se pudo arrancar el bridge de Packet Tracer en http://${host}:${puerto}: ` +
            (codigo === "EADDRINUSE"
                ? "el puerto ya está ocupado (EADDRINUSE). Puede ser otra instancia del servidor MCP o el backend de Packet Tools."
                : String(error?.message ?? error)) +
            " El servidor MCP sigue funcionando; las herramientas packet_tracer_* fallarán con este motivo.", { host, puerto, code: codigo });
        servidor.close();
        http.close();
        return;
    }
    const direccion = http.address();
    puertoEfectivo = direccion && typeof direccion === "object" ? direccion.port : puerto;
    io = servidor;
    httpServer = http;
    servidor.use((socket, next) => autenticar(socket, next));
    servidor.on("connection", registrarConexion);
    Logger_1.Logger.info(`Bridge de Packet Tracer escuchando en ${urlBridge()} (la extensión se conecta aquí).`);
}
function registrarConexion(socket) {
    const esSimulador = esClienteSimulador(socket);
    Logger_1.Logger.info(`[BRIDGE_MCP] Nueva conexión ${esSimulador ? "EXTENSION PACKET TRACER" : "cliente"} [ID: ${socket.id}]`, {
        clientType: socket.handshake?.query?.clientType,
        userAgent: socket.handshake?.headers?.["user-agent"],
    });
    if (esSimulador)
        adjuntarExtension(socket);
    socket.on("tool_call", (data) => {
        Logger_1.Logger.warning(`[BRIDGE_MCP] tool_call desde un socket conectado; el MCP entrega sus llamadas directamente a la extensión, así que se descarta [ID: ${socket.id}]`, { toolName: data?.tool_name });
    });
    socket.on("tool_result", (data) => {
        const toolCallId = typeof data?.tool_call_id === "string" ? data.tool_call_id : "";
        if (!toolCallId) {
            Logger_1.Logger.warning(`[BRIDGE_MCP] tool_result sin tool_call_id; se descarta [ID: ${socket.id}]`);
            return;
        }
        if (!esExtensionDePacketTracer(socket)) {
            Logger_1.Logger.warning(`[BRIDGE_MCP] tool_result desde un socket que no es la extensión registrada; se ignora [ID: ${socket.id}]`, { toolCallId });
            return;
        }
        const llamada = tomarLlamada(toolCallId);
        if (!llamada) {
            Logger_1.Logger.info("[BRIDGE_MCP] tool_result huérfano, repetido o caducado; se descarta", {
                toolCallId,
            });
            return;
        }
        entregar(llamada, data.result);
    });
    socket.on("disconnect", (motivo) => {
        Logger_1.Logger.info(`[BRIDGE_MCP] Desconexión [ID: ${socket.id}] (${motivo})`);
        if (extensionSocket?.id === socket.id) {
            extensionSocket = null;
            olvidarLlamadasDe(socket.id, motivo || "desconexión");
        }
    });
}
function adjuntarExtension(socket) {
    if (extensionSocket && extensionSocket.connected) {
        Logger_1.Logger.warning(`[BRIDGE_MCP] Ya hay una extensión registrada (${extensionSocket.id}); esta conexión (${socket.id}) queda como cliente y sus tool_result se ignorarán.`);
        return;
    }
    extensionSocket = socket;
    Logger_1.Logger.info(`[BRIDGE_MCP] Extensión de Packet Tracer registrada [ID: ${socket.id}] en ${urlBridge()}.`);
}
async function detenerBridge() {
    const servidor = io;
    io = null;
    httpServer = null;
    puertoEfectivo = null;
    extensionSocket = null;
    if (!servidor)
        return;
    for (const [id, llamada] of llamadasPendientes) {
        cortar(llamada, (0, errors_1.errorNoDisponible)(`El servidor MCP se cerró con la llamada '${id}' en vuelo.`, "Reinicia el servidor MCP: se cerró mientras esperaba respuesta de Packet Tracer. El comando pudo haberse aplicado igualmente."));
        llamadasPendientes.delete(id);
    }
    await new Promise((resolver) => {
        servidor.close(() => resolver());
    });
    Logger_1.Logger.info("[BRIDGE_MCP] Puente de Packet Tracer detenido.");
}
function estadoBridge() {
    return {
        activo: io !== null && httpServer?.listening === true,
        url: urlBridge(),
        extensionConectada: extensionSocket !== null && extensionSocket.connected,
        socketExtension: extensionSocket?.id ?? null,
        peticionesPendientes: llamadasPendientes.size,
    };
}
function getExtensionSocket() {
    return extensionSocket && extensionSocket.connected ? extensionSocket : null;
}
function solicitarTool(nombre, input) {
    if (!EnvConfig_1.envConfig.MCP_BRIDGE_ENABLED) {
        throw (0, errors_1.errorNoDisponible)("El bridge de Packet Tracer está desactivado en este servidor MCP (MCP_BRIDGE_ENABLED=false).", "Las herramientas packet_tracer_* no pueden funcionar sin él. Reactiva MCP_BRIDGE_ENABLED y reinicia el servidor MCP.");
    }
    if (!io)
        throw errorBridgeInactivo();
    const extension = getExtensionSocket();
    if (!extension)
        throw errorExtensionAusente();
    const toolCallId = `tool-${nombre}-${(0, node_crypto_1.randomUUID)()}`;
    if (!registrarLlamada(toolCallId, extension.id)) {
        throw new Error(`La llamada '${toolCallId}' ya está en vuelo (id duplicado).`);
    }
    Logger_1.Logger.traza(`[BRIDGE_MCP] tool_call → ${nombre}`, { toolCallId });
    extension.emit("tool_call", {
        tool_call_id: toolCallId,
        tool_name: nombre,
        tool_input: input,
    });
    return { toolCallId };
}
function esperarResultado(toolCallId) {
    const llamada = llamadasPendientes.get(toolCallId);
    if (!llamada) {
        return Promise.reject((0, errors_1.errorNoDisponible)(`No hay ninguna llamada en vuelo con el id '${toolCallId}'.`, "O bien su resultado ya se consumió, o bien caducó. Vuelve a pedir la operación; no reutilices ids viejos."));
    }
    if (llamada.resultadoListo) {
        const valor = llamada.resultadoListo.valor;
        llamadasPendientes.delete(toolCallId);
        return Promise.resolve(valor);
    }
    if (llamada.espera)
        return llamada.espera.promesa;
    let resolver;
    let rechazar;
    const promesa = new Promise((res, rej) => {
        resolver = res;
        rechazar = rej;
    });
    const temporizador = setTimeout(() => {
        llamadasPendientes.delete(toolCallId);
        rechazar(errorCaducada(toolCallId));
    }, VIGENCIA_LLAMADA_MS);
    llamada.espera = { promesa, resolver, rechazar, temporizador };
    return promesa;
}
function olvidarLlamada(toolCallId) {
    const llamada = llamadasPendientes.get(toolCallId);
    if (!llamada)
        return;
    cortar(llamada, (0, errors_1.errorNoDisponible)(`Se abandonó la espera de la llamada '${toolCallId}'.`, "El comando pudo haberse aplicado igualmente en Packet Tracer: verifica con una lectura antes de repetirlo."));
    llamadasPendientes.delete(toolCallId);
}
//# sourceMappingURL=PacketTracerBridgeServer.js.map