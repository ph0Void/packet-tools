

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Gns3Client } from "@/client/Gns3Client";

interface MockRequest {
  method: string;
  url: string;
  body: Buffer;
  contentType?: string;
}

interface MockGns3 {
  url: string;
  requests: MockRequest[];
  server: Server;
}


const PCAP_BYTES = Buffer.from([1, 2, 3]);
const EXPORT_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);

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
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const url = req.url ?? "";
      const method = req.method ?? "";
      mock.requests.push({
        method,
        url,
        body: Buffer.concat(chunks),
        contentType: req.headers["content-type"],
      });

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
      const binary = (bytes: Buffer, contentType: string) => {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": String(bytes.length),
        });
        res.end(bytes);
      };

      
      if (method === "GET" && url === "/v2/templates") {
        return json(200, [{ template_id: "t1", name: "R1" }]);
      }
      if (method === "POST" && url === "/v2/templates") {
        return json(201, { template_id: "t9", name: "Nueva" });
      }
      if (method === "GET" && url === "/v2/templates/t1") {
        return json(200, { template_id: "t1", name: "R1" });
      }
      if (method === "PUT" && url === "/v2/templates/t1") {
        return json(200, { template_id: "t1", name: "R1 editado" });
      }
      if (method === "DELETE" && url === "/v2/templates/t1") return noContent();
      if (method === "POST" && url === "/v2/templates/t1/duplicate") {
        return json(201, { template_id: "t2", name: "Copia de R1" });
      }

      
      if (method === "GET" && url === "/v2/projects/p1/links/l1") {
        return json(200, { link_id: "l1", link_type: "ethernet" });
      }
      if (method === "POST" && url === "/v2/projects/p1/links/l1/start_capture") {
        return json(201, { link_id: "l1", capturing: true });
      }
      if (method === "POST" && url === "/v2/projects/p1/links/l1/stop_capture") {
        return json(200, { link_id: "l1", capturing: false });
      }
      if (method === "GET" && url === "/v2/projects/p1/links/l1/pcap") {
        return binary(PCAP_BYTES, "application/vnd.tcpdump.pcap");
      }

      
      if (method === "GET" && url === "/v2/projects/p1/export") {
        return binary(EXPORT_BYTES, "application/octet-stream");
      }
      if (method === "POST" && url === "/v2/projects/p1/import") {
        return json(200, { project_id: "p1", name: "importado" });
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

describe("Gns3Client — Fase 3: plantillas", () => {
  it("getTemplates lista con GET", async () => {
    const templates = await client.getTemplates();

    expect(templates).toEqual([{ template_id: "t1", name: "R1" }]);
    expect(lastRequest(mock)).toMatchObject({ method: "GET", url: "/v2/templates" });
  });

  it("getTemplate pega a /templates/{id}", async () => {
    const template = await client.getTemplate("t1");

    expect(template).toEqual({ template_id: "t1", name: "R1" });
    expect(lastRequest(mock)).toMatchObject({ method: "GET", url: "/v2/templates/t1" });
  });

  it("createTemplate hace POST con el cuerpo JSON", async () => {
    const data = { name: "Nueva", template_type: "dynamips" };
    const template = await client.createTemplate(data);

    expect(template).toEqual({ template_id: "t9", name: "Nueva" });
    const prompt = lastRequest(mock);
    expect(prompt).toMatchObject({ method: "POST", url: "/v2/templates" });
    expect(prompt.body.toString("utf8")).toBe(JSON.stringify(data));
  });

  it("updateTemplate hace PUT con el cuerpo JSON", async () => {
    const data = { name: "R1 editado" };
    const template = await client.updateTemplate("t1", data);

    expect(template).toEqual({ template_id: "t1", name: "R1 editado" });
    const prompt = lastRequest(mock);
    expect(prompt).toMatchObject({ method: "PUT", url: "/v2/templates/t1" });
    expect(prompt.body.toString("utf8")).toBe(JSON.stringify(data));
  });

  it("deleteTemplate hace DELETE y devuelve null (204)", async () => {
    const result = await client.deleteTemplate("t1");

    expect(result).toBeNull();
    expect(lastRequest(mock)).toMatchObject({ method: "DELETE", url: "/v2/templates/t1" });
  });

  it("duplicateTemplate hace POST a /duplicate", async () => {
    const template = await client.duplicateTemplate("t1");

    expect(template).toEqual({ template_id: "t2", name: "Copia de R1" });
    expect(lastRequest(mock)).toMatchObject({
      method: "POST",
      url: "/v2/templates/t1/duplicate",
    });
  });

  it("con credenciales inválidas lanza un error de credenciales", async () => {
    const malCliente = new Gns3Client(mock.url, "u", "mala");

    await expect(malCliente.getTemplate("t1")).rejects.toThrow(/Credenciales/i);
    expect(lastRequest(mock)).toMatchObject({ method: "GET", url: "/v2/templates/t1" });
  });
});

describe("Gns3Client — Fase 3: enlaces y captura", () => {
  it("getLink pega a /projects/{pid}/links/{lid}", async () => {
    const link = await client.getLink("p1", "l1");

    expect(link).toEqual({ link_id: "l1", link_type: "ethernet" });
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/links/l1",
    });
  });

  it("startLinkCapture hace POST a /start_capture", async () => {
    const result = await client.startLinkCapture("p1", "l1");

    expect(result).toEqual({ link_id: "l1", capturing: true });
    expect(lastRequest(mock)).toMatchObject({
      method: "POST",
      url: "/v2/projects/p1/links/l1/start_capture",
    });
  });

  it("stopLinkCapture hace POST a /stop_capture", async () => {
    const result = await client.stopLinkCapture("p1", "l1");

    expect(result).toEqual({ link_id: "l1", capturing: false });
    expect(lastRequest(mock)).toMatchObject({
      method: "POST",
      url: "/v2/projects/p1/links/l1/stop_capture",
    });
  });

  it("downloadLinkPcap descarga la respuesta binaria como Buffer", async () => {
    const pcap = await client.downloadLinkPcap("p1", "l1");

    expect(Buffer.isBuffer(pcap)).toBe(true);
    expect(pcap.equals(PCAP_BYTES)).toBe(true);
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/links/l1/pcap",
    });
  });
});

describe("Gns3Client — Fase 3: export/import de proyectos", () => {
  it("exportProject descarga el .gns3project como Buffer", async () => {
    const archive = await client.exportProject("p1");

    expect(Buffer.isBuffer(archive)).toBe(true);
    expect(archive.equals(EXPORT_BYTES)).toBe(true);
    expect(lastRequest(mock)).toMatchObject({
      method: "GET",
      url: "/v2/projects/p1/export",
    });
  });

  it("importProject envía el Buffer tal cual como octet-stream", async () => {
    const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x01, 0x02]);
    const result = await client.importProject("p1", archive);

    expect(result).toEqual({ project_id: "p1", name: "importado" });
    const prompt = lastRequest(mock);
    expect(prompt).toMatchObject({ method: "POST", url: "/v2/projects/p1/import" });
    expect(prompt.contentType).toContain("application/octet-stream");
    expect(prompt.body.length).toBe(archive.length);
    expect(prompt.body.equals(archive)).toBe(true);
  });
});
