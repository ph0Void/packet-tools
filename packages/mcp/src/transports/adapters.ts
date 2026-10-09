
import { SerialPort } from "serialport";
import { Client as Ssh2Client } from "ssh2";
import net from "node:net";
import type {
  DeviceTransport,
  OpcionesConexion,
  ProtocoloTransporte,
} from "./DeviceTransport";
import { McpToolError } from "@/core/errors";


const EOL_POR_PROTOCOLO: Record<ProtocoloTransporte, string> = {
  SSH: "\r",
  TELNET: "\r\n",
  SERIAL: "\r\n",
};


async function esperarA(
  condicion: () => boolean,
  timeoutMs: number,
  pasoMs = 50,
): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (condicion()) return true;
    await new Promise((r) => setTimeout(r, pasoMs));
  }
  return condicion();
}






export class SerialTransport implements DeviceTransport {
  readonly protocol: ProtocoloTransporte = "SERIAL";
  private puerto: SerialPort | null = null;
  
  private buffer = "";
  
  private ultimoDato = 0;

  constructor(private readonly opciones: OpcionesConexion) {}

  isConnected(): boolean {
    return Boolean(this.puerto?.isOpen);
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;

    const ruta = this.opciones.serialPort?.trim();
    if (!ruta) {
      throw new McpToolError(
        "NO_CONFIGURADO",
        "No se indicó el puerto serie a usar.",
        {
          sugerencia:
            "Llama a serial_list_ports para ver los puertos disponibles en este equipo y repite la llamada con el 'path' que corresponda (por ejemplo 'COM3' o '/dev/ttyUSB0').",
        },
      );
    }

    const baudRate = this.opciones.baudRate ?? 9600;

    await new Promise<void>((resolver, rechazar) => {
      const puerto = new SerialPort(
        { path: ruta, baudRate, autoOpen: false },
        (error) => {
          if (error) {
            rechazar(
              new McpToolError(
                "NO_DISPONIBLE",
                `No se pudo abrir el puerto serie '${ruta}': ${error.message}`,
                {
                  sugerencia:
                    "Comprueba que el cable está conectado, que no lo está usando otro programa (otra consola, PuTTY, la app web) y que el nombre del puerto es correcto según serial_list_ports.",
                },
              ),
            );
          }
        },
      );

      puerto.on("data", (datos: Buffer) => {
        this.buffer += datos.toString("utf8");
        this.ultimoDato = Date.now();
      });

      puerto.on("error", (error: Error) => {
        
        
        this.buffer += `\n[ERROR DEL PUERTO SERIE: ${error.message}]\n`;
        this.ultimoDato = Date.now();
      });

      puerto.open((error) => {
        if (error) {
          rechazar(
            new McpToolError(
              "NO_DISPONIBLE",
              `No se pudo abrir el puerto serie '${ruta}' a ${baudRate} baudios: ${error.message}`,
              {
                sugerencia:
                  "Verifica que el puerto existe y que no está ocupado por otro programa. En Windows suele ser 'COM3'; en Linux '/dev/ttyUSB0' y puede requerir permisos (grupo dialout).",
              },
            ),
          );
          return;
        }
        this.puerto = puerto;
        this.ultimoDato = Date.now();
        resolver();
      });
    });
  }

  async disconnect(): Promise<void> {
    const puerto = this.puerto;
    this.puerto = null;
    if (!puerto?.isOpen) return;
    await new Promise<void>((resolver) => {
      puerto.close(() => resolver());
    });
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.puerto?.isOpen) {
      throw new McpToolError("SIN_SESION", "El puerto serie no está abierto.", {
        sugerencia: "Vuelve a llamar a la herramienta: la conexión se abre sola antes de enviar el primer comando.",
      });
    }
    await new Promise<void>((resolver, rechazar) => {
      this.puerto!.write(`${command}${EOL_POR_PROTOCOLO.SERIAL}`, (error) => {
        if (error) {
          rechazar(
            new McpToolError(
              "OPERACION_FALLIDA",
              `No se pudo escribir en el puerto serie: ${error.message}`,
              { sugerencia: "Comprueba que el cable sigue conectado y que el equipo está encendido." },
            ),
          );
          return;
        }
        
        
        this.puerto!.drain(() => resolver());
      });
    });
  }

  async readOutput(options: { idleMs?: number; maxMs?: number } = {}): Promise<string> {
    const idleMs = options.idleMs ?? 700;
    const maxMs = options.maxMs ?? 20_000;
    const limite = Date.now() + maxMs;

    
    while (Date.now() < limite) {
      if (this.buffer.length > 0 && Date.now() - this.ultimoDato >= idleMs) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const salida = this.buffer;
    this.buffer = "";
    return salida;
  }
}


