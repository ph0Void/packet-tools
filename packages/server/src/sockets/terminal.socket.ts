import type { Server } from "socket.io";
import { Client as SshConnection } from "ssh2";
import net from "node:net";
import { SerialPort } from "serialport";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  terminalSessionHub,
  buildTerminalFingerprint,
  sanitizeTerminalOutput,
  SSH2_HANDSHAKE_PREFIX,
} from "@/sockets/TerminalSessionHub";
import { TERMINAL_EOL } from "@/sockets/terminalIO";

type ConnectionInput = { providerId?: string; type?: "SSH" | "TELNET" | "SERIAL"; protocol?: string; host?: string; port?: number; username?: string; password?: string; serialPort?: string; baudRate?: number; };
type Session = { close: () => void; write: (data: string) => void; resize?: (rows: number, cols: number) => void };

type TerminalDataEmitter = (data: Buffer | string) => void;

export function registerTerminalSocket(io: Server): void {
  io.on("connection", (socket) => {
    let session: Session | null = null;

    let sessionAlive = false;

    let generation = 0;

    let controlCarry = "";

    const finalizeSession = (gen: number): void => {
      if (gen !== generation) return;
      sessionAlive = false;
      terminalSessionHub.unregister(socket.id);
      socket.emit("terminal:closed");
    };

    const emitData: TerminalDataEmitter = (data) => {
      const texto = typeof data === "string" ? data : data.toString("utf8");
      const saneado = sanitizeTerminalOutput(controlCarry + texto);
      const corte = saneado.lastIndexOf("\n");
      const cola = saneado.slice(corte + 1);
      const colaSinCR = cola.endsWith("\r") ? cola.slice(0, -1) : cola;
      if (
        colaSinCR &&
        colaSinCR.length < SSH2_HANDSHAKE_PREFIX.length &&
        SSH2_HANDSHAKE_PREFIX.startsWith(colaSinCR)
      ) {
        controlCarry = cola;
        const visible = saneado.slice(0, corte + 1);
        if (visible) {
          socket.emit("terminal:data", visible);
          terminalSessionHub.recordData(socket.id, visible);
        }
        return;
      }
      controlCarry = "";
      if (!saneado) return;
      socket.emit("terminal:data", saneado);
      terminalSessionHub.recordData(socket.id, saneado);
    };

    socket.on("terminal:connect", async (input: ConnectionInput) => {
      try {

        const user = (socket.data as any)?.user;
        const rol = String(user?.role ?? "").toUpperCase();
        if (!user?.id || (rol !== "ADMIN" && rol !== "STAFF")) {
          socket.emit("terminal:error", { message: "Rol no autorizado para abrir una terminal interactiva (solo ADMIN/STAFF)" });
          return;
        }

        generation += 1;
        const gen = generation;
        if (session) session.close();
        session = null;

        sessionAlive = false;
        controlCarry = "";
        terminalSessionHub.unregister(socket.id);
        const provider: any = input.providerId ? await prismaClient.deviceProviders.findUnique({ where: { id: input.providerId } }) : input;
        if (!provider) throw new Error("Proveedor de conexión no encontrado");
        const type = String(input.type ?? input.protocol ?? provider.protocol ?? "TELNET").toUpperCase();
        if (type === "SSH") session = await createSshSession(emitData, provider, () => finalizeSession(gen));
        else if (type === "SERIAL") session = await createSerialSession(emitData, provider, () => finalizeSession(gen));
        else if (type === "TELNET") session = await createTelnetSession(emitData, provider, () => finalizeSession(gen));
        else throw new Error(`Protocolo no soportado: ${type}`);
        sessionAlive = true;

        const userId = socket.data?.user?.id as string | undefined;
        if (userId) {
          terminalSessionHub.register({
            socketId: socket.id,
            userId,
            providerId: input.providerId ?? null,
            protocol: type,
            deviceName: provider.name ?? null,

            typeDevice: provider.typeDevice ?? null,
            fingerprint: buildTerminalFingerprint({
              protocol: type,
              host: provider.host,
              port: provider.port,
              serialPort: provider.serialPort,
              baudRate: provider.serialBaudrate ?? provider.baudRate,
            }),
            write: (data) => { if (sessionAlive && session) session.write(data); },
            isAlive: () => socket.connected && sessionAlive,
            onBusyChange: (busy) => socket.emit(busy ? "terminal:busy" : "terminal:free"),
          });
        }
        socket.emit("terminal:connected", { success: true, type, sessionId: socket.id, providerId: input.providerId ?? null });
      } catch (error) { socket.emit("terminal:error", { message: error instanceof Error ? error.message : "No se pudo conectar" }); }
    });
    socket.on("terminal:data", (data: unknown) => {
      if (!session) return socket.emit("terminal:error", { message: "Terminal no conectada" });

      if (terminalSessionHub.isBusy(socket.id)) return;

      terminalSessionHub.noteUserInput(socket.id);
      session.write(String(data ?? ""));
    });
    socket.on("terminal:resize", (size: { rows?: number; cols?: number }) => session?.resize?.(Number(size.rows ?? 24), Number(size.cols ?? 80)));
    socket.on("terminal:disconnect", () => { session?.close(); session = null; finalizeSession(generation); });
    socket.on("disconnect", () => { session?.close(); session = null; finalizeSession(generation); });
  });
}

function createSshSession(emitData: TerminalDataEmitter, provider: any, onClosed: () => void): Promise<Session> {
  return new Promise((resolve, reject) => {
    const client = new SshConnection();
    client.once("ready", () => client.shell({ term: "xterm", rows: 24, cols: 80 }, (error, stream) => {
      if (error) return reject(error);
      stream.on("data", (data: Buffer) => emitData(data));
      stream.stderr.on("data", (data: Buffer) => emitData(data));
      stream.on("close", () => onClosed());
      resolve({ close: () => { stream.end(`exit${TERMINAL_EOL.SSH}`); client.end(); }, write: (data) => stream.write(data), resize: (rows, cols) => stream.setWindow(rows, cols, 0, 0) });
    })).once("error", reject).connect({ host: provider.host ?? "localhost", port: Number(provider.port ?? 22), username: provider.username ?? "admin", password: provider.password ?? undefined, readyTimeout: 15000 });
  });
}

function createTelnetSession(emitData: TerminalDataEmitter, provider: any, onClosed: () => void): Promise<Session> {
  return new Promise((resolve, reject) => {
    const connection = net.createConnection({ host: provider.host ?? "localhost", port: Number(provider.port ?? 23) });
    connection.on("data", (data) => emitData(data)).once("connect", () => resolve({ close: () => connection.destroy(), write: (data) => connection.write(data) })).once("error", reject).once("close", () => onClosed());
  });
}

function createSerialSession(emitData: TerminalDataEmitter, provider: any, onClosed: () => void): Promise<Session> {
  return new Promise((resolve, reject) => {
    const serial = new SerialPort({ path: provider.serialPort ?? "COM1", baudRate: Number(provider.serialBaudrate ?? provider.baudRate ?? 9600) });
    serial.on("data", (data) => emitData(data)).once("open", () => resolve({ close: () => serial.close(), write: (data) => serial.write(data) })).once("error", reject).once("close", () => onClosed());
  });
}
