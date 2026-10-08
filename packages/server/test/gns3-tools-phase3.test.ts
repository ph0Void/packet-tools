

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const mockState = vi.hoisted(() => ({
  plantillas: [] as any[],
  nodes: [] as any[],
  enlaces: [] as any[],
  enlaceDetail: {} as any,
  proyecto: { project_id: "p-1", name: "lab-redes" } as any,
  duplicateCalls: [] as string[],
  updateTemplateCalls: [] as Array<{ templateId: string; data: any }>,
  deleteTemplateCalls: [] as string[],
  getLinkCalls: [] as Array<{ projectId: string; linkId: string }>,
  startCaptureCalls: [] as Array<{ projectId: string; linkId: string }>,
  stopCaptureCalls: [] as Array<{ projectId: string; linkId: string }>,
  downloadCalls: [] as Array<{ projectId: string; linkId: string }>,
  exportCalls: [] as string[],
  createProjectCalls: [] as string[],
  importCalls: [] as Array<{ projectId: string; size: number }>,
  updateNodeCalls: [] as Array<{ projectId: string; nodeId: string; data: any }>,
  pcapBuffer: Buffer.from("pcap-fake") as Buffer,
  exportBuffer: Buffer.from("gns3-fake") as Buffer,
  exportError: null as Error | null,
}));

vi.mock("@/client/Gns3Client", () => ({
  Gns3Client: {
    forRequest: async () => ({
      getProject: async () => mockState.proyecto,
      getTemplates: async () => mockState.plantillas,
      duplicateTemplate: async (templateId: string) => {
        mockState.duplicateCalls.push(templateId);
        return { template_id: "t-copia", name: "copia" };
      },
      updateTemplate: async (templateId: string, data: any) => {
        mockState.updateTemplateCalls.push({ templateId, data });
        const base = mockState.plantillas.find(
          (t) => t.template_id === templateId,
        );
        return { ...(base ?? { template_id: templateId }), ...data };
      },
      deleteTemplate: async (templateId: string) => {
        mockState.deleteTemplateCalls.push(templateId);
        return { success: true };
      },
      getNodes: async () => mockState.nodos,
      getLinks: async () => mockState.enlaces,
      getLink: async (projectId: string, linkId: string) => {
        mockState.getLinkCalls.push({ projectId, linkId });
        return mockState.enlaceDetalle;
      },
      startLinkCapture: async (projectId: string, linkId: string) => {
        mockState.startCaptureCalls.push({ projectId, linkId });
        return { capturing: true };
      },
      stopLinkCapture: async (projectId: string, linkId: string) => {
        mockState.stopCaptureCalls.push({ projectId, linkId });
        return { capturing: false };
      },
      downloadLinkPcap: async (projectId: string, linkId: string) => {
        mockState.downloadCalls.push({ projectId, linkId });
        return mockState.pcapBuffer;
      },
      exportProject: async (projectId: string) => {
        mockState.exportCalls.push(projectId);
        if (mockState.exportError) throw mockState.exportError;
        return mockState.exportBuffer;
      },
      createProject: async (name: string) => {
        mockState.createProjectCalls.push(name);
        return { project_id: "p-importado", name };
      },
      importProject: async (projectId: string, archive: Buffer) => {
        mockState.importCalls.push({ projectId, size: archive.byteLength });
        return { project_id: projectId, name: "importado", status: "opened" };
      },
      updateNode: async (projectId: string, nodeId: string, data: any) => {
        mockState.updateNodeCalls.push({ projectId, nodeId, data });
        return { ...data };
      },
    }),
  },
}));

import { GNS3_TOOLS_ADMIN } from "@/agent/gns3/Tool";
import { TOOL_POLICIES } from "@/agent/security/ToolPolicy";
import { requestContext, type RequestUser } from "@/utils/RequestContext";
import { adminBearer, publicApi } from "./helpers";


const GNS3_UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "gns3");
const archivosCreated: string[] = [];

afterAll(async () => {
  for (const name of archivosCreated) {
    await fs
      .rm(path.join(GNS3_UPLOADS_DIR, name), { force: true })
      .catch(() => undefined);
  }
});


interface InvokableTool {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<string>;
}


