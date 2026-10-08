import type { Server } from "socket.io";
import { JwtAdapter } from "@/utils/JwtAdapter";

function isSimulatorClient(socket: any): boolean {
  const clientType = String(socket?.handshake?.query?.clientType ?? "");
  const userAgent = String(socket?.handshake?.headers?.["user-agent"] ?? "");
  return clientType === "packet-tracer" || userAgent.includes("Qt");
}

function secretoVigente(): string {
  return process.env.PT_EXTENSION_SECRET ?? "";
}

function secretoPresentado(socket: any): string {
  const fromAuth = typeof socket?.handshake?.auth?.secret === "string" ? socket.handshake.auth.secret : "";
  const fromHeader = typeof socket?.handshake?.headers?.["x-packet-tools-secret"] === "string" ? socket.handshake.headers["x-packet-tools-secret"] : "";
  return fromAuth || fromHeader;
}

export function registerSocketAuth(io: Server): void {
  io.use((socket, next) => {
    if (isSimulatorClient(socket)) {

      const secreto = secretoVigente();
      if (secreto && secretoPresentado(socket) !== secreto) {
        return next(new Error("Secreto de extensión inválido"));
      }
      return next();
    }
    const clientType = String(socket.handshake.query.clientType ?? "");
    if (clientType === "backend-agent") {
      const secreto = secretoVigente();
      if (secreto && secretoPresentado(socket) !== secreto) {
        return next(new Error("Secreto de backend-agent inválido"));
      }
      return next();
    }
    const header = socket.handshake.headers.cookie ?? "";
    const cookieToken = header.split(";").map((value) => value.trim()).find((value) => value.startsWith("packet-tools-cookie="))?.split("=").slice(1).join("=");
    const authToken = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : undefined;
    const token = cookieToken ?? authToken;
    const user = token ? JwtAdapter.verifyToken<{ id: string; username: string; role: string }>(decodeURIComponent(token)) : null;
    if (!user?.id) return next(new Error("Autenticación requerida"));
    socket.data.user = user;
    next();
  });
}
