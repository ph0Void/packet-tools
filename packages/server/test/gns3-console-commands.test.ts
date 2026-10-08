

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  nodes: [] as any[],
  commandsRecibidos: [] as string[],
  hostRecibido: "",
  portRecibido: 0,
  desconexiones: 0,
  outputMockConsole: "R1#show version\nCisco IOS Software",
}));

vi.mock("@/client/Gns3Client", () => ({
  Gns3Client: {
    forRequest: async () => ({
      getNodes: async () => mockState.nodos,
    }),
  },
}));

vi.mock("@/client/TelnetClient", () => ({
  TelnetClient: class {
    constructor(host: string, port: number) {
      mockState.hostRecibido = host;
      mockState.puertoRecibido = port;
    }

    async executeCommands(commands: string[]): Promise<string> {
      mockState.comandosRecibidos = commands;
      return mockState.salidaConsola;
    }

    async disconnect(): Promise<void> {
      mockState.desconexiones += 1;
    }
  },
}));

import { GNS3_TOOLS_ADMIN } from "@/agent/gns3/Tool";
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
    gns3ProjectId: proyecto,
  };
  return requestContext.run(user, fn);
}

const nodeTelnet = {
  node_id: "n-1",
  name: "R1",
  node_type: "dynamips",
  status: "started",
  console_type: "telnet",
  console_host: "127.0.0.1",
  console: 5002,
};

describe("sendGns3ConsoleCommands", () => {
  beforeEach(() => {
    mockState.nodos = [nodeTelnet];
    mockState.comandosRecibidos = [];
    mockState.hostRecibido = "";
    mockState.puertoRecibido = 0;
    mockState.desconexiones = 0;
    mockState.salidaConsola = "R1#show version\nCisco IOS Software";
  });

  it("envía los comandos al nodo encendido y devuelve la salida", async () => {
    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("sendGns3ConsoleCommands").invoke({
          nodeName: "R1",
          commands: ["enable", "show version"],
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.node).toEqual({
      node_id: "n-1",
      name: "R1",
      node_type: "dynamips",
    });
    expect(output.console).toEqual({ host: "127.0.0.1", port: 5002 });
    expect(output.output).toContain("Cisco IOS Software");
    expect(mockState.comandosRecibidos).toEqual(["enable", "show version"]);
    expect(mockState.hostRecibido).toBe("127.0.0.1");
    expect(mockState.puertoRecibido).toBe(5002);
    expect(mockState.desconexiones).toBe(1);
  });

  it("rechaza si el nodo está apagado", async () => {
    mockState.nodos = [{ ...nodeTelnet, status: "stopped" }];

    await expect(
      withProyecto(() =>
        toolByName("sendGns3ConsoleCommands").invoke({
          nodeName: "R1",
          commands: ["show version"],
        }),
      ),
    ).rejects.toThrow(/está apagado/);

    expect(mockState.comandosRecibidos).toEqual([]);
  });

  it("rechaza si la consola no es de tipo telnet", async () => {
    mockState.nodos = [{ ...nodeTelnet, console_type: "none" }];

    await expect(
      withProyecto(() =>
        toolByName("sendGns3ConsoleCommands").invoke({
          nodeName: "R1",
          commands: ["show version"],
        }),
      ),
    ).rejects.toThrow(/no puede operarse/);
  });

  it("rechaza con los candidatos si el nombre del nodo es ambiguo", async () => {
    mockState.nodos = [
      { ...nodeTelnet, node_id: "n-1", name: "R1-Core" },
      { ...nodeTelnet, node_id: "n-2", name: "R1-Edge" },
    ];

    await expect(
      withProyecto(() =>
        toolByName("sendGns3ConsoleCommands").invoke({
          nodeName: "R1",
          commands: ["show version"],
        }),
      ),
    ).rejects.toThrow(/R1-Core[\s\S]*R1-Edge/);
  });

  it("resuelve el nodo por nodeId", async () => {
    const output = JSON.parse(
      await withProyecto(() =>
        toolByName("sendGns3ConsoleCommands").invoke({
          nodeId: "n-1",
          commands: ["ping 192.168.1.1"],
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(mockState.comandosRecibidos).toEqual(["ping 192.168.1.1"]);
  });

  it("falla con mensaje guiado si no hay proyecto activo ni projectId", async () => {
    const tool = toolByName("sendGns3ConsoleCommands");


    await expect(
      tool.invoke({ nodeName: "R1", commands: ["show version"] }),
    ).rejects.toThrow(/No hay proyecto GNS3 activo/);


    await expect(
      withProyecto(
        () => tool.invoke({ nodeName: "R1", commands: ["show version"] }),
        null,
      ),
    ).rejects.toThrow(/No hay proyecto GNS3 activo/);
  });
});