function toolByName(name: string): InvokableTool {
  const encontrada = GNS3_TOOLS_ADMIN.find(
    (candidate) => candidate.name === name,
  );
  if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
  return encontrada as unknown as InvokableTool;
}


function withProyecto<T>(
  fn: () => Promise<T>,
  proyecto: string | null = "p-1",
): Promise<T> {
  const user: RequestUser = {
    id: "u-1",
    username: "admin",
    role: "ADMIN",
    approvalChannel: { emit: vi.fn(), chatId: "c1" },
    gns3ProjectId: proyecto,
  };
  return requestContext.run(user, fn);
}

describe("tools de Fase 3 de GNS3", () => {
  beforeEach(() => {
    mockState.plantillas = [];
    mockState.nodos = [];
    mockState.enlaces = [];
    mockState.enlaceDetalle = {};
    mockState.proyecto = { project_id: "p-1", name: "lab-redes" };
    mockState.duplicateCalls = [];
    mockState.updateTemplateCalls = [];
    mockState.deleteTemplateCalls = [];
    mockState.getLinkCalls = [];
    mockState.startCaptureCalls = [];
    mockState.stopCaptureCalls = [];
    mockState.downloadCalls = [];
    mockState.exportCalls = [];
    mockState.createProjectCalls = [];
    mockState.importCalls = [];
    mockState.updateNodeCalls = [];
    mockState.exportError = null;
  });

  it("getGns3Template resuelve por nombre (sin distinguir mayúsculas) y devuelve el detalle", async () => {
    mockState.plantillas = [
      {
        template_id: "t-1",
        name: "IOSv-L2",
        category: "switch",
        node_type: "dynamips",
        template_type: "dynamips",
        image: "vios_l2-adventerprisek9-m.qcow2",
        console_type: "telnet",
        interfaces: ["GigabitEthernet0/0", "GigabitEthernet0/1"],
      },
      { template_id: "t-2", name: "VPCS" },
    ];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("getGns3Template").invoke({ templateName: "iosv-l2" }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.template).toMatchObject({
      template_id: "t-1",
      name: "IOSv-L2",
      category: "switch",
      node_type: "dynamips",
      console_type: "telnet",
    });
    expect(output.template.interfaces).toEqual([
      "GigabitEthernet0/0",
      "GigabitEthernet0/1",
    ]);

    expect(output.template.template_id).not.toBe("t-2");
  });

  it("createGns3Template clona la plantilla origen y la renombra", async () => {
    mockState.plantillas = [{ template_id: "t-base", name: "IOSv" }];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("createGns3Template").invoke({
          name: "IOSv-Lab",
          cloneFromTemplateName: "iosv",
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.message).toContain("IOSv-Lab");
    expect(mockState.duplicateCalls).toEqual(["t-base"]);
    expect(mockState.updateTemplateCalls).toEqual([
      { templateId: "t-copia", data: { name: "IOSv-Lab" } },
    ]);
    expect(output.template.template_id).toBe("t-copia");
    expect(output.template.name).toBe("IOSv-Lab");
  });

  it("createGns3Template sin plantilla origen falla con un error explicativo", async () => {
    await expect(
      withProyecto(() =>
        toolByName("createGns3Template").invoke({ name: "IOSv-Lab" }),
      ),
    ).rejects.toThrow(/cloneFromTemplate/);

    expect(mockState.duplicateCalls).toEqual([]);
    expect(mockState.updateTemplateCalls).toEqual([]);
  });

  it("deleteGns3Template con nombre ambiguo lista los candidatos y no elimina", async () => {
    mockState.plantillas = [
      { template_id: "t-1", name: "IOSv-L2-1" },
      { template_id: "t-2", name: "IOSv-L2-2" },
    ];

    await expect(
      withProyecto(() =>
        toolByName("deleteGns3Template").invoke({ templateName: "IOSv-L2" }),
      ),
    ).rejects.toThrow(/Ambigüedad[\s\S]*IOSv-L2-1[\s\S]*IOSv-L2-2/);

    expect(mockState.deleteTemplateCalls).toEqual([]);
  });

  it("startGns3LinkCapture resuelve el enlace entre R1 y SW1 por nombre", async () => {
    mockState.nodos = [
      { node_id: "n-1", name: "R1" },
      { node_id: "n-2", name: "SW1" },
      { node_id: "n-3", name: "PC1" },
    ];
    mockState.enlaces = [
      {
        link_id: "l-1",
        nodes: [{ node_id: "n-1" }, { node_id: "n-2" }],
      },
      {
        link_id: "l-2",
        nodes: [{ node_id: "n-2" }, { node_id: "n-3" }],
      },
    ];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("startGns3LinkCapture").invoke({
          nodeA: "R1",
          nodeB: "SW1",
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.link_id).toBe("l-1");
    expect(mockState.startCaptureCalls).toEqual([
      { projectId: "p-1", linkId: "l-1" },
    ]);
  });

  it("startGns3LinkCapture falla si no existe enlace entre los nodos indicados", async () => {
    mockState.nodos = [
      { node_id: "n-1", name: "R1" },
      { node_id: "n-2", name: "SW1" },
      { node_id: "n-3", name: "PC1" },
    ];
    mockState.enlaces = [
      { link_id: "l-1", nodes: [{ node_id: "n-1" }, { node_id: "n-2" }] },
    ];

    await expect(
      withProyecto(() =>
        toolByName("startGns3LinkCapture").invoke({
          nodeA: "R1",
          nodeB: "PC1",
        }),
      ),
    ).rejects.toThrow(/No hay ningún enlace entre "R1" y "PC1"/);

    expect(mockState.startCaptureCalls).toEqual([]);
  });

  it("downloadGns3LinkPcap guarda el pcap y devuelve el downloadUrl del router", async () => {
    mockState.nodos = [
      { node_id: "n-1", name: "R1" },
      { node_id: "n-2", name: "SW1" },
    ];
    mockState.enlaces = [
      { link_id: "l-abcdef123456", nodes: [{ node_id: "n-1" }, { node_id: "n-2" }] },
    ];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("downloadGns3LinkPcap").invoke({
          nodeA: "R1",
          nodeB: "SW1",
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.fileName).toMatch(/^lab-redes-l-abcdef-\d{14}\.pcap$/);
    expect(output.sizeBytes).toBe(mockState.pcapBuffer.byteLength);
    expect(output.downloadUrl).toBe(`/api/gns3/files/${output.fileName}`);

    archivosCreated.push(output.fileName);
    const guardado = await fs.readFile(
      path.join(GNS3_UPLOADS_DIR, output.fileName),
    );
    expect(guardado.toString()).toBe("pcap-fake");
    expect(mockState.downloadCalls).toEqual([
      { projectId: "p-1", linkId: "l-abcdef123456" },
    ]);
  });

  it("autoLayoutGns3Project reposiciona todos los nodos por niveles BFS y devuelve moved", async () => {
    mockState.nodos = [
      { node_id: "n-1", name: "R1", node_type: "dynamips" },
      { node_id: "n-2", name: "SW1", node_type: "dynamips" },
      { node_id: "n-3", name: "PC1", node_type: "vpcs" },
    ];
    mockState.enlaces = [
      { link_id: "l-1", nodes: [{ node_id: "n-1" }, { node_id: "n-2" }] },
      { link_id: "l-2", nodes: [{ node_id: "n-2" }, { node_id: "n-3" }] },
    ];

    const output = JSON.parse(
      await withProyecto(() => toolByName("autoLayoutGns3Project").invoke({})),
    );

    expect(output.success).toBe(true);
    expect(output.moved).toBe(3);

    expect(mockState.updateNodeCalls).toEqual([
      { projectId: "p-1", nodeId: "n-1", data: { x: 280, y: 60 } },
      { projectId: "p-1", nodeId: "n-2", data: { x: 60, y: 60 } },
      { projectId: "p-1", nodeId: "n-3", data: { x: 280, y: 200 } },
    ]);
  });

  it("importGns3Project rechaza nombres con rutas o '..' sin tocar el disco ni el cliente", async () => {
    for (const fileName of ["../evil.gns3project", "sub/evil.gns3project"]) {
      await expect(
        withProyecto(() =>
          toolByName("importGns3Project").invoke({ fileName }),
        ),
      ).rejects.toThrow(/no permitido/);
    }

    expect(mockState.createProjectCalls).toEqual([]);
    expect(mockState.importCalls).toEqual([]);
  });

  it("importGns3Project importa un archivo real del directorio de exportaciones", async () => {
    const fileName = `lab-import-${Date.now()}.gns3project`;
    await fs.mkdir(GNS3_UPLOADS_DIR, { recursive: true });
    await fs.writeFile(path.join(GNS3_UPLOADS_DIR, fileName), "contenido-gns3");
    archivosCreated.push(fileName);

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("importGns3Project").invoke({ fileName }),
      ),
    );

    expect(output.success).toBe(true);
    expect(mockState.createProjectCalls).toEqual([fileName.replace(".gns3project", "")]);
    expect(mockState.importCalls).toEqual([
      { projectId: "p-importado", size: "contenido-gns3".length },
    ]);
    expect(output.project.project_id).toBe("p-importado");
  });

  it("exportGns3Project guarda el archivo y devuelve downloadUrl con el formato esperado", async () => {
    const output = JSON.parse(
      await withProyecto(() => toolByName("exportGns3Project").invoke({})),
    );

    expect(output.success).toBe(true);
    expect(output.fileName).toMatch(/^lab-redes-\d{14}\.gns3project$/);
    expect(output.sizeBytes).toBe(mockState.exportBuffer.byteLength);
    expect(output.downloadUrl).toBe(`/api/gns3/files/${output.fileName}`);
    expect(output.downloadUrl).toMatch(
      /^\/api\/gns3\/files\/[A-Za-z0-9._-]+\.gns3project$/,
    );
    expect(mockState.exportCalls).toEqual(["p-1"]);

    archivosCreated.push(output.fileName);
    const guardado = await fs.readFile(
      path.join(GNS3_UPLOADS_DIR, output.fileName),
    );
    expect(guardado.toString()).toBe("gns3-fake");
  });

  it("exportGns3Project con el proyecto abierto devuelve PROJECT_OPEN en vez de lanzar error", async () => {
    mockState.exportError = new Error(
      'Error en GNS3 API (409): {"message":"Project must be stopped in order to export it"}',
    );

    const output = JSON.parse(
      await withProyecto(() => toolByName("exportGns3Project").invoke({})),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("PROJECT_OPEN");
    expect(output.retryAfterClose).toBe(true);
    expect(output.message).toMatch(/closeGns3Project/);
    expect(mockState.exportCalls).toEqual(["p-1"]);
  });

  it("registra las tools de Fase 3 en GNS3_TOOLS_ADMIN con su política", () => {
    const readonlyEsperadas = [
      "getGns3Template",
      "getGns3LinkCapture",
      "downloadGns3LinkPcap",
      "exportGns3Project",
    ];
    const mutatingEsperadas = [
      "createGns3Template",
      "updateGns3Template",
      "deleteGns3Template",
      "duplicateGns3Template",
      "startGns3LinkCapture",
      "stopGns3LinkCapture",
      "importGns3Project",
      "autoLayoutGns3Project",
    ];

    for (const name of [...readonlyEsperadas, ...mutatingEsperadas]) {
      expect(GNS3_TOOLS_ADMIN.some((t) => t.name === name)).toBe(true);
    }
    for (const name of readonlyEsperadas) {
      expect(TOOL_POLICIES[name]).toMatchObject({
        access: "readonly",
        kind: "simulation",
      });
    }
    for (const name of mutatingEsperadas) {
      expect(TOOL_POLICIES[name]).toMatchObject({
        access: "mutating",
        kind: "topology",
      });
    }
  });
});

describe("descarga de artefactos GNS3 /api/gns3", () => {
  it("rechaza nombres con extensión no permitida", async () => {
    const bearer = await adminBearer();
    const reply = await publicApi()
      .get("/api/gns3/files/archivo_invalido.exe")
      .set("Authorization", bearer);

    expect([400, 404]).toContain(reply.status);
  });

  it("devuelve 404 si el nombre es válido pero el archivo no existe", async () => {
    const bearer = await adminBearer();
    const reply = await publicApi()
      .get("/api/gns3/files/no-existe-xyz.pcap")
      .set("Authorization", bearer);

    expect(reply.status).toBe(404);
  });
});
