

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  proyectos: [] as any[],
  proyecto: null as any,
  nodes: [] as any[],
  enlaces: [] as any[],
  errorTopology: null as Error | null,
}));

vi.mock("@/client/Gns3Client", () => ({
  Gns3Client: {
    forRequest: async () => ({
      getProjects: async () => mockState.proyectos,
      getProject: async () => {
        if (mockState.errorTopologia) throw mockState.errorTopologia;
        return mockState.proyecto;
      },
      getNodes: async () => {
        if (mockState.errorTopologia) throw mockState.errorTopologia;
        return mockState.nodos;
      },
      getLinks: async () => {
        if (mockState.errorTopologia) throw mockState.errorTopologia;
        return mockState.enlaces;
      },
    }),
  },
}));

import { adminBearer, publicApi } from "./helpers";

describe("GET /api/gns3/projects", () => {
  beforeEach(() => {
    mockState.proyectos = [];
  });

  it("devuelve la lista mapeada y ordenada por nombre como ADMIN", async () => {
    mockState.proyectos = [
      {
        project_id: "p-2",
        name: "Zeta",
        status: "opened",
        filename: "zeta.gns3project",
        extra: "ignorado",
      },
      { project_id: "p-1", name: "Alfa", status: "closed" },
    ];

    const bearer = await adminBearer();
    const response = await publicApi()
      .get("/api/gns3/projects")
      .set("Authorization", bearer);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([
      { project_id: "p-1", name: "Alfa", status: "closed", filename: null },
      {
        project_id: "p-2",
        name: "Zeta",
        status: "opened",
        filename: "zeta.gns3project",
      },
    ]);
  });

  it("responde 401 sin autenticación", async () => {
    const response = await publicApi().get("/api/gns3/projects");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});

describe("GET /api/gns3/projects/:projectId/topology", () => {
  beforeEach(() => {
    mockState.errorTopologia = null;
    mockState.proyecto = {
      project_id: "p-1",
      name: "lab-redes",
      status: "opened",
    };
    mockState.nodos = [
      {
        node_id: "n-1",
        name: "R1",
        node_type: "dynamips",
        status: "started",
        x: 10,
        y: -25,
        console_host: "127.0.0.1",
        console: 5002,
        console_type: "telnet",
        compute_id: "local",
      },
      { node_id: "n-2", name: "SW1" },
    ];
    mockState.enlaces = [
      {
        link_id: "l-1",
        nodes: [
          { node_id: "n-1", adapter_number: 0, port_number: 0 },
          { node_id: "n-2", adapter_number: 0, port_number: 1 },
        ],
        capturing: true,
      },
      {
        link_id: "l-2",
        nodes: [{ node_id: "n-1", adapter_number: 1, port_number: 0 }],
      },
      {
        link_id: "l-3",
        nodes: [{ node_id: "n-1" }, { node_id: "n-2" }],
        filters: { latency: 0 },
      },
    ];
  });

  it("normaliza nodos y enlaces (tolera campos ausentes y filtra enlaces incompletos)", async () => {
    const bearer = await adminBearer();
    const response = await publicApi()
      .get("/api/gns3/projects/p-1/topology")
      .set("Authorization", bearer);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        project: { project_id: "p-1", name: "lab-redes", status: "opened" },
        nodes: [
          {
            node_id: "n-1",
            name: "R1",
            node_type: "dynamips",
            status: "started",
            x: 10,
            y: -25,
            console_host: "127.0.0.1",
            console: 5002,
            console_type: "telnet",
          },
          {
            node_id: "n-2",
            name: "SW1",
            node_type: null,
            status: null,
            x: null,
            y: null,
            console_host: null,
            console: null,
            console_type: null,
          },
        ],
        links: [
          {
            link_id: "l-1",
            nodes: [
              { node_id: "n-1", adapter_number: 0, port_number: 0 },
              { node_id: "n-2", adapter_number: 0, port_number: 1 },
            ],
            capturing: true,
          },
          {
            link_id: "l-3",
            nodes: [
              { node_id: "n-1", adapter_number: null, port_number: null },
              { node_id: "n-2", adapter_number: null, port_number: null },
            ],
            filters: { latency: 0 },
          },
        ],
      },
    });

    
    expect(response.body.data.nodes[0]).not.toHaveProperty("compute_id");
    expect(response.body.data.links).toHaveLength(2);
    expect(response.body.data.links.map((link: any) => link.link_id)).toEqual([
      "l-1",
      "l-3",
    ]);
  });

  it("responde 404 cuando el proyecto no existe en GNS3", async () => {
    mockState.errorTopologia = new Error(
      "Error en GNS3 API (404): Project p-inexistente not found",
    );

    const bearer = await adminBearer();
    const response = await publicApi()
      .get("/api/gns3/projects/p-inexistente/topology")
      .set("Authorization", bearer);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Proyecto GNS3 no encontrado",
      data: null,
    });
  });

  it("responde 401 sin autenticación", async () => {
    const response = await publicApi().get("/api/gns3/projects/p-1/topology");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});
