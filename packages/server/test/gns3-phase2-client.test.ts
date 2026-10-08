

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Gns3Client } from "@/client/Gns3Client";

interface MockRequest {
  method: string;
  url: string;
  body: string;
}

interface MockGns3 {
  url: string;
  requests: MockRequest[];
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


async function startMock(): Promise<MockGns3> {
  const mock: MockGns3 = { url: "", requests: [], server: createServer() };
  const expectedAuth = "Basic " + Buffer.from("u:p").toString("base64");

  mock.server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      const method = req.method ?? "";
      mock.requests.push({ method, url, body: Buffer.concat(chunks).toString("utf8") });

      if (req.headers.authorization !== expectedAuth) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Unauthorized" }));
        return;
      }

      const json = (status: number, data: any) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      const noContent = () => {
        res.writeHead(204);
        res.end();
      };
      const text = (body: string) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(body);
      };

      
      if (method === "GET" && url === "/v2/projects/p1/snapshots") {
        return json(200, [{ snapshot_id: "s1", name: "snap1" }]);
      }
      if (method === "POST" && url === "/v2/projects/p1/snapshots") {
        return json(201, { snapshot_id: "s2", name: "nueva" });
      }
      if (method === "POST" && url === "/v2/projects/p1/snapshots/s1/restore") return noContent();
      if (method === "DELETE" && url === "/v2/projects/p1/snapshots/s1") return noContent();

      
      if (method === "GET" && url === "/v2/projects/p1/stats") {
        return json(200, { drawings: 1, links: 2, nodes: 3, snapshots: 4 });
      }

      
      if (method === "GET" && url === "/v2/compute/projects/p1/files") {
        return json(200, [
          { path: "project-files\\dynamips\\n1\\dynamips_i1_log.txt", is_dir: false },
          { path: "project-files\\dynamips\\n1\\configs", is_dir: true },
          {
            path: "project-files\\dynamips\\n1\\configs\\i1_startup-config.cfg",
            is_dir: false,
          },
          
          { path: "project-files/dynamips/n1/dynamips_i1_log.txt", is_dir: false },
          { path: "project-files\\dynamips\\n2\\dynamips_i2_log.txt", is_dir: false },
          { path: "project-files\\builtin\\b1\\ubridge.log", is_dir: false },
        ]);
      }
      if (method === "GET" && url === "/v2/projects/p1/nodes/n1/files/log.txt") {
        return text("linea1\nlinea2");
      }
      if (
        method === "GET" &&
        url === "/v2/projects/p1/nodes/n1/files/configs/startup%20config.cfg"
      ) {
        return text("hostname r1");
      }

      
      if (method === "GET" && url === "/v2/computes") {
        return json(200, [
          {
            compute_id: "local",
            name: "Local",
            connected: true,
            cpu_usage_percent: 5,
            memory_usage_percent: 10,
          },
        ]);
      }
      if (method === "GET" && url === "/v2/computes/local") {
        return json(200, {
          compute_id: "local",
          name: "Local",
          connected: true,
          cpu_usage_percent: 5,
          memory_usage_percent: 10,
        });
      }

      json(404, { message: "Not found" });
    });
  });

  const port = await listen(mock.server);
  mock.url = `http://127.0.0.1:${port}`;
  return mock;
}

function lastRequest(mock: MockGns3): MockRequest {
  return mock.requests[mock.requests.length - 1];
}

let mock: MockGns3;
let client: Gns3Client;

beforeAll(async () => {
  mock = await startMock();
  client = new Gns3Client(mock.url, "u", "p");
});

afterAll(async () => {
  await closeServer(mock.server);
});

