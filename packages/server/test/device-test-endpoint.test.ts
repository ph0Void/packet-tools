

import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import {
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket as TcpSocket,
} from "node:net";
import { describe, expect, it } from "vitest";
import { simulationBridge } from "@/sockets/SimulationBridge";
import { adminBearer, publicApi } from "./helpers";

interface TcpMock {
  server: TcpServer;
  port: number;
  sockets: Set<TcpSocket>;
}


function startTcpMock(): Promise<TcpMock> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<TcpSocket>();
    const server = createTcpServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    const mock: TcpMock = { server, port: 0, sockets };
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        mock.port = address.port;
        resolve(mock);
      } else {
        reject(new Error("No se pudo obtener el puerto efímero del mock TCP."));
      }
    });
  });
}

function closeTcpMock(mock: TcpMock): Promise<void> {
  return new Promise((resolve) => {
    for (const socket of mock.sockets) socket.destroy();
    mock.server.close(() => resolve());
  });
}

interface Gns3Mock {
  server: HttpServer;
  url: string;
}


function startGns3Mock(): Promise<Gns3Mock> {
  return new Promise((resolve, reject) => {
    const expectedAuth = "Basic " + Buffer.from("u:p").toString("base64");
    const server = createHttpServer((req, res) => {
      if (req.url === "/v2/version" && req.headers.authorization === expectedAuth) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: "9.9.9" }));
        return;
      }
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Unauthorized" }));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve({ server, url: `http://127.0.0.1:${address.port}` });
      } else {
        reject(new Error("No se pudo obtener el puerto efímero del mock GNS3."));
      }
    });
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

describe("POST /api/devices/test multiconexión", () => {
  it("TELNET contra un servidor TCP efímero responde éxito", async () => {
    const bearer = await adminBearer();
    const mock = await startTcpMock();
    try {
      const response = await publicApi()
        .post("/api/devices/test")
        .set("Authorization", bearer)
        .send({
          typeDevice: "CISCO",
          protocol: "TELNET",
          host: "127.0.0.1",
          port: mock.port,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("Telnet");
      expect(response.body.data).toMatchObject({
        typeDevice: "CISCO",
        protocol: "TELNET",
        status: null,
        version: null,
      });
      expect(typeof response.body.data.latencyMs).toBe("number");
    } finally {
      await closeTcpMock(mock);
    }
  });

  it("TELNET contra un puerto cerrado responde error sin lanzar", async () => {
    const bearer = await adminBearer();
    const mock = await startTcpMock();
    const closedPort = mock.port;
    await closeTcpMock(mock);

    const response = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({
        typeDevice: "CISCO",
        protocol: "TELNET",
        host: "127.0.0.1",
        port: closedPort,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Telnet");
  });

  it("PACKET_TRACER refleja el estado de la extensión conectada", async () => {
    const bearer = await adminBearer();
    simulationBridge.clearForTests();
    try {
      const withoutExtension = await publicApi()
        .post("/api/devices/test")
        .set("Authorization", bearer)
        .send({ typeDevice: "PACKET_TRACER", protocol: "SIMULATION" });

      expect(withoutExtension.status).toBe(200);
      expect(withoutExtension.body.success).toBe(false);
      expect(withoutExtension.body.message).toContain("Packet Tracer");
      expect(withoutExtension.body.data).toMatchObject({
        typeDevice: "PACKET_TRACER",
        protocol: "SIMULATION",
        status: null,
        version: null,
        latencyMs: null,
      });

      simulationBridge.attach({ id: "test-pt", connected: true } as any);

      const withExtension = await publicApi()
        .post("/api/devices/test")
        .set("Authorization", bearer)
        .send({ typeDevice: "PACKET_TRACER", protocol: "SIMULATION" });

      expect(withExtension.status).toBe(200);
      expect(withExtension.body.success).toBe(true);
      expect(withExtension.body.message).toContain("Packet Tracer");
    } finally {
      simulationBridge.clearForTests();
    }
  });

  it("SERIAL con un puerto inexistente responde error sin lanzar", async () => {
    const bearer = await adminBearer();
    const serialPort =
      process.platform === "win32"
        ? "COM_DOES_NOT_EXIST_999"
        : "/dev/ttyDOESNOTEXIST999";

    const response = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({
        typeDevice: "CISCO",
        protocol: "SERIAL",
        serialPort,
        serialBaudrate: 9600,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("serial");
    expect(response.body.message).toContain(serialPort);
  });

  it("valida tipos desconocidos, providerId inexistente y SSH sin host", async () => {
    const bearer = await adminBearer();

    const kindUnknown = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ typeDevice: "TIPO_INEXISTENTE" });

    expect(kindUnknown.status).toBe(400);
    expect(kindUnknown.body.success).toBe(false);
    expect(kindUnknown.body.message).toContain("no soportado");

    const providerInexistente = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ providerId: "provider-inexistente-999" });

    expect(providerInexistente.status).toBe(404);

    const sshWithoutHost = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ typeDevice: "CISCO", protocol: "SSH" });

    expect(sshWithoutHost.status).toBe(400);
    expect(sshWithoutHost.body.success).toBe(false);
  });

  it("GNS3 contra un servidor mock con Basic responde éxito (regresión)", async () => {
    const bearer = await adminBearer();
    const mock = await startGns3Mock();
    try {
      const response = await publicApi()
        .post("/api/devices/test")
        .set("Authorization", bearer)
        .send({
          typeDevice: "GNS3",
          protocol: "SIMULATION",
          host: mock.url,
          username: "u",
          password: "p",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("9.9.9");
      expect(response.body.data).toMatchObject({
        typeDevice: "GNS3",
        protocol: "SIMULATION",
        status: 200,
        version: "9.9.9",
      });
      expect(typeof response.body.data.latencyMs).toBe("number");
    } finally {
      await closeHttpServer(mock.server);
    }
  });
});