export async function listarPuertosSerie(): Promise<
  Array<{
    path: string;
    manufacturer: string | null;
    serialNumber: string | null;
    vendorId: string | null;
    productId: string | null;
    pnpId: string | null;
  }>
> {
  try {
    const puertos = await SerialPort.list();
    return puertos.map((puerto) => ({
      path: puerto.path,
      manufacturer: puerto.manufacturer ?? null,
      serialNumber: puerto.serialNumber ?? null,
      vendorId: puerto.vendorId ?? null,
      productId: puerto.productId ?? null,
      pnpId: puerto.pnpId ?? null,
    }));
  } catch (error) {
    throw new McpToolError(
      "NO_DISPONIBLE",
      `No se pudieron enumerar los puertos serie: ${error instanceof Error ? error.message : String(error)}`,
      {
        sugerencia:
          "En Linux puede faltar el paquete 'udev' o permisos sobre /dev/ttyUSB*; en Windows, comprueba que el driver del adaptador USB-serie está instalado. El resto de dominios (packet-tracer, gns3, ssh) siguen funcionando.",
      },
    );
  }
}






export class SshTransport implements DeviceTransport {
  readonly protocol: ProtocoloTransporte = "SSH";
  private cliente: Ssh2Client | null = null;
  private stream: import("ssh2").ClientChannel | null = null;
  private buffer = "";
  private ultimoDato = 0;

  constructor(private readonly opciones: OpcionesConexion) {}

