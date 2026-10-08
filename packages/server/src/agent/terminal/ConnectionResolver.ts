import { prismaClient } from "@/prisma/lib/PrismaClient";
import type { Prisma } from "@/prisma/generated/client";
import {
  buildTerminalFingerprint,
  terminalSessionHub,
} from "@/sockets/TerminalSessionHub";

export interface ConnectionDevice {
  id: string;
  name: string;
  protocol: string | null;
  typeDevice: string | null;
  host: string | null;
  port: number | null;
  serialPort: string | null;
  serialBaudrate: number | null;
}

export interface ConnectionContext {
  id: string;
  name: string;
  protocol: string | null;
  typeDevice: string | null;
  host: string | null;
  hasLiveSession: boolean;
  sessionId: string | null;
  prompt: string | null;
  lastLines: string[];
  alive: boolean;
}

export interface ResolvedConnectionTarget {
  device: ConnectionDevice;
  fingerprint: string | null;
  sessionId: string | null;
  graphProvider: string;
  connection: ConnectionContext;
}

const CAMPOS_DISPOSITIVO = {
  id: true,
  name: true,
  protocol: true,
  typeDevice: true,
  host: true,
  port: true,
  serialPort: true,
  serialBaudrate: true,
} satisfies Prisma.DeviceProvidersSelect;

export function deriveGraphProvider(
  protocol: string | null | undefined,
  typeDevice: string | null | undefined,
): string {
  const proto = String(protocol ?? "").trim().toUpperCase();
  if (proto === "TELNET") return "telnet";
  if (proto === "SSH") return "ssh";
  if (proto === "SERIAL") return "serial";
  if (proto === "SIMULATION") {
    const tipo = String(typeDevice ?? "").trim().toUpperCase();
    if (tipo === "PACKET_TRACER") return "cisco_packet_tracer";
    if (tipo === "GNS3") return "gns3";
  }
  return "default";
}

export async function findDeviceByConnectionId(
  connectionId: string,
): Promise<ConnectionDevice | null> {
  const id = String(connectionId ?? "").trim();
  if (!id) return null;

  const porId = await prismaClient.deviceProviders.findUnique({
    where: { id },
    select: CAMPOS_DISPOSITIVO,
  });
  if (porId) return porId;

  return prismaClient.deviceProviders.findFirst({
    where: { name: id },
    select: CAMPOS_DISPOSITIVO,
  });
}

export async function buildConnectionTarget(
  userId: string,
  device: ConnectionDevice,
): Promise<ResolvedConnectionTarget> {
  const fingerprint = buildTerminalFingerprint({
    protocol: device.protocol,
    host: device.host,
    port: device.port,
    serialPort: device.serialPort,
    baudRate: device.serialBaudrate,
  });

  const match = terminalSessionHub.findMatch(userId, device.id, fingerprint);
  const snapshot = match
    ? terminalSessionHub.getSnapshotForUser(userId, match.socketId)
    : null;
  const alive = snapshot?.alive === true;
  const sessionId = snapshot && snapshot.alive ? snapshot.sessionId : null;
  const lastLines =
    snapshot && snapshot.alive ? snapshot.lastLines.slice(-15) : [];

  return {
    device,
    fingerprint,
    sessionId,
    graphProvider: deriveGraphProvider(device.protocol, device.typeDevice),
    connection: {
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      typeDevice: device.typeDevice,
      host: device.host,
      hasLiveSession: alive,
      sessionId,
      prompt: snapshot && snapshot.alive ? (snapshot.prompt ?? null) : null,
      lastLines,
      alive,
    },
  };
}
