

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  snapshots: [] as any[],
  nodes: [] as any[],
  archivos: [] as any[],
  contentArchivo: "",
  stats: {} as any,
  compute: {} as any,
  restoreCalls: [] as Array<{ projectId: string; snapshotId: string }>,
  deleteCalls: [] as Array<{ projectId: string; snapshotId: string }>,
  archivosLeidos: [] as Array<{
    projectId: string;
    nodeId: string;
    path: string;
  }>,
  listadoArgs: [] as Array<{
    projectId: string;
    nodeId: string;
    computeId?: string;
    nodeName?: string;
  }>,
  listadoError: null as Error | null,
  readError: null as Error | null,
  computeIdRecibido: undefined as string | undefined,
}));

vi.mock("@/client/Gns3Client", () => ({
  Gns3Client: {
    forRequest: async () => ({
      getSnapshots: async () => mockState.snapshots,
      getNodes: async () => mockState.nodos,
      createSnapshot: async (_projectId: string, name?: string) => ({
        snapshot_id: "s-nuevo",
        name: name ?? "snapshot-automatico",
        created_at: "2026-09-18T10:00:00Z",
      }),
      restoreSnapshot: async (projectId: string, snapshotId: string) => {
        mockState.restoreCalls.push({ projectId, snapshotId });
        return { success: true };
      },
      deleteSnapshot: async (projectId: string, snapshotId: string) => {
        mockState.deleteCalls.push({ projectId, snapshotId });
        return { success: true };
      },
      getProjectStats: async () => mockState.stats,
      getNodeFiles: async (
        projectId: string,
        nodeId: string,
        opts?: { computeId?: string; nodeName?: string },
      ) => {
        mockState.listadoArgs.push({
          projectId,
          nodeId,
          computeId: opts?.computeId,
          nodeName: opts?.nodeName,
        });
        if (mockState.listadoError) throw mockState.listadoError;
        return mockState.archivos;
      },
      readNodeFile: async (
        projectId: string,
        nodeId: string,
        path: string,
      ) => {
        mockState.archivosLeidos.push({ projectId, nodeId, path });
        if (mockState.lecturaError) throw mockState.lecturaError;
        return mockState.contenidoArchivo;
      },
      getComputes: async () => [],
      getCompute: async (computeId?: string) => {
        mockState.computeIdRecibido = computeId;
        return mockState.compute;
      },
    }),
  },
}));

import { GNS3_TOOLS_ADMIN } from "@/agent/gns3/Tool";
import { TOOL_POLICIES } from "@/agent/security/ToolPolicy";
import { requestContext, type RequestUser } from "@/utils/RequestContext";


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

const nodeBase = {
  node_id: "n-1",
  name: "R1",
  status: "started",
  compute_id: "local",
};