  isConnected(): boolean {
    return Boolean(this.stream);
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;

    const host = this.opciones.host?.trim();
    if (!host) {
      throw new McpToolError("NO_CONFIGURADO", "No se indicó el host SSH.", {
        sugerencia: "Indica el parámetro 'host' con la IP o el nombre del equipo, y opcionalmente 'port' (por defecto 22).",
      });
    }

    const cliente = new Ssh2Client();

    await new Promise<void>((resolver, rechazar) => {
      const tiempoLimite = setTimeout(() => {
        rechazar(
          new McpToolError("TIMEOUT", `La conexión SSH a ${host} no se estableció a tiempo.`, {
            sugerencia: "Comprueba que el equipo es accesible (ping), que el servicio SSH está activo y que el puerto es el correcto.",
          }),
        );
      }, 15_000);

      cliente.on("ready", () => {
        
        
        
        cliente.shell((error, stream) => {
          if (error) {
            clearTimeout(tiempoLimite);
            rechazar(
              new McpToolError("OPERACION_FALLIDA", `No se pudo abrir la shell SSH: ${error.message}`, {
                sugerencia: "El equipo aceptó la conexión pero rechazó la shell. Comprueba que el usuario tiene permitido abrir una sesión interactiva.",
              }),
            );
            return;
          }

          stream.on("data", (datos: Buffer) => {
            this.buffer += datos.toString("utf8");
            this.ultimoDato = Date.now();
          });
          stream.stderr.on("data", (datos: Buffer) => {
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

      cliente.on("error", (error: Error) => {
        clearTimeout(tiempoLimite);
        rechazar(
          new McpToolError("NO_DISPONIBLE", `Error de conexión SSH con ${host}: ${error.message}`, {
            sugerencia:
              "Comprueba host, puerto y credenciales. Si el equipo pide clave pública, pásala en 'privateKey'. Verifica también que el usuario y la contraseña son correctos.",
          }),
        );
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

  async disconnect(): Promise<void> {
    this.stream?.close();
    this.stream = null;
    this.cliente?.end();
    this.cliente = null;
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.stream) {
      throw new McpToolError("SIN_SESION", "La sesión SSH no está abierta.", {
        sugerencia: "Vuelve a llamar a la herramienta: la conexión se abre sola antes del primer comando.",
      });
    }
    this.stream.write(`${command}${EOL_POR_PROTOCOLO.SSH}`);
  }

  async readOutput(options: { idleMs?: number; maxMs?: number } = {}): Promise<string> {
    const idleMs = options.idleMs ?? 700;
    const maxMs = options.maxMs ?? 20_000;
    const limite = Date.now() + maxMs;

    while (Date.now() < limite) {
      if (this.buffer.length > 0 && Date.now() - this.ultimoDato >= idleMs) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const salida = this.buffer;
    this.buffer = "";
    return salida;
  }
}






export class TelnetTransport implements DeviceTransport {
  readonly protocol: ProtocoloTransporte = "TELNET";
  private socket: net.Socket | null = null;
  private buffer = "";
  private ultimoDato = 0;

  constructor(private readonly opciones: OpcionesConexion) {}

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;

    const host = this.opciones.host?.trim();
    if (!host) {
      throw new McpToolError("NO_CONFIGURADO", "No se indicó el host Telnet.", {
        sugerencia: "Indica el parámetro 'host' con la IP o el nombre del equipo, y opcionalmente 'port' (por defecto 23).",
      });
    }

    const port = this.opciones.port ?? 23;

    await new Promise<void>((resolver, rechazar) => {
      const socket = new net.Socket();

      const tiempoLimite = setTimeout(() => {
        socket.destroy();
        rechazar(
          new McpToolError("TIMEOUT", `La conexión Telnet a ${host}:${port} no se estableció a tiempo.`, {
            sugerencia:
              "Comprueba que el equipo es accesible y que el servicio Telnet está habilitado. Muchos equipos modernos lo traen desactivado: en ese caso usa SSH.",
          }),
        );
      }, 15_000);

      socket.on("data", (datos: Buffer) => {
        this.buffer += datos.toString("utf8");
        this.ultimoDato = Date.now();
      });

      socket.on("error", (error: Error) => {
        clearTimeout(tiempoLimite);
        rechazar(
          new McpToolError("NO_DISPONIBLE", `Error de conexión Telnet con ${host}:${port}: ${error.message}`, {
            sugerencia:
              "Verifica host, puerto y credenciales. Si el equipo solo acepta SSH, usa las herramientas del dominio ssh_.",
          }),
        );
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

  
  private async esperarSalida(ms: number): Promise<void> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (this.buffer.length > 0 && Date.now() - this.ultimoDato > 200) return;
      await new Promise((r) => setTimeout(r, 100));
      if (Date.now() - this.ultimoDato > 400) return;
    }
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.destroyed) return;
    await new Promise<void>((resolver) => {
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

  async sendCommand(command: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) {
      throw new McpToolError("SIN_SESION", "La sesión Telnet no está abierta.", {
        sugerencia: "Vuelve a llamar a la herramienta: la conexión se abre sola antes del primer comando.",
      });
    }
    this.socket.write(`${command}${EOL_POR_PROTOCOLO.TELNET}`);
  }

  async readOutput(options: { idleMs?: number; maxMs?: number } = {}): Promise<string> {
    const idleMs = options.idleMs ?? 700;
    const maxMs = options.maxMs ?? 20_000;
    const limite = Date.now() + maxMs;

    while (Date.now() < limite) {
      if (this.buffer.length > 0 && Date.now() - this.ultimoDato >= idleMs) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const salida = this.buffer;
    this.buffer = "";
    return salida;
  }
}






export function crearTransporte(opciones: OpcionesConexion): DeviceTransport {
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


function lanzarProtocoloDesconocido(protocolo: never): never {
  throw new McpToolError(
    "VALIDACION",
    `Protocolo de transporte no soportado: ${String(protocolo)}`,
    { sugerencia: "Usa uno de: SERIAL, SSH o TELNET." },
  );
}


export { esperarA };
