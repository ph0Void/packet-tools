"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelnetTransport = exports.SshTransport = exports.SerialTransport = void 0;
exports.listarPuertosSerie = listarPuertosSerie;
exports.crearTransporte = crearTransporte;
exports.esperarA = esperarA;
const serialport_1 = require("serialport");
const ssh2_1 = require("ssh2");
const node_net_1 = __importDefault(require("node:net"));
const errors_1 = require("../core/errors.js");
const EOL_POR_PROTOCOLO = {
    SSH: "\r",
    TELNET: "\r\n",
    SERIAL: "\r\n",
};
async function esperarA(condicion, timeoutMs, pasoMs = 50) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        if (condicion())
            return true;
        await new Promise((r) => setTimeout(r, pasoMs));
    }
    return condicion();
}
class SerialTransport {
    opciones;
    protocol = "SERIAL";
    puerto = null;
    buffer = "";
    ultimoDato = 0;
    constructor(opciones) {
        this.opciones = opciones;
    }
    isConnected() {
        return Boolean(this.puerto?.isOpen);
    }
    async connect() {
        if (this.isConnected())
            return;
        const ruta = this.opciones.serialPort?.trim();
        if (!ruta) {
            throw new errors_1.McpToolError("NO_CONFIGURADO", "No se indicó el puerto serie a usar.", {
                sugerencia: "Llama a serial_list_ports para ver los puertos disponibles en este equipo y repite la llamada con el 'path' que corresponda (por ejemplo 'COM3' o '/dev/ttyUSB0').",
            });
        }
        const baudRate = this.opciones.baudRate ?? 9600;
        await new Promise((resolver, rechazar) => {
            const puerto = new serialport_1.SerialPort({ path: ruta, baudRate, autoOpen: false }, (error) => {
                if (error) {
                    rechazar(new errors_1.McpToolError("NO_DISPONIBLE", `No se pudo abrir el puerto serie '${ruta}': ${error.message}`, {
                        sugerencia: "Comprueba que el cable está conectado, que no lo está usando otro programa (otra consola, PuTTY, la app web) y que el nombre del puerto es correcto según serial_list_ports.",
                    }));
                }
            });
            puerto.on("data", (datos) => {
                this.buffer += datos.toString("utf8");
                this.ultimoDato = Date.now();
            });
            puerto.on("error", (error) => {
                this.buffer += `\n[ERROR DEL PUERTO SERIE: ${error.message}]\n`;
                this.ultimoDato = Date.now();
            });
            puerto.open((error) => {
                if (error) {
                    rechazar(new errors_1.McpToolError("NO_DISPONIBLE", `No se pudo abrir el puerto serie '${ruta}' a ${baudRate} baudios: ${error.message}`, {
                        sugerencia: "Verifica que el puerto existe y que no está ocupado por otro programa. En Windows suele ser 'COM3'; en Linux '/dev/ttyUSB0' y puede requerir permisos (grupo dialout).",
                    }));
                    return;
                }
                this.puerto = puerto;
                this.ultimoDato = Date.now();
                resolver();
            });
        });
    }
    async disconnect() {
        const puerto = this.puerto;
        this.puerto = null;
        if (!puerto?.isOpen)
            return;
        await new Promise((resolver) => {
            puerto.close(() => resolver());
        });
    }
    async sendCommand(command) {
        if (!this.puerto?.isOpen) {
            throw new errors_1.McpToolError("SIN_SESION", "El puerto serie no está abierto.", {
                sugerencia: "Vuelve a llamar a la herramienta: la conexión se abre sola antes de enviar el primer comando.",
            });
        }
        await new Promise((resolver, rechazar) => {
            this.puerto.write(`${command}${EOL_POR_PROTOCOLO.SERIAL}`, (error) => {
                if (error) {
                    rechazar(new errors_1.McpToolError("OPERACION_FALLIDA", `No se pudo escribir en el puerto serie: ${error.message}`, { sugerencia: "Comprueba que el cable sigue conectado y que el equipo está encendido." }));
                    return;
                }
                this.puerto.drain(() => resolver());
            });
        });
    }
    async readOutput(options = {}) {
        const idleMs = options.idleMs ?? 700;
        const maxMs = options.maxMs ?? 20_000;
        const limite = Date.now() + maxMs;
        while (Date.now() < limite) {
            if (this.buffer.length > 0 && Date.now() - this.ultimoDato >= idleMs)
                break;
            await new Promise((r) => setTimeout(r, 50));
        }
        const salida = this.buffer;
        this.buffer = "";
        return salida;
    }
}
exports.SerialTransport = SerialTransport;
async function listarPuertosSerie() {
    try {
        const puertos = await serialport_1.SerialPort.list();
        return puertos.map((puerto) => ({
            path: puerto.path,
            manufacturer: puerto.manufacturer ?? null,
            serialNumber: puerto.serialNumber ?? null,
            vendorId: puerto.vendorId ?? null,
            productId: puerto.productId ?? null,
            pnpId: puerto.pnpId ?? null,
        }));
    }
    catch (error) {
        throw new errors_1.McpToolError("NO_DISPONIBLE", `No se pudieron enumerar los puertos serie: ${error instanceof Error ? error.message : String(error)}`, {
            sugerencia: "En Linux puede faltar el paquete 'udev' o permisos sobre /dev/ttyUSB*; en Windows, comprueba que el driver del adaptador USB-serie está instalado. El resto de dominios (packet-tracer, gns3, ssh) siguen funcionando.",
        });
    }
}
class SshTransport {
    opciones;
    protocol = "SSH";
    cliente = null;
    stream = null;
    buffer = "";
    ultimoDato = 0;
    constructor(opciones) {
        this.opciones = opciones;
    }
    isConnected() {
        return Boolean(this.stream);
    }
    async connect() {
        if (this.isConnected())
            return;
        const host = this.opciones.host?.trim();
        if (!host) {
            throw new errors_1.McpToolError("NO_CONFIGURADO", "No se indicó el host SSH.", {
                sugerencia: "Indica el parámetro 'host' con la IP o el nombre del equipo, y opcionalmente 'port' (por defecto 22).",
            });
        }
        const cliente = new ssh2_1.Client();
        await new Promise((resolver, rechazar) => {
            const tiempoLimite = setTimeout(() => {
                rechazar(new errors_1.McpToolError("TIMEOUT", `La conexión SSH a ${host} no se estableció a tiempo.`, {
                    sugerencia: "Comprueba que el equipo es accesible (ping), que el servicio SSH está activo y que el puerto es el correcto.",
                }));
            }, 15_000);
            cliente.on("ready", () => {
                cliente.shell((error, stream) => {
                    if (error) {
                        clearTimeout(tiempoLimite);
                        rechazar(new errors_1.McpToolError("OPERACION_FALLIDA", `No se pudo abrir la shell SSH: ${error.message}`, {
                            sugerencia: "El equipo aceptó la conexión pero rechazó la shell. Comprueba que el usuario tiene permitido abrir una sesión interactiva.",
                        }));
                        return;
                    }
                    stream.on("data", (datos) => {
                        this.buffer += datos.toString("utf8");
                        this.ultimoDato = Date.now();
                    });
                    stream.stderr.on("data", (datos) => {
                        this.buffer += datos.toString("utf8");
                        this.ultimoDato = Date.now();
                    });
                    stream.on("close", () => {
                        this.stream = null;
                    });
                    this.stream = stream;
                    this.ultimoDato = Date.now();
                    clearTimeout(tiempoLimite);
                    resolver();
                });
            });
            cliente.on("error", (error) => {
                clearTimeout(tiempoLimite);
                rechazar(new errors_1.McpToolError("NO_DISPONIBLE", `Error de conexión SSH con ${host}: ${error.message}`, {
                    sugerencia: "Comprueba host, puerto y credenciales. Si el equipo pide clave pública, pásala en 'privateKey'. Verifica también que el usuario y la contraseña son correctos.",
                }));
            });
            cliente.connect({
                host,
                port: this.opciones.port ?? 22,
                username: this.opciones.username ?? undefined,
                password: this.opciones.password ?? undefined,
                privateKey: this.opciones.privateKey ?? undefined,
                readyTimeout: 15_000,
            });
        });
        this.cliente = cliente;
    }
    async disconnect() {
        this.stream?.close();
        this.stream = null;
        this.cliente?.end();
        this.cliente = null;
    }
    async sendCommand(command) {
        if (!this.stream) {
            throw new errors_1.McpToolError("SIN_SESION", "La sesión SSH no está abierta.", {
                sugerencia: "Vuelve a llamar a la herramienta: la conexión se abre sola antes del primer comando.",
            });
        }
        this.stream.write(`${command}${EOL_POR_PROTOCOLO.SSH}`);
    }
    async readOutput(options = {}) {
        const idleMs = options.idleMs ?? 700;
        const maxMs = options.maxMs ?? 20_000;
        const limite = Date.now() + maxMs;
        while (Date.now() < limite) {
            if (this.buffer.length > 0 && Date.now() - this.ultimoDato >= idleMs)
                break;
            await new Promise((r) => setTimeout(r, 50));
        }
        const salida = this.buffer;
        this.buffer = "";
        return salida;
    }
}
exports.SshTransport = SshTransport;
class TelnetTransport {
    opciones;
    protocol = "TELNET";
    socket = null;
    buffer = "";
    ultimoDato = 0;
    constructor(opciones) {
        this.opciones = opciones;
    }
    isConnected() {
        return Boolean(this.socket && !this.socket.destroyed);
    }
    async connect() {
        if (this.isConnected())
            return;
        const host = this.opciones.host?.trim();
        if (!host) {
            throw new errors_1.McpToolError("NO_CONFIGURADO", "No se indicó el host Telnet.", {
                sugerencia: "Indica el parámetro 'host' con la IP o el nombre del equipo, y opcionalmente 'port' (por defecto 23).",
            });
        }
        const port = this.opciones.port ?? 23;
        await new Promise((resolver, rechazar) => {
            const socket = new node_net_1.default.Socket();
            const tiempoLimite = setTimeout(() => {
                socket.destroy();
                rechazar(new errors_1.McpToolError("TIMEOUT", `La conexión Telnet a ${host}:${port} no se estableció a tiempo.`, {
                    sugerencia: "Comprueba que el equipo es accesible y que el servicio Telnet está habilitado. Muchos equipos modernos lo traen desactivado: en ese caso usa SSH.",
                }));
            }, 15_000);
            socket.on("data", (datos) => {
                this.buffer += datos.toString("utf8");
                this.ultimoDato = Date.now();
            });
            socket.on("error", (error) => {
                clearTimeout(tiempoLimite);
                rechazar(new errors_1.McpToolError("NO_DISPONIBLE", `Error de conexión Telnet con ${host}:${port}: ${error.message}`, {
                    sugerencia: "Verifica host, puerto y credenciales. Si el equipo solo acepta SSH, usa las herramientas del dominio ssh_.",
                }));
            });
            socket.connect(port, host, () => {
                clearTimeout(tiempoLimite);
                this.socket = socket;
                this.ultimoDato = Date.now();
                resolver();
            });
        });
        const usuario = this.opciones.username?.trim();
        if (usuario) {
            await this.esperarSalida(1500);
            await this.sendCommand(usuario);
            if (this.opciones.password !== undefined) {
                await this.esperarSalida(1500);
                await this.sendCommand(this.opciones.password ?? "");
            }
        }
    }
    async esperarSalida(ms) {
        const limite = Date.now() + ms;
        while (Date.now() < limite) {
            if (this.buffer.length > 0 && Date.now() - this.ultimoDato > 200)
                return;
            await new Promise((r) => setTimeout(r, 100));
            if (Date.now() - this.ultimoDato > 400)
                return;
        }
    }
    async disconnect() {
        const socket = this.socket;
        this.socket = null;
        if (!socket || socket.destroyed)
            return;
        await new Promise((resolver) => {
            socket.end(() => {
                socket.destroy();
                resolver();
            });
            setTimeout(() => {
                socket.destroy();
                resolver();
            }, 1000);
        });
    }
    async sendCommand(command) {
        if (!this.socket || this.socket.destroyed) {
            throw new errors_1.McpToolError("SIN_SESION", "La sesión Telnet no está abierta.", {
                sugerencia: "Vuelve a llamar a la herramienta: la conexión se abre sola antes del primer comando.",
            });
        }
        this.socket.write(`${command}${EOL_POR_PROTOCOLO.TELNET}`);
    }
    async readOutput(options = {}) {
        const idleMs = options.idleMs ?? 700;
        const maxMs = options.maxMs ?? 20_000;
        const limite = Date.now() + maxMs;
        while (Date.now() < limite) {
            if (this.buffer.length > 0 && Date.now() - this.ultimoDato >= idleMs)
                break;
            await new Promise((r) => setTimeout(r, 50));
        }
        const salida = this.buffer;
        this.buffer = "";
        return salida;
    }
}
exports.TelnetTransport = TelnetTransport;
function crearTransporte(opciones) {
    switch (opciones.protocol) {
        case "SERIAL":
            return new SerialTransport(opciones);
        case "SSH":
            return new SshTransport(opciones);
        case "TELNET":
            return new TelnetTransport(opciones);
        default:
            return lanzarProtocoloDesconocido(opciones.protocol);
    }
}
function lanzarProtocoloDesconocido(protocolo) {
    throw new errors_1.McpToolError("VALIDACION", `Protocolo de transporte no soportado: ${String(protocolo)}`, { sugerencia: "Usa uno de: SERIAL, SSH o TELNET." });
}
//# sourceMappingURL=adapters.js.map