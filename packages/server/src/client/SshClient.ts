import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
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
} from "@/sockets/terminalIO";

export interface SshExecuteOptions {

  idleMs?: number;

  maxMs?: number;

  removed?: string[];
}

const PARTIAL_TAIL_CHARS = 800;

export class SshClient {
  private client: Client | null = null;

  constructor(
    private host: string,
    private port: number = 22,
    private username: string,
    private password?: string,
    private privateKey?: string,
    private providerId: string | null = null
  ) {}

  public static async fromProviderId(providerId: string): Promise<SshClient> {
    const provider = await prismaClient.deviceProviders.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new Error(`Device provider con ID ${providerId} no encontrado.`);
    }

    const host = provider.host || "localhost";
    const port = provider.port || 22;
    const username = provider.username || "admin";
    const password = provider.password || undefined;

    Logger.info({
      message: "[SshClient] Cargando configuración SSH desde la base de datos.",
      data: { host, port, username },
    });
    return new SshClient(host, port, username, password, undefined, providerId);
  }

  async connect(): Promise<void> {
    this.client = new Client();

    Logger.info({
      message: `[SshClient] Conectando al servidor SSH ${this.host}:${this.port}.`,
    });

    return new Promise<void>((resolve, reject) => {
      this.client!
        .on("ready", () => resolve())
        .on("error", (err) => reject(err))
        .connect({
          host: this.host,
          port: this.port,
          username: this.username,
          password: this.password,
          privateKey: this.privateKey,
          readyTimeout: 15000,
        });
    });
  }

  async disconnect(): Promise<void> {

    Logger.info({
      message: `[SshClient] Desconectando del servidor SSH ${this.host}:${this.port}.`,
    });

    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  async executeCommands(
    commands: string[],
    options?: SshExecuteOptions,
  ): Promise<string> {

    const ctx = requestContext.getStore();
    if (ctx?.id) {
      const sesion = terminalSessionHub.findMatch(
        ctx.id,
        this.providerId,

        buildTerminalFingerprint({
          protocol: "SSH",
          host: this.host,
          port: this.port,
        }),
      );
      if (sesion) {
        Logger.info({
          message: `[SshClient] Enrutando comandos por la sesión activa ${sesion.socketId}.`,
          data: { providerId: this.providerId, deviceName: sesion.deviceName },
        });

        const resultado: TerminalCommandResult =
          await terminalSessionHub.runCommandsDetailed(sesion, commands);
        return resolveCommandOutput(resultado, {
          destino: `${this.host}:${this.port}`,
          transporte: "SSH",
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

    if (!this.client) {
      await this.connect();
    }

    Logger.info({
      message: `[SshClient] Ejecutando comandos en el servidor SSH ${this.host}:${this.port}.`,
      data: { comandos: seguros },
    });

    return this.runDirectShell(seguros, { ...options, removed });
  }

  private runDirectShell(
    commands: string[],
    options?: SshExecuteOptions,
  ): Promise<string> {
    const idleMs = options?.idleMs ?? DEFAULT_IDLE_MS;
    const maxMs = options?.maxMs ?? DEFAULT_MAX_MS;
    const descartados = options?.removed ?? [];
    const destino = `${this.host}:${this.port}`;

    return new Promise<string>((resolve, reject) => {
      let salida = "";
      let stream: ClientChannel | null = null;
      let cerrado = false;
      let errorRed: Error | null = null;
      let liquidado = false;

      const cerrarStream = (): void => {
        try {
          stream?.end();
        } catch {

        }
      };

      const liquidar = (accion: () => void, soltar: boolean): void => {
        if (liquidado) return;
        liquidado = true;
        cerrarStream();
        if (soltar) void this.disconnect().catch(() => undefined);
        try {
          accion();
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(`Fallo inesperado en SSH ${destino}.`),
          );
        }
      };

      const conSalida = (texto: string, elapsedMs: number) =>
        resolveCommandOutput(
          {
            output: texto,
            executed: commands,
            removed: descartados,
            elapsedMs,
          },
          { destino, transporte: "SSH" },
        );

      const abierto = (opened: ClientChannel) => {
        stream = opened;

        opened.on("data", (data: Buffer) => {
          salida += data.toString("utf-8");
        });

        opened.on("error", (error: Error) => {
          errorRed = error;
          liquidar(
            () =>
              reject(
                new Error(
                  `Fallo de red SSH a mitad de la ejecución en ${destino}: ${error.message}. Comandos enviados: [${commands.join(", ")}].${colaParcial(salida)}`,
                ),
              ),
            true,
          );
        });

        opened.on("close", () => {
          cerrado = true;
          liquidar(() => resolve(conSalida(salida, 0)), false);
        });

        for (const cmd of commands) {
          opened.write(`${cmd}${TERMINAL_EOL.SSH}`);
        }

        opened.write(`exit${TERMINAL_EOL.SSH}`);

        void waitForOutput({
          read: () => salida,
          idleMs,
          maxMs,
          abortOnPending: true,

          isAlive: () => !cerrado && errorRed === null,
        })
          .then((espera) => {
            if (cerrado || errorRed) return; // ya liquidado por close/error
            if (espera.reason === "pending") {
              liquidar(
                () =>
                  reject(
                    new Error(
                      `${motivoPendiente(espera.pending)} en ${destino}. No se envió ninguna tecla para no interferer con la consola; el comando puede seguir ejecutándose en el equipo. Salida parcial:${colaParcial(salida)}`,
                    ),
                  ),
                true,
              );
              return;
            }
            if (espera.reason === "maxMs") {
              liquidar(
                () =>
                  reject(
                    new Error(
                      `Tiempo agotado (${maxMs} ms): el shell de ${destino} sigue abierto tras [${commands.join(", ")}]. El comando puede seguir ejecutándose en el equipo: no lo repitas, comprueba antes si sigue escribiendo.${colaParcial(salida)}`,
                    ),
                  ),
                true,
              );
              return;
            }

            liquidar(
              () => resolve(conSalida(espera.output, espera.elapsedMs)),
              true,
            );
          })
          .catch((error: unknown) => {
            liquidar(
              () => reject(error as Error),
              true,
            );
          });
      };

      try {
        this.client!.shell((err, opened) => {
          if (err) {
            liquidar(
              () =>
                reject(
                  new Error(
                    `No se pudo abrir el shell SSH en ${destino}: ${err.message}`,
                  ),
                ),
              true,
            );
            return;
          }
          abierto(opened);
        });
      } catch (error) {
        liquidar(() => reject(error as Error), true);
      }
    });
  }
}

function motivoPendiente(pending: string | null): string {
  const texto = String(pending ?? "");
  if (/--More--/i.test(texto)) {
    return "El equipo espera una tecla: paginador activo (--More--)";
  }
  if (/password/i.test(texto)) {
    return "El equipo pide una contraseña (Password:)";
  }
  return `El equipo espera una respuesta (${texto || "confirmación"})`;
}

function colaParcial(salida: string): string {
  const texto = String(salida ?? "");
  if (!texto.trim()) return " (el equipo no devolvió nada).";
  const cola =
    texto.length > PARTIAL_TAIL_CHARS ? texto.slice(-PARTIAL_TAIL_CHARS) : texto;
  return ` "${cola.replace(/\s+/g, " ").trim()}"`;
}
