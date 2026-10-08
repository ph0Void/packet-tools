import { SerialPort } from "serialport";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { requestContext } from "@/utils/RequestContext";
import { sanitizeCommandsForPrompt } from "@/agent/terminal/sanitizeCommands";
import {
  terminalSessionHub,
  buildTerminalFingerprint,
  type TerminalCommandResult,
} from "@/sockets/TerminalSessionHub";
import {
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_MS,
  TERMINAL_EOL,
  resolveCommandOutput,
  waitForOutput,
  type WaitForOutputResult,
} from "@/sockets/terminalIO";

export interface SerialExecuteOptions {

  idleMs?: number;

  maxMs?: number;
}

export class SerialPortClient {
  private client: SerialPort | null = null;
  private buffer: string = "";

  constructor(
    private path: string,
    private baudRate: number = 9600,
    private providerId: string | null = null
  ) {}

  public static async fromProviderId(providerId: string): Promise<SerialPortClient> {
    const provider = await prismaClient.deviceProviders.findUnique({
      where: { id: providerId },
    });

    Logger.info({
      message: "[SerialPortClient] Cargando configuración de puerto serial desde la base de datos.",
      data: {
        providerId: providerId,
        name : provider?.name,
        serialPort: provider?.serialPort,
       },
    })

    if (!provider) {

      Logger.error({
        message: "[SerialPortClient] Error al cargar la configuración de puerto serial.",
        data: { providerId },
      });

      throw new Error(`Device provider con ID ${providerId} no encontrado.`);
    }
    const portPath = provider.serialPort || "COM1";
    const baudRate = provider.serialBaudrate || 9600;
    return new SerialPortClient(portPath, baudRate, providerId);
  }

  async connect(): Promise<void> {
    if (this.client && this.client.isOpen) return;

    return new Promise((resolve, reject) => {
      this.client = new SerialPort({
        path: this.path,
        baudRate: this.baudRate,
        autoOpen: false,
      });

      Logger.info({
        message: `[SerialPortClient] Conectando al puerto serial ${this.path} a ${this.baudRate} baudios.`,
      })

      this.client.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf-8");
      });

      this.client.open((err) => {
        if (err) {

          Logger.error({
            message: `[SerialPortClient] Error al abrir puerto serial ${this.path}.`,
            data: { error: err.message },
          });

          reject(new Error(`Error al abrir puerto serial ${this.path}: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client && this.client.isOpen) {
      return new Promise((resolve) => {
        this.client!.close(() => {
          this.client = null;
          resolve();
        });
      });
    }
  }

  async write(data: string): Promise<void> {
    if (!this.client || !this.client.isOpen) {
      await this.connect();
    }

    Logger.info({
      message: `[SerialPortClient] Escribiendo datos en el puerto serial ${this.path}.`,
    });

    return new Promise((resolve, reject) => {
      this.client!.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async read(timeoutMs: number = 3000): Promise<string> {

    Logger.info({
      message: `[SerialPortClient] Leyendo datos del puerto serial ${this.path}.`,
    });

    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (this.buffer.length > 0 || Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          const data = this.buffer;
          this.buffer = "";
          resolve(data);
        }
      }, 100);
    });
  }

  private async readUntilIdle(
    options?: { idleMs?: number; maxMs?: number },
  ): Promise<WaitForOutputResult> {
    const espera = await waitForOutput({
      read: () => this.buffer,
      idleMs: options?.idleMs ?? DEFAULT_IDLE_MS,
      maxMs: options?.maxMs ?? DEFAULT_MAX_MS,

      isAlive: () => Boolean(this.client?.isOpen),
    });
    this.buffer = "";
    return espera;
  }

  async executeCommand(
    command: string,
    options?: SerialExecuteOptions,
  ): Promise<string> {

    const ctx = requestContext.getStore();
    if (ctx?.id) {
      const sesion = terminalSessionHub.findMatch(
        ctx.id,
        this.providerId,

        buildTerminalFingerprint({
          protocol: "SERIAL",
          serialPort: this.path,
          baudRate: this.baudRate,
        }),
      );
      if (sesion) {
        Logger.info({
          message: `[SerialPortClient] Enrutando comando por la sesión activa ${sesion.socketId}.`,
          data: { providerId: this.providerId, deviceName: sesion.deviceName },
        });
        const resultado: TerminalCommandResult =
          await terminalSessionHub.runCommandsDetailed(sesion, [command]);
        return resolveCommandOutput(resultado, {
          destino: this.path,
          transporte: "serie",
        });
      }
    }

    const { commands: seguros, removed } = sanitizeCommandsForPrompt(
      [command],
      null,
    );
    if (seguros.length === 0) {
      throw new Error(
        `Comandos bloqueados por seguridad: cerrarían la sesión (${removed.join(", ") || "sin prompt conocido"}).`,
      );
    }

    this.buffer = "";
    await this.write(`${seguros[0]}${TERMINAL_EOL.SERIAL}`);

    Logger.info({
      message: `[SerialPortClient] Ejecutando comando en el puerto serial ${this.path}: ${seguros[0]}`,
    });

    const espera = await this.readUntilIdle(options);
    try {
      if (espera.reason === "maxMs") {
        throw new Error(
          `Tiempo agotado (${espera.elapsedMs} ms): el puerto serial ${this.path} seguía escribiendo tras '${seguros[0]}'. Puede seguir ejecutándolo; no repitas el comando. Salida parcial: "${espera.output.replace(/\s+/g, " ").trim()}"`,
        );
      }

      return resolveCommandOutput(
        {
          output: espera.output,
          executed: seguros,
          removed,
          elapsedMs: espera.elapsedMs,
        },
        { destino: this.path, transporte: "serie" },
      );
    } catch (error) {

      await this.disconnect().catch(() => undefined);
      throw error;
    }
  }
}
