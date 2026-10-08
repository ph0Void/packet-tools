import net from "net";
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

export interface TelnetExecuteOptions {

  idleMs?: number;

  maxMs?: number;
}

export class TelnetClient {
  private socket: net.Socket | null = null;
  private buffer: string = "";

  constructor(
    private host: string,
    private port: number = 23,
    private username?: string,
    private password?: string,
    private providerId: string | null = null
  ) {}

  public static async fromProviderId(providerId: string): Promise<TelnetClient> {
    const provider = await prismaClient.deviceProviders.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new Error(`Device provider con ID ${providerId} no encontrado.`);
    }

    const host = provider.host || "localhost";
    const port = provider.port || 23;
    const username = provider.username || undefined;
    const password = provider.password || undefined;

    Logger.info({
      message: "[TelnetClient] Cargando configuración Telnet desde la base de datos.",
      data: { host, port, username },
    })

    return new TelnetClient(host, port, username, password, providerId);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      Logger.info({
        message: `[TelnetClient] Conectando al servidor Telnet ${this.host}:${this.port}.`,
      });

      this.socket.on("data", (chunk: Buffer) => {
        Logger.info({
          message: `[TelnetClient] Datos recibidos del servidor Telnet ${this.host}:${this.port}.`,
          data: { chunk },
        });

        this.buffer += chunk.toString("utf-8");
      });

      this.socket.on("error", (err) => {
        Logger.error({
          message: `[TelnetClient] Error en la conexión Telnet ${this.host}:${this.port}.`,
          data: { error: err.message },
        });

        reject(new Error(`Error Telnet (${this.host}:${this.port}): ${err.message}`));
      });

      this.socket.connect(this.port, this.host, () => {
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      Logger.info({
        message: `[TelnetClient] Desconectando del servidor Telnet ${this.host}:${this.port}.`,
      });
      this.socket.destroy();
      this.socket = null;
    }
  }

  async send(data: string): Promise<void> {
    if (!this.socket) {
      await this.connect();
    }
    return new Promise((resolve, reject) => {

      this.socket!.write(`${data}${TERMINAL_EOL.TELNET}`, (err) => {

        if (err) {
          Logger.error({
            message: `[TelnetClient] Error al enviar datos al servidor Telnet ${this.host}:${this.port}.`,
            data: { error: err.message },
          });
          reject(err);
        }
        else {
          Logger.info({
            message: `[TelnetClient] Datos enviados al servidor Telnet ${this.host}:${this.port}.`,
          });
          resolve();
        }
      });
    });
  }

  async read(timeoutMs: number = 3000): Promise<string> {
    Logger.info({
      message: `[TelnetClient] Leyendo datos del servidor Telnet ${this.host}:${this.port}.`,
    });

    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (this.buffer.length > 0 || Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          const res = this.buffer;
          this.buffer = "";
          resolve(res);
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

      isAlive: () => Boolean(this.socket) && !this.socket!.destroyed,
    });
    this.buffer = "";
    return espera;
  }

  async executeCommands(
    commands: string[],
    options?: TelnetExecuteOptions,
  ): Promise<string> {

    const ctx = requestContext.getStore();
    if (ctx?.id) {
      const sesion = terminalSessionHub.findMatch(
        ctx.id,
        this.providerId,
        buildTerminalFingerprint({
          protocol: "TELNET",
          host: this.host,
          port: this.port,
        }),
      );
      if (sesion) {
        Logger.info({
          message: `[TelnetClient] Enrutando comandos por la sesión activa ${sesion.socketId}.`,
          data: { providerId: this.providerId, deviceName: sesion.deviceName },
        });
        const resultado: TerminalCommandResult =
          await terminalSessionHub.runCommandsDetailed(sesion, commands);
        return resolveCommandOutput(resultado, {
          destino: `${this.host}:${this.port}`,
          transporte: "Telnet",
        });
      }
    }

    const { commands: seguros, removed } = sanitizeCommandsForPrompt(
      commands,
      null,
    );
    if (seguros.length === 0) {
      throw new Error(
        `Comandos bloqueados por seguridad: cerrarían la sesión (${removed.join(", ") || "sin prompt conocido"}).`,
      );
    }

    try {
      let result = "";
      if (!this.socket) await this.connect();

      if (this.username) {
        await this.read(1500);
        await this.send(this.username);
      }
      if (this.password) {
        await this.read(1500);
        await this.send(this.password);
      }

      for (const cmd of seguros) {
        await this.send(cmd);
        const espera = await this.readUntilIdle(options);
        result += espera.output;
        if (espera.reason === "maxMs") {
          throw new Error(
            `Tiempo agotado (${espera.elapsedMs} ms): el equipo ${this.host}:${this.port} seguía escribiendo tras '${cmd}'. Puede seguir ejecutándolo; no repitas el comando. Salida parcial: "${espera.output.replace(/\s+/g, " ").trim()}"`,
          );
        }
      }

      await this.disconnect();

      return resolveCommandOutput(
        { output: result, executed: seguros, removed, elapsedMs: 0 },
        { destino: `${this.host}:${this.port}`, transporte: "Telnet" },
      );
    } catch (error) {

      await this.disconnect();
      throw error;
    }
  }
}
