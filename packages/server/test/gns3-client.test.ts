

import { createServer, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Gns3Client } from "@/client/Gns3Client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { requestContext } from "@/utils/RequestContext";
import { adminBearer, publicApi } from "./helpers";

interface MockGns3 {
  url: string;
  paths: string[];
  authHeaders: Array<string | undefined>;
  server: Server;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("No se pudo obtener el puerto efímero del mock GNS3"));
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}


async function startMock(
  options: { requireAuth?: boolean; username?: string; password?: string } = {},
): Promise<MockGns3> {
  const mock: MockGns3 = {
    url: "",
    paths: [],
    authHeaders: [],
    server: createServer(),
  };

  const expectedAuth = options.requireAuth
    ? "Basic " + Buffer.from(`${options.username}:${options.password}`).toString("base64")
    : null;

  mock.server.on("request", (req, res: ServerResponse) => {
    mock.paths.push(req.url ?? "");
    mock.authHeaders.push(req.headers.authorization);

    if (expectedAuth && req.headers.authorization !== expectedAuth) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Unauthorized" }));
      return;
    }

    if (req.url === "/v2/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "9.9.9" }));
      return;
    }

    if (req.url === "/v2/projects") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ project_id: "p1", name: "lab" }]));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Not found" }));
  });

  const port = await listen(mock.server);
  mock.url = `http://127.0.0.1:${port}`;
  return mock;
}

const runId = Date.now();
const gns3ProviderName = `vitest_gns3_${runId}`;

let authMock: MockGns3;
let openMock: MockGns3;
let closedPort = 0;
let gns3ProviderId = "";
let packetTracerProviderId = "";

beforeAll(async () => {
  authMock = await startMock({ requireAuth: true, username: "u", password: "p" });
  openMock = await startMock();


  const closed = createServer();
  closedPort = await listen(closed);
  await closeServer(closed);

  const gns3Provider = await prismaClient.deviceProviders.create({
    data: {
      name: gns3ProviderName,
      typeDevice: "GNS3",
      protocol: "SIMULATION",
      host: authMock.url,
      username: "u",
      password: "p",
    },
  });
  gns3ProviderId = gns3Provider.id;

  const packetTracerProvider = await prismaClient.deviceProviders.create({
    data: {
      name: `vitest_gns3_pt_${runId}`,
      typeDevice: "PACKET_TRACER",
      protocol: "SIMULATION",
      host: "http://127.0.0.1:1",
    },
  });
  packetTracerProviderId = packetTracerProvider.id;
});

afterAll(async () => {
  await prismaClient.deviceProviders.deleteMany({
    where: { name: { startsWith: "vitest_gns3_" } },
  });
  await closeServer(authMock.server);
  await closeServer(openMock.server);
});

describe("Gns3Client", () => {
  it("autentica con Basic y devuelve la versión", async () => {
    const client = new Gns3Client(authMock.url, "u", "p");

    const result = await client.testConnection();

    expect(result).toEqual({ ok: true, status: 200, version: "9.9.9" });
    expect(authMock.authHeaders.at(-1)).toBe(
      "Basic " + Buffer.from("u:p").toString("base64"),
    );
  });

  it("con credenciales inválidas devuelve 401 sin lanzar", async () => {
    const client = new Gns3Client(authMock.url, "u", "incorrecta");

    const result = await client.testConnection();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("Credenciales");
  });

  it("normaliza el host agregando /v2 una sola vez", async () => {
    const sinV2 = new Gns3Client(authMock.url, "u", "p");
    const conV2 = new Gns3Client(`${authMock.url}/v2`, "u", "p");
    const withBarraFinal = new Gns3Client(`${authMock.url}/v2/`, "u", "p");

    expect(sinV2.info.baseUrl).toBe(`${authMock.url}/v2`);
    expect(await sinV2.getVersion()).toEqual({ version: "9.9.9" });
    expect((await conV2.getVersion()).version).toBe("9.9.9");
    expect((await withBarraFinal.getVersion()).version).toBe("9.9.9");

    const prompts = authMock.paths.filter((path) => path === "/v2/version");
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    expect(authMock.paths).not.toContain("/v2/v2/version");
  });

  it("sin credenciales no envía la cabecera Authorization", async () => {
    const client = new Gns3Client(openMock.url);
    expect(client.info.hasCredentials).toBe(false);

    const projects = await client.getProjects();
    expect(projects).toEqual([{ project_id: "p1", name: "lab" }]);

    const result = await client.testConnection();
    expect(result.ok).toBe(true);

    expect(openMock.authHeaders.at(-1)).toBeUndefined();
    expect(openMock.authHeaders.every((header) => header === undefined)).toBe(true);
  });

  it("nunca lanza contra un servidor inalcanzable", async () => {
    const client = new Gns3Client(`http://127.0.0.1:${closedPort}`);

    const result = await client.testConnection(1500);

    expect(result.ok).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.error).toMatch(/No se pudo conectar|Tiempo de espera/);
  });

  describe("resolución desde la base de datos y el contexto del turno", () => {
    it("fromDatabase carga nombre, host normalizado y credenciales", async () => {
      const client = await Gns3Client.fromDatabase(gns3ProviderId);

      expect(client.info.providerId).toBe(gns3ProviderId);
      expect(client.info.name).toBe(gns3ProviderName);
      expect(client.info.baseUrl).toBe(`${authMock.url}/v2`);
      expect(client.info.hasCredentials).toBe(true);
      expect(await client.getProjects()).toEqual([{ project_id: "p1", name: "lab" }]);
    });

    it("forRequest prioriza argumento y contexto, con fallback al primer GNS3", async () => {
      const porArgumento = await Gns3Client.forRequest(gns3ProviderId);
      expect(porArgumento.info.providerId).toBe(gns3ProviderId);

      await requestContext.run(
        {
          id: "u-test",
          username: "tester",
          role: "ADMIN",
          connectionProviderId: gns3ProviderId,
        },
        async () => {
          const porContexto = await Gns3Client.forRequest();
          expect(porContexto.info.providerId).toBe(gns3ProviderId);
        },
      );


      const fallback = await Gns3Client.forRequest(packetTracerProviderId);
      expect(fallback.info.providerId).toBe(gns3ProviderId);


      const porBase = await Gns3Client.forRequest();
      expect(porBase.info.providerId).toBe(gns3ProviderId);
    });
  });
});

describe("POST /api/devices/test", () => {
  it("prueba la conexión de un GNS3 guardado como ADMIN", async () => {
    const bearer = await adminBearer();

    const ok = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ providerId: gns3ProviderId });

    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.message).toContain("9.9.9");
    expect(ok.body.data).toMatchObject({
      typeDevice: "GNS3",
      protocol: "SIMULATION",
      status: 200,
      version: "9.9.9",
    });
    expect(typeof ok.body.data.latencyMs).toBe("number");

    const bad = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ providerId: gns3ProviderId, password: "mala" });

    expect(bad.status).toBe(200);
    expect(bad.body.success).toBe(false);
    expect(bad.body.message).toContain("Credenciales");
    expect(bad.body.data.status).toBe(401);
  });

  it("rechaza tipos de dispositivo no soportados y hosts GNS3 vacíos", async () => {
    const bearer = await adminBearer();


    const tipoDesconocido = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ typeDevice: "NO_SOPORTADO" });
    expect(tipoDesconocido.status).toBe(400);

    const sinHost = await publicApi()
      .post("/api/devices/test")
      .set("Authorization", bearer)
      .send({ typeDevice: "GNS3" });
    expect(sinHost.status).toBe(400);
  });
});
