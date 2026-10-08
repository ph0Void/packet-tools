import type { Server, Socket } from "socket.io";
import { Logger } from "@/utils/Logger";
import { simulationBridge } from "./SimulationBridge";

interface LlamadaPendiente {

  socketOrigen: string;

  expiraEn: number;
}

const VIGENCIA_LLAMADA_MS = 300_000;

const MAX_LLAMADAS_PENDIENTES = 512;

const llamadasPendientes = new Map<string, LlamadaPendiente>();

function esExtensionDePacketTracer(socket: Socket): boolean {
  const extension = simulationBridge.current;
  return extension !== null && extension.id === socket.id;
}

function podarLlamadas(ahora: number): void {
  for (const [id, llamada] of llamadasPendientes) {
    if (llamada.expiraEn > ahora) continue;
    llamadasPendientes.delete(id);
  }
  while (llamadasPendientes.size >= MAX_LLAMADAS_PENDIENTES) {
    const masAntigua = llamadasPendientes.keys().next().value;
    if (masAntigua === undefined) break;
    llamadasPendientes.delete(masAntigua);
  }
}

function registrarLlamada(toolCallId: string, socketOrigen: string): boolean {
  const ahora = Date.now();
  podarLlamadas(ahora);
  if (llamadasPendientes.has(toolCallId)) return false;
  llamadasPendientes.set(toolCallId, {
    socketOrigen,
    expiraEn: ahora + VIGENCIA_LLAMADA_MS,
  });
  return true;
}

function tomarLlamada(toolCallId: string): LlamadaPendiente | null {
  const llamada = llamadasPendientes.get(toolCallId);
  if (!llamada) return null;
  llamadasPendientes.delete(toolCallId);
  return llamada.expiraEn <= Date.now() ? null : llamada;
}

function olvidarLlamadasDe(socketId: string): void {
  for (const [id, llamada] of llamadasPendientes) {
    if (llamada.socketOrigen === socketId) llamadasPendientes.delete(id);
  }
}

function puedeLlamarTools(socket: Socket): boolean {
  const clientType = String(socket.handshake?.query?.clientType ?? "");
  if (clientType === "backend-agent") return true;
  const role = String((socket.data as any)?.user?.role ?? "").toUpperCase();
  return role === "ADMIN" || role === "STAFF";
}

export function registerSimulationSocket(io: Server) {
  io.on("connection", (socket) => {
    const clientType = String(socket.handshake.query.clientType ?? "");
    const userAgent = String(socket.handshake.headers["user-agent"] ?? "");
    const isPacketTracer = clientType === "packet-tracer" || userAgent.includes("Qt");
    Logger.info({
      message: `[SIMULATION_SOCKET] Nueva conexión ${isPacketTracer ? "EXTENSION PACKET TRACER" : "cliente"} [ID: ${socket.id}]`,
      data: { clientType, userAgent },
    });
    if (isPacketTracer) simulationBridge.attach(socket);
    socket.on("tool_call", (data: { tool_call_id: string; tool_name: string; tool_input?: Record<string, unknown> }) => {
      if (!puedeLlamarTools(socket)) {
        Logger.warning({
          message: `[SIMULATION_SOCKET] tool_call desde un socket no autorizado; se descarta [ID: ${socket.id}]`,
          data: { toolName: data?.tool_name },
        });
        return;
      }
      const toolCallId = typeof data?.tool_call_id === "string" ? data.tool_call_id : "";
      if (!toolCallId) {
        Logger.warning({
          message: `[SIMULATION_SOCKET] tool_call sin tool_call_id; se descarta [ID: ${socket.id}]`,
          data: { toolName: data?.tool_name },
        });
        return;
      }
      if (!registrarLlamada(toolCallId, socket.id)) {
        Logger.warning({
          message: `[SIMULATION_SOCKET] tool_call con id ya pendiente; se descarta [ID: ${socket.id}]`,
          data: { toolCallId },
        });
        return;
      }
      const packetTracer = simulationBridge.current;
      if (packetTracer && packetTracer.id !== socket.id) {
        packetTracer.emit("tool_call", data);
        return;
      }

      llamadasPendientes.delete(toolCallId);
      socket.emit("tool_result", { tool_call_id: toolCallId, result: { success: false, error: "Packet Tracer no está conectado" } });
    });
    socket.on("tool_result", (data: { tool_call_id: string; result: unknown }) => {
      const toolCallId = typeof data?.tool_call_id === "string" ? data.tool_call_id : "";
      if (!toolCallId) {
        Logger.warning({
          message: `[SIMULATION_SOCKET] tool_result sin tool_call_id; se descarta [ID: ${socket.id}]`,
        });
        return;
      }

      if (!esExtensionDePacketTracer(socket)) {
        Logger.warning({
          message: `[SIMULATION_SOCKET] tool_result desde un socket que no es la extensión; se ignora [ID: ${socket.id}]`,
          data: { toolCallId },
        });
        return;
      }

      const llamada = tomarLlamada(toolCallId);
      if (!llamada) {
        Logger.info({
          message: `[SIMULATION_SOCKET] tool_result huérfano, repetido o caducado; se descarta`,
          data: { toolCallId },
        });
        return;
      }

      const destino = io.sockets.sockets.get(llamada.socketOrigen);
      if (!destino) {
        Logger.info({
          message: `[SIMULATION_SOCKET] tool_result sin destino (el solicitante ya no está conectado); se descarta`,
          data: { toolCallId },
        });
        return;
      }
      destino.emit("tool_result", data);
    });
    socket.on("disconnect", () => {
      Logger.info({ message: `[SIMULATION_SOCKET] Desconexión [ID: ${socket.id}]` });
      simulationBridge.detach(socket.id);
      olvidarLlamadasDe(socket.id);
    });
  });
}