describe("Gns3Client — Fase 2", () => {
  it("getSnapshots lista con GET y devuelve los snapshots", async () => {
    const snapshots = await client.getSnapshots("p1");

    expect(snapshots).toEqual([{ snapshot_id: "s1", name: "snap1" }]);
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/snapshots",
    });
  });

  it("createSnapshot hace POST con el nombre indicado", async () => {
    const snapshot = await client.createSnapshot("p1", "nueva");

    expect(snapshot).toEqual({ snapshot_id: "s2", name: "nueva" });
    expect(lastRequest(mock)).toMatchObject({
      method: "POST",
      url: "/v2/projects/p1/snapshots",
      body: JSON.stringify({ name: "nueva" }),
    });


    await client.createSnapshot("p1");
    expect(lastRequest(mock).body).toBe("{}");
  });

  it("restoreSnapshot hace POST al endpoint de restore y devuelve null (204)", async () => {
    const result = await client.restoreSnapshot("p1", "s1");

    expect(result).toBeNull();
    expect(lastRequest(mock)).toMatchObject({
      method: "POST",
      url: "/v2/projects/p1/snapshots/s1/restore",
    });
  });

  it("deleteSnapshot hace DELETE y devuelve null (204)", async () => {
    const result = await client.deleteSnapshot("p1", "s1");

    expect(result).toBeNull();
    expect(lastRequest(mock)).toMatchObject({
      method: "DELETE",
      url: "/v2/projects/p1/snapshots/s1",
    });
  });

  it("getProjectStats consulta /stats y devuelve los contadores", async () => {
    const stats = await client.getProjectStats("p1");

    expect(stats).toEqual({ drawings: 1, links: 2, nodes: 3, snapshots: 4 });
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/stats",
    });
  });

  it("getNodeFiles lista los archivos del nodo vía el compute (normaliza '\\' y filtra)", async () => {
    const files = await client.getNodeFiles("p1", "n1");


    expect(files).toEqual([
      { name: "dynamips_i1_log.txt", path: "dynamips_i1_log.txt" },
      { name: "i1_startup-config.cfg", path: "configs/i1_startup-config.cfg" },
    ]);
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/compute/projects/p1/files",
    });
  });

  it("getNodeFiles cae al nodeName (case-insensitive) si el nodeId no coincide", async () => {
    const files = await client.getNodeFiles("p1", "n-inexistente", {
      nodeName: "N1",
    });

    expect(files).toEqual([
      { name: "dynamips_i1_log.txt", path: "dynamips_i1_log.txt" },
      { name: "i1_startup-config.cfg", path: "configs/i1_startup-config.cfg" },
    ]);
  });

  it("getNodeFiles propaga un error claro si el listado no está disponible", async () => {

    await expect(client.getNodeFiles("p2", "n1")).rejects.toThrow(
      "No se pudo listar los archivos del nodo en este servidor GNS3 (el compute debe ser local).",
    );
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/compute/projects/p2/files",
    });
  });

  it("readNodeFile devuelve el texto crudo sin parsear JSON", async () => {
    const content = await client.readNodeFile("p1", "n1", "log.txt");

    expect(typeof content).toBe("string");
    expect(content).toBe("linea1\nlinea2");
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/nodes/n1/files/log.txt",
    });
  });

  it("readNodeFile codifica cada segmento de la ruta", async () => {
    const content = await client.readNodeFile("p1", "n1", "configs/startup config.cfg");

    expect(content).toBe("hostname r1");
    expect(lastRequest(mock).url).toBe(
      "/v2/projects/p1/nodes/n1/files/configs/startup%20config.cfg",
    );
  });

  it("readNodeFile rechaza rutas con segmentos .. sin llamar al servidor", async () => {
    const promptsPrevias = mock.requests.length;

    await expect(client.readNodeFile("p1", "n1", "../../version")).rejects.toThrow(
      /no válida/i,
    );
    expect(mock.requests.length).toBe(promptsPrevias);
  });

  it("getComputes consulta /computes y devuelve la lista", async () => {
    const computes = await client.getComputes();

    expect(computes).toEqual([
      {
        compute_id: "local",
        name: "Local",
        connected: true,
        cpu_usage_percent: 5,
        memory_usage_percent: 10,
      },
    ]);
    expect(lastRequest(mock)).toMatchObject({ method: "GET", url: "/v2/computes" });
  });

  it("getCompute sin argumento consulta el compute local", async () => {
    const compute = await client.getCompute();

    expect(compute).toMatchObject({
      compute_id: "local",
      connected: true,
      cpu_usage_percent: 5,
      memory_usage_percent: 10,
    });
    expect(lastRequest(mock)).toMatchObject({ method: "GET", url: "/v2/computes/local" });
  });

  it("con credenciales inválidas lanza un error de credenciales", async () => {
    const malCliente = new Gns3Client(mock.url, "u", "mala");

    await expect(malCliente.getSnapshots("p1")).rejects.toThrow(/credenciales/i);
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/snapshots",
    });
  });
});
