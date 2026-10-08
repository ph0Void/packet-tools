

import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GNS3_TOOLS_ADMIN } from "@/agent/gns3/Tool";


interface InvokableTool {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<string>;
}


function toolByName(name: string): InvokableTool {
  const encontrada = GNS3_TOOLS_ADMIN.find((candidate) => candidate.name === name);
  if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
  return encontrada as unknown as InvokableTool;
}

describe("testGns3Connectivity", () => {
  let serverTcp: net.Server;
  let connections: Set<net.Socket>;
  let portOpen: number;
  let portClosed: number;

  beforeAll(async () => {

    connections = new Set<net.Socket>();
    serverTcp = net.createServer((socket) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
    });
    await new Promise<void>((resolve) =>
      serverTcp.listen(0, "127.0.0.1", resolve),
    );
    portOpen = (serverTcp.address() as net.AddressInfo).port;


    const serverTemporal = net.createServer();
    await new Promise<void>((resolve) =>
      serverTemporal.listen(0, "127.0.0.1", resolve),
    );
    portClosed = (serverTemporal.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) =>
      serverTemporal.close((error) => (error ? reject(error) : resolve())),
    );
  });

  afterAll(async () => {
    if (!serverTcp) return;

    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => serverTcp.close(() => resolve()));
  });

  it("detecta un puerto abierto y devuelve la latencia medida", async () => {
    const output = JSON.parse(
      await toolByName("testGns3Connectivity").invoke({
        host: "127.0.0.1",
        port: portOpen,
        timeoutMs: 1000,
        label: "R1",
      }),
    );

    expect(output.reachable).toBe(true);
    expect(output.host).toBe("127.0.0.1");
    expect(output.port).toBe(portOpen);
    expect(output.label).toBe("R1");
    expect(typeof output.latencyMs).toBe("number");
    expect(output.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("detecta un puerto cerrado sin lanzar y reporta el error", async () => {
    const output = JSON.parse(
      await toolByName("testGns3Connectivity").invoke({
        host: "127.0.0.1",
        port: portClosed,
        timeoutMs: 1000,
      }),
    );

    expect(output.reachable).toBe(false);
    expect(output.host).toBe("127.0.0.1");
    expect(output.port).toBe(portClosed);
    expect(typeof output.error).toBe("string");
    expect(output.error.length).toBeGreaterThan(0);
  });
});
