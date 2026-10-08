

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildConnectionTarget,
  deriveGraphProvider,
  findDeviceByConnectionId,
  type ConnectionDevice,
} from "@/agent/terminal/ConnectionResolver";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  terminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";

const runId = Date.now();
const nameA = `vitest_conn_${runId}_a`;
const nameB = `vitest_conn_${runId}_b`;
let deviceAId = "";
let deviceBId = "";


function sessionRegistration(
  overrides: Partial<TerminalSessionRegistration> = {},
): TerminalSessionRegistration {
  return {
    socketId: "s-a",
    userId: "u1",
    providerId: "p-a",
    protocol: "SSH",
    deviceName: "R1",
    fingerprint: null,
    write: () => {},
    isAlive: () => true,
    ...overrides,
  };
}


function connectionDevice(
  overrides: Partial<ConnectionDevice> = {},
): ConnectionDevice {
  return {
    id: "p-a",
    name: "R1",
    protocol: "SSH",
    typeDevice: "PACKET_TRACER",
    host: "10.0.0.1",
    port: 22,
    serialPort: null,
    serialBaudrate: null,
    ...overrides,
  };
}

describe("deriveGraphProvider", () => {
  it("mapea los 6 proveedores derivados del protocolo/tipo", () => {
    expect(deriveGraphProvider("TELNET", null)).toBe("telnet");
    expect(deriveGraphProvider("SSH", null)).toBe("ssh");
    expect(deriveGraphProvider("SERIAL", null)).toBe("serial");
    expect(deriveGraphProvider("SIMULATION", "PACKET_TRACER")).toBe(
      "cisco_packet_tracer",
    );
    expect(deriveGraphProvider("SIMULATION", "GNS3")).toBe("gns3");
    expect(deriveGraphProvider("HTTP", null)).toBe("default");
  });

  it("normaliza mayúsculas y espacios antes de mapear", () => {
    expect(deriveGraphProvider(" ssh ", null)).toBe("ssh");
    expect(deriveGraphProvider("telnet", null)).toBe("telnet");
    expect(deriveGraphProvider("serial", null)).toBe("serial");
    expect(deriveGraphProvider("Simulation", " packet_tracer ")).toBe(
      "cisco_packet_tracer",
    );
  });

  it("devuelve default ante valores nulos, vacíos o desconocidos", () => {
    expect(deriveGraphProvider(null, null)).toBe("default");
    expect(deriveGraphProvider(undefined, undefined)).toBe("default");
    expect(deriveGraphProvider("", "")).toBe("default");
    expect(deriveGraphProvider("SIMULATION", null)).toBe("default");
    expect(deriveGraphProvider("SIMULATION", "CISCO")).toBe("default");
  });
});

describe("findDeviceByConnectionId", () => {
  beforeAll(async () => {
    const a = await prismaClient.deviceProviders.create({
      data: {
        name: nameA,
        protocol: "SSH",
        host: "10.0.0.1",
        port: 22,
      },
    });
    const b = await prismaClient.deviceProviders.create({
      data: {
        name: nameB,
        protocol: "TELNET",
        host: "10.0.0.2",
        port: 23,
      },
    });
    deviceAId = a.id;
    deviceBId = b.id;
  });

  afterAll(async () => {
    await prismaClient.deviceProviders.deleteMany({
      where: { name: { startsWith: "vitest_conn_" } },
    });
  });

  it("encuentra el dispositivo por id", async () => {
    const encontrado = await findDeviceByConnectionId(deviceAId);

    expect(encontrado?.id).toBe(deviceAId);
    expect(encontrado?.name).toBe(nameA);
    expect(encontrado?.protocol).toBe("SSH");
    expect(encontrado?.host).toBe("10.0.0.1");
    expect(encontrado?.port).toBe(22);
  });

  it("hace fallback por nombre exacto cuando no hay id con ese valor", async () => {
    const encontrado = await findDeviceByConnectionId(nameB);

    expect(encontrado?.id).toBe(deviceBId);
    expect(encontrado?.name).toBe(nameB);
    expect(encontrado?.protocol).toBe("TELNET");
    expect(encontrado?.host).toBe("10.0.0.2");
    expect(encontrado?.port).toBe(23);
  });

  it("devuelve null para id/nombre inexistente o vacío", async () => {
    expect(await findDeviceByConnectionId("no-existe-xyz")).toBeNull();
    expect(await findDeviceByConnectionId("")).toBeNull();
    expect(await findDeviceByConnectionId("   ")).toBeNull();
    expect(
      await findDeviceByConnectionId(null as unknown as string),
    ).toBeNull();
  });
});

describe("buildConnectionTarget", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("resuelve la sesión viva del dispositivo y la expone en el contexto", async () => {
    const device = connectionDevice();
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s-a", providerId: device.id }),
    );
    terminalSessionHub.recordData("s-a", "\r\nR1# show version\r\nR1# ");

    const target = await buildConnectionTarget("u1", device);

    expect(target.device.id).toBe(device.id);
    expect(target.fingerprint).toBe("SSH:10.0.0.1:22");
    expect(target.sessionId).toBe("s-a");
    expect(target.graphProvider).toBe("ssh");
    expect(target.connection.sessionId).toBe("s-a");
    expect(target.connection.alive).toBe(true);
    expect(target.connection.hasLiveSession).toBe(true);
    expect(Array.isArray(target.connection.lastLines)).toBe(true);
    expect(target.connection.lastLines.join("\n")).toContain("show version");
  });

  it("sin sesión viva del dispositivo no cae en la consola de otro", async () => {
    const deviceA = connectionDevice();
    const deviceB = connectionDevice({
      id: "p-b",
      name: "SW1",
      protocol: "TELNET",
      host: "10.0.0.2",
      port: 23,
    });
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s-a", providerId: deviceA.id }),
    );

    const target = await buildConnectionTarget("u1", deviceB);

    expect(target.sessionId).toBeNull();
    expect(target.connection.sessionId).toBeNull();
    expect(target.connection.alive).toBe(false);
    expect(target.connection.hasLiveSession).toBe(false);
    expect(target.connection.lastLines).toEqual([]);
    expect(target.graphProvider).toBe("telnet");
    expect(target.fingerprint).toBe("TELNET:10.0.0.2:23");
  });

  it("con sesión viva de cada dispositivo cada target apunta a la suya", async () => {
    const deviceA = connectionDevice();
    const deviceB = connectionDevice({
      id: "p-b",
      name: "SW1",
      protocol: "TELNET",
      host: "10.0.0.2",
      port: 23,
    });
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s-a", providerId: deviceA.id }),
    );
    terminalSessionHub.register(
      sessionRegistration({
        socketId: "s-b",
        providerId: deviceB.id,
        protocol: "TELNET",
        deviceName: "SW1",
      }),
    );

    const targetA = await buildConnectionTarget("u1", deviceA);
    const targetB = await buildConnectionTarget("u1", deviceB);

    expect(targetA.sessionId).toBe("s-a");
    expect(targetA.connection.alive).toBe(true);
    expect(targetB.sessionId).toBe("s-b");
    expect(targetB.connection.alive).toBe(true);
    expect(targetB.graphProvider).toBe("telnet");
  });
});