describe("tools de Fase 2 de GNS3", () => {
  beforeEach(() => {
    mockState.snapshots = [];
    mockState.nodos = [nodeBase];
    mockState.archivos = [];
    mockState.contenidoArchivo = "";
    mockState.stats = {};
    mockState.compute = {};
    mockState.restoreCalls = [];
    mockState.deleteCalls = [];
    mockState.archivosLeidos = [];
    mockState.listadoArgs = [];
    mockState.listadoError = null;
    mockState.lecturaError = null;
    mockState.computeIdRecibido = undefined;
  });

  it("listGns3Snapshots resume los snapshots y tolera campos ausentes", async () => {
    mockState.snapshots = [
      {
        snapshot_id: "s-1",
        name: "antes-de-cambios",
        created_at: "2026-09-18T09:00:00Z",
      },
      { snapshot_id: "s-2" },
    ];

    const output = JSON.parse(
      await withProyecto(() => toolByName("listGns3Snapshots").invoke({})),
    );

    expect(output.success).toBe(true);
    expect(output.snapshots).toHaveLength(2);
    expect(output.snapshots[0]).toEqual({
      snapshot_id: "s-1",
      name: "antes-de-cambios",
      created_at: "2026-09-18T09:00:00Z",
    });
    expect(output.snapshots[1].snapshot_id).toBe("s-2");
    expect(output.snapshots[1].name).toBeUndefined();
  });

  it("createGns3Snapshot devuelve el mensaje con el nombre y el snapshot", async () => {
    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("createGns3Snapshot").invoke({ name: "antes-de-ospf" }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.message).toBe("Snapshot 'antes-de-ospf' creado.");
    expect(output.snapshot.snapshot_id).toBe("s-nuevo");
  });

  it("restoreGns3Snapshot por nombre resuelve el snapshot_id correcto", async () => {
    mockState.snapshots = [
      { snapshot_id: "s-1", name: "base-limpia" },
      { snapshot_id: "s-2", name: "antes-de-ospf" },
    ];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("restoreGns3Snapshot").invoke({
          snapshotName: "ANTES-DE-OSPF",
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(mockState.restoreCalls).toEqual([
      { projectId: "p-1", snapshotId: "s-2" },
    ]);
    expect(output.message).toContain("antes-de-ospf");
    expect(output.message).toMatch(/no guardados/i);
  });

  it("restoreGns3Snapshot falla con mensaje guiado si el nombre no existe", async () => {
    mockState.snapshots = [{ snapshot_id: "s-1", name: "base-limpia" }];

    await expect(
      withProyecto(() =>
        toolByName("restoreGns3Snapshot").invoke({ snapshotName: "no-existe" }),
      ),
    ).rejects.toThrow(/No se encontró ningún snapshot/);

    expect(mockState.restoreCalls).toEqual([]);
  });

  it("restoreGns3Snapshot rechaza nombres ambiguos listando los candidatos", async () => {
    mockState.snapshots = [
      { snapshot_id: "s-1", name: "antes-de-ospf" },
      { snapshot_id: "s-2", name: "antes-de-bgp" },
    ];

    await expect(
      withProyecto(() =>
        toolByName("restoreGns3Snapshot").invoke({ snapshotName: "antes" }),
      ),
    ).rejects.toThrow(/Ambigüedad[\s\S]*antes-de-ospf[\s\S]*antes-de-bgp/);

    expect(mockState.restoreCalls).toEqual([]);
  });

  it("deleteGns3Snapshot resuelve por nombre y confirma la eliminación", async () => {
    mockState.snapshots = [{ snapshot_id: "s-1", name: "base-limpia" }];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("deleteGns3Snapshot").invoke({ snapshotName: "base-limpia" }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.message).toContain("eliminado");
    expect(mockState.deleteCalls).toEqual([
      { projectId: "p-1", snapshotId: "s-1" },
    ]);
  });

  it("getGns3ProjectStats devuelve los counts del proyecto", async () => {
    mockState.stats = { nodes: 3, links: 2, snapshots: 1 };

    const output = JSON.parse(
      await withProyecto(() => toolByName("getGns3ProjectStats").invoke({})),
    );

    expect(output.success).toBe(true);
    expect(output.counts).toEqual({
      nodes: 3,
      links: 2,
      snapshots: 1,
      drawings: 0,
    });
  });

  it("listGns3NodeFiles normaliza entradas string y {name,path} y pasa computeId/nodeName", async () => {
    mockState.archivos = [
      "iou.log",
      { name: "dynamips_i1_log.txt", path: "dynamips_i1_log.txt" },
      { path: "vpcs/vpcs.log" },
    ];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("listGns3NodeFiles").invoke({ nodeName: "R1" }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.node).toEqual({ node_id: "n-1", name: "R1" });
    expect(output.files).toEqual([
      { name: "iou.log", path: "iou.log" },
      { name: "dynamips_i1_log.txt", path: "dynamips_i1_log.txt" },
      { name: "vpcs/vpcs.log", path: "vpcs/vpcs.log" },
    ]);
    expect(mockState.listadoArgs).toEqual([
      { projectId: "p-1", nodeId: "n-1", computeId: "local", nodeName: "R1" },
    ]);
  });

  it("listGns3NodeFiles devuelve candidates (sin lanzar) si el listado falla", async () => {
    mockState.listadoError = new Error(
      "No se pudo listar los archivos del nodo en este servidor GNS3 (el compute debe ser local).",
    );

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("listGns3NodeFiles").invoke({ nodeName: "R1" }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.message).toMatch(/compute debe ser local/);
    expect(output.candidates).toContain("dynamips_i1_log.txt");
    expect(output.candidates).toContain("configs/i1_startup-config.cfg");
  });

  it("readGns3NodeLog rechaza rutas inseguras ('..', '\\' y absolutas) sin leer", async () => {
    for (const file of ["../etc/passwd", "configs\\i1_startup-config.cfg", "/etc/passwd", "C:/logs/iou.log"]) {
      await expect(
        withProyecto(() =>
          toolByName("readGns3NodeLog").invoke({ nodeName: "R1", file }),
        ),
      ).rejects.toThrow(/no permitida/);
    }

    expect(mockState.archivosLeidos).toEqual([]);
  });

  it("readGns3NodeLog lee directo (con subruta) y trunca a 12000", async () => {
    mockState.contenidoArchivo = "X".repeat(13000);

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("readGns3NodeLog").invoke({
          nodeName: "R1",
          file: "configs/i1_startup-config.cfg",
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.file).toBe("configs/i1_startup-config.cfg");
    expect(output.content).toHaveLength(12000);
    expect(output.truncated).toBe(true);
    expect(mockState.archivosLeidos).toEqual([
      {
        projectId: "p-1",
        nodeId: "n-1",
        path: "configs/i1_startup-config.cfg",
      },
    ]);
  });

  it("readGns3NodeLog no marca truncado si el contenido cabe", async () => {
    mockState.contenidoArchivo = "linea de log";

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("readGns3NodeLog").invoke({
          nodeName: "R1",
          file: "iou.log",
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.content).toBe("linea de log");
    expect(output.truncated).toBe(false);
  });

  it("readGns3NodeLog en 404 responde con los archivos disponibles del nodo", async () => {
    mockState.lecturaError = new Error("Error en GNS3 API (404): respuesta sin detalle");
    mockState.archivos = [
      { name: "dynamips_i1_log.txt", path: "dynamips_i1_log.txt" },
      { name: "i1_startup-config.cfg", path: "configs/i1_startup-config.cfg" },
    ];

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("readGns3NodeLog").invoke({
          nodeName: "R1",
          file: "no-existe.log",
        }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.message).toBe("Archivo no encontrado en el nodo R1.");
    expect(output.files).toEqual([
      "dynamips_i1_log.txt",
      "configs/i1_startup-config.cfg",
    ]);
    expect(mockState.listadoArgs).toEqual([
      { projectId: "p-1", nodeId: "n-1", computeId: "local", nodeName: "R1" },
    ]);
  });

  it("readGns3NodeLog en 404 con listado también fallido sugiere candidatos", async () => {
    mockState.lecturaError = new Error("Error en GNS3 API (404): respuesta sin detalle");
    mockState.listadoError = new Error(
      "No se pudo listar los archivos del nodo en este servidor GNS3 (el compute debe ser local).",
    );

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("readGns3NodeLog").invoke({
          nodeName: "R1",
          file: "no-existe.log",
        }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.message).toMatch(
      /^Archivo no encontrado\. Prueba con: dynamips_i1_log\.txt, dynamips_i1_stdout\.txt, c7200_i1_log\.txt, configs\/i1_startup-config\.cfg, iou\.log, qemu\.log, vpcs\.log, log\.txt, ubridge\.log$/,
    );
  });

  it("getGns3ServerResources omite los campos ausentes del cómputo", async () => {
    mockState.compute = {
      compute_id: "local",
      name: "GNS3 local",
      connected: true,
    };

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("getGns3ServerResources").invoke({}),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.compute).toEqual({
      compute_id: "local",
      name: "GNS3 local",
      connected: true,
    });
    expect("cpu_usage_percent" in output.compute).toBe(false);
    expect("memory_usage_percent" in output.compute).toBe(false);
    expect(mockState.computeIdRecibido).toBeUndefined();
  });

  it("getGns3ServerResources consulta el computeId indicado", async () => {
    mockState.compute = {
      compute_id: "vm-1",
      connected: true,
      cpu_usage_percent: 42,
      memory_usage_percent: 55,
    };

    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("getGns3ServerResources").invoke({ computeId: "vm-1" }),
      ),
    );

    expect(output.compute.cpu_usage_percent).toBe(42);
    expect(output.compute.memory_usage_percent).toBe(55);
    expect(mockState.computeIdRecibido).toBe("vm-1");
  });

  it("registra las tools nuevas en GNS3_TOOLS_ADMIN con su política", () => {
    const readonlyEsperadas = [
      "listGns3Snapshots",
      "getGns3ProjectStats",
      "listGns3NodeFiles",
      "readGns3NodeLog",
      "getGns3ServerResources",
    ];
    const mutatingEsperadas = [
      "createGns3Snapshot",
      "restoreGns3Snapshot",
      "deleteGns3Snapshot",
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
