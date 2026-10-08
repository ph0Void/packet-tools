

import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  proyectos: [
    {
      project_id: "p-1",
      name: "aprendiendo-1",
      status: "opened",
      filename: "aprendiendo-1.gns3",
    },
    {
      project_id: "p-2",
      name: "aprendiendo-2",
      status: "closed",
      filename: "aprendiendo-2.gns3",
    },
    {
      
      project_id: "p-3",
      name: "sin-estado",
    },
  ] as any[],
  fallarLinks: false,
}));

vi.mock("@/client/Gns3Client", () => ({
  Gns3Client: {
    forRequest: async () => ({
      getProjects: async () => mockState.proyectos,
      getProject: async (id: string) =>
        mockState.proyectos.find((p) => p.project_id === id),
      getNodes: async () => [{ node_id: "n-1" }, { node_id: "n-2" }],
      getLinks: async () => {
        if (mockState.fallarLinks) throw new Error("GNS3 respondió 500");
        return [{ link_id: "l-1" }];
      },
    }),
  },
}));

import { GNS3_TOOLS_ADMIN } from "@/agent/gns3/Tool";


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

describe("tools de proyectos GNS3", () => {
  it("listGns3Projects resume los proyectos y tolera campos ausentes", async () => {
    const output = JSON.parse(
      await toolByName("listGns3Projects").invoke({}),
    );

    expect(output.success).toBe(true);
    expect(output.projects).toHaveLength(3);
    expect(output.projects[0]).toEqual({
      project_id: "p-1",
      name: "aprendiendo-1",
      status: "opened",
      filename: "aprendiendo-1.gns3",
      opened: true,
    });

    expect(output.projects[1].opened).toBe(false);

    expect(output.projects[2].opened).toBe(false);
  });

  it("findGns3Project encuentra por coincidencia parcial sin distinguir mayúsculas", async () => {
    const output = JSON.parse(
      await toolByName("findGns3Project").invoke({ name: "APRENDIENDO" }),
    );

    expect(output.success).toBe(true);
    expect(output.matches).toHaveLength(2);
    expect(output.matches.map((m: any) => m.project_id)).toEqual(["p-1", "p-2"]);
    expect(output.message).toContain("2 proyecto");
  });

  it("findGns3Project sin coincidencias devuelve matches vacío y mensaje", async () => {
    const output = JSON.parse(
      await toolByName("findGns3Project").invoke({ name: "no-existe-xyz" }),
    );

    expect(output.success).toBe(true);
    expect(output.matches).toEqual([]);
    expect(output.message).toContain("no-existe-xyz");
  });

  it("getGns3Project devuelve el resumen y los counts de nodos y enlaces", async () => {
    const output = JSON.parse(
      await toolByName("getGns3Project").invoke({ projectId: "p-1" }),
    );

    expect(output.success).toBe(true);
    expect(output.project).toEqual({
      project_id: "p-1",
      name: "aprendiendo-1",
      status: "opened",
    });
    expect(output.counts).toEqual({ nodes: 2, links: 1 });
  });

  it("getGns3Project devuelve el proyecto aunque falle la lista de enlaces", async () => {
    mockState.fallarLinks = true;
    try {
      const output = JSON.parse(
        await toolByName("getGns3Project").invoke({ projectId: "p-2" }),
      );

      expect(output.success).toBe(true);
      expect(output.project.project_id).toBe("p-2");
      expect(output.counts.nodes).toBe(2);
      expect(output.counts.links).toBeNull();
    } finally {
      mockState.fallarLinks = false;
    }
  });
});
