
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { BcryptAdapter } from "@/utils/BcryptAdapter";
import { requestContext, type RequestUser } from "@/utils/RequestContext";
import {
  terminalSessionHub,
  type TerminalSession,
} from "@/sockets/TerminalSessionHub";


const PREFIX_LOG_BACKEND = /^\[(INFO|WARNING|ERROR|DEBUG)\] \d/;
const consoleReal = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let logFiltrado = false;


export function silenciarLogOfBackend(): void {
  if (logFiltrado || process.env.TERMINAL_TEST_VERBOSE === "1") return;
  logFiltrado = true;
  const filtrar =
    (original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      const first = args[0];
      if (typeof first === "string" && PREFIX_LOG_BACKEND.test(first)) return;
      original(...args);
    };
  console.log = filtrar(consoleReal.log) as typeof console.log;
  console.warn = filtrar(consoleReal.warn) as typeof console.warn;
  console.error = filtrar(consoleReal.error) as typeof console.error;
}


export function write(line = ""): void {
  consoleReal.log(line);
}

export type Status = "OK" | "FALLO" | "SKIP";

export interface Result {
  status: Status;
  name: string;
  detail: string;
}


export const results: Result[] = [];






export function truncate(value: unknown, max = 420): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}… [${text.length} chars]` : text;
}


export function record(status: Status, name: string, detail: string): void {
  results.push({ status, name, detail });
  write(`[${status}] ${name}`);
  if (status !== "OK" && detail) write(`       ${truncate(detail)}`);
}


export function skip(name: string, detail: string): void {
  record("SKIP", name, detail);
}



export function assert(
  name: string,
  condicion: boolean,
  detailOk: string,
  detailFailure: string,
): boolean {
  record(condicion ? "OK" : "FALLO", name, condicion ? detailOk : detailFailure);
  return condicion;
}


export function hasFailures(): boolean {
  return results.some((r) => r.status === "FALLO");
}


export function summary(): { ok: number; failures: number; skips: number } {
  const ok = results.filter((r) => r.status === "OK").length;
  const failures = results.filter((r) => r.status === "FALLO");
  const skips = results.filter((r) => r.status === "SKIP");
  write("\n=== RESUMEN ===");
  write(`OK: ${ok}   FALLOS: ${failures.length}   SKIP: ${skips.length}`);
  for (const f of failures) write(`  [FALLO] ${f.name} → ${truncate(f.detail, 300)}`);
  for (const s of skips) write(`  [SKIP]  ${s.name} → ${s.detail}`);
  return { ok, failures: failures.length, skips: skips.length };
}


export class EnvNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EntornoNoDisponibleError";
  }
}



export function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}


export function entero(value: string | undefined, byDefecto: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : byDefecto;
}




export interface AdminSuite {
  
  user: RequestUser;
  
  username: string;
  
  password: string;
  
  token: string;
}


const USER_SUITE = "test_terminal_admin";



export async function iniciarSessionAdmin(url: string): Promise<AdminSuite> {
  const password = `secret_${Date.now()}`;
  const existente = await prismaClient.user.findUnique({
    where: { username: USER_SUITE },
  });
  if (existente) {
    await prismaClient.user.update({
      where: { id: existente.id },
      data: { password: BcryptAdapter.hash(password), role: "ADMIN" },
    });
  } else {
    await prismaClient.user.create({
      data: {
        username: USER_SUITE,
        password: BcryptAdapter.hash(password),
        role: "ADMIN",
      },
    });
  }

  const reply = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER_SUITE, password }),
  });
  if (!reply.ok) {
    throw new EnvNoDisponibleError(
      `Login del ADMIN de la batería falló (${reply.status}). ¿Está la base de datos sembrada? Ejecuta \`npm run seed\`.`,
    );
  }
  const cookie = reply.headers.get("set-cookie") ?? "";
  const token = cookie
    .split(";")[0]
    .replace("packet-tools-cookie=", "")
    .trim();
  if (!token) {
    throw new EnvNoDisponibleError(
      "El login no devolvió la cookie packet-tools-cookie con el JWT.",
    );
  }

  const user = await prismaClient.user.findUnique({
    where: { username: USER_SUITE },
  });
  if (!user) throw new EnvNoDisponibleError("El ADMIN de la batería no existe.");

  return {
    user: { id: user.id, username: user.username, role: "ADMIN", autonomous: true },
    username: user.username,
    password,
    token,
  };
}


let backendArrancado = false;


export async function arrancarBackend(): Promise<number> {
  
  
  
  process.env.NODE_ENV = "test";
  const { server } = await import("@/app");
  const httpServer = server as HttpServer;
  backendArrancado = true;

  if (!httpServer.listening) {
    const requested = Number(process.env.TERMINAL_TEST_PORT ?? process.env.SERVER_PORT ?? 7531);
    try {
      await new Promise<void>((resolve, reject) => {
        const alError = (error: Error): void => reject(error);
        httpServer.once("error", alError);
        httpServer.listen(requested, () => {
          httpServer.off("error", alError);
          resolve();
        });
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw error;
      write(
        `[AVISO] El puerto ${requested} está ocupado (¿hay un \`npm run dev\` en marcha?). ` +
          "Se escucha en un puerto efímero: la batería prueba la lógica, no el puerto. " +
          "Si prefieres fijarlo, exporta TERMINAL_TEST_PORT.\n",
      );
      await new Promise<void>((resolve, reject) => {
        const alError = (error: Error): void => reject(error);
        httpServer.once("error", alError);
        httpServer.listen(0, () => {
          httpServer.off("error", alError);
          resolve();
        });
      });
    }
  }

  return (httpServer.address() as AddressInfo).port;
}


export async function pararBackend(): Promise<void> {
  if (!backendArrancado) return;
  const { server, io } = await import("@/app");
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
  const httpServer = server as HttpServer;
  if (httpServer.listening) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }
}


export interface PayloadConnection {
  type: "TELNET" | "SSH" | "SERIAL";
  host?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  username?: string;
  password?: string;
  
  typeDevice?: string | null;
  
  name?: string;
}


export interface MockConsoleConnected {
  socket: Socket;
  
  sessionId: string;
  
  session: TerminalSession;
  
  cerrar(): Promise<void>;
}

function wait<T>(
  armar: (ok: (value: T) => void, ko: (error: Error) => void) => void,
  that: string,
  ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(
      () => reject(new Error(`${that}: se agotaron ${ms} ms`)),
      ms,
    );
    armar(
      (value) => {
        clearTimeout(temporizador);
        resolve(value);
      },
      (error) => {
        clearTimeout(temporizador);
        reject(error);
      },
    );
  });
}



export async function connectMockConsole(
  url: string,
  token: string,
  payload: PayloadConnection,
  timeoutMs = 20_000,
): Promise<MockConsoleConnected> {
  const socket = io(url, {
    transports: ["websocket"],
    reconnection: false,
    auth: { token },
  });

  await wait<void>(
    (ok, ko) => {
      socket.on("connect", () => ok());
      socket.on("connect_error", (error: Error) =>
        ko(new Error(`No se pudo conectar el socket: ${error.message}`)),
      );
    },
    "Conexión del socket",
    timeoutMs,
  );

  const info = await wait<{ success: boolean; type: string; sessionId: string }>(
    (ok, ko) => {
      socket.on("terminal:connected", ok);
      socket.on("terminal:error", (payloadError: { message?: string }) =>
        ko(new Error(`terminal:error → ${payloadError?.message ?? "sin mensaje"}`)),
      );
      socket.emit("terminal:connect", payload);
    },
    "terminal:connected",
    timeoutMs,
  );


  const session = terminalSessionHub.get(info.sessionId);
  if (!session) {
    socket.disconnect();
    throw new Error(
      `El hub no tiene sesión para ${info.sessionId}: el socket se conectó pero el registro no llegó.`,
    );
  }

  return {
    socket,
    sessionId: info.sessionId,
    session,
    cerrar: async () => {
      socket.emit("terminal:disconnect");
      socket.removeAllListeners();
      socket.disconnect();
      terminalSessionHub.unregister(info.sessionId);
    },
  };
}



export async function waitPrompt(
  session: TerminalSession,
  timeoutMs = 5_000,
  expected?: string,
) {
  return terminalSessionHub.waitForPrompt(session, { expected, timeoutMs });
}



export function comoAdmin<T>(admin: AdminSuite, fn: () => Promise<T>): Promise<T> {
  return requestContext.run(admin.user, fn);
}




export interface EnvSuite {


export async function cerrarEnv(): Promise<void> {
  await pararBackend().catch(() => undefined);
  await prismaClient.$disconnect().catch(() => undefined);
}



const VIGIA_MS = 20_000;

export function finalizar(code: number, error?: unknown): void {
  const vigilante = setTimeout(() => {
    consoleReal.error(
      `\n[AVISO] Algo quedó abierto y el proceso no vacío solo en ${VIGIA_MS} ms; se fuerza la salida.`,
    );
    process.exit(code);
  }, VIGIA_MS);
  vigilante.unref();

  if (error !== undefined) {
    consoleReal.error(
      "\nError fatal:" + (error instanceof Error ? `\n${error.message}\n${error.stack ?? ""}` : ` ${error}`),
    );
  }

  void (async () => {
    await cerrarEnv();
    clearTimeout(vigilante);
    process.exitCode = code;
  })();
}



export function codeOfOutput(): number {
  const { ok, failures, skips } = summary();
  write(`Total: ${ok + failures + skips} comprobaciones.`);
  return hasFailures() ? 1 : 0;
}
