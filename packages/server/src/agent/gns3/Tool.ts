import { tool } from "@langchain/core/tools";
import fs from "node:fs/promises";
import { Socket } from "node:net";
import path from "node:path";
import { z } from "zod";
import { Gns3Client } from "@/client/Gns3Client";
import { TelnetClient } from "@/client/TelnetClient";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { requestContext } from "@/utils/RequestContext";
import { searchKnowledgeBaseTool } from "../knowledge/Tool";
import { CONNECTION_TOOLS } from "../tools/DeviceTools";
import { openGns3ConsoleTool } from "../tools/OpenConsoleTools";
import { TERMINAL_TOOLS } from "../tools/TerminalTools";

async function getGns3Client(): Promise<Gns3Client> {
  const ctx = requestContext.getStore();
  return Gns3Client.forRequest(
    ctx?.connectionProviderId ?? ctx?.mentionedProviderId ?? null,
  );
}

async function setActiveProject(projectId: string): Promise<void> {
  const chatId = requestContext.getStore()?.approvalChannel?.chatId;
  if (!chatId || !projectId) return;
  try {
    await prismaClient.chat.update({
      where: { id: chatId },
      data: { gns3ProjectId: projectId },
    });
  } catch (error: any) {
    Logger.warning({
      message: "[GNS3] No se pudo persistir el proyecto activo en el chat.",
      data: { chatId, projectId, error: error?.message ?? "desconocido" },
    });
  }
}

function resolverProyectoActivo(projectId?: string): string {
  const proyecto =
    projectId?.trim() || requestContext.getStore()?.gns3ProjectId || null;
  if (!proyecto) {
    throw new Error(
      "No hay proyecto GNS3 activo. Usa listGns3Projects y openGns3Project primero.",
    );
  }
  return proyecto;
}

async function resolverNodo(
  client: Gns3Client,
  proyecto: string,
  nodeId?: string,
  nodeName?: string,
): Promise<any> {
  const nodos = (await client.getNodes(proyecto)) ?? [];

  const idBuscado = nodeId?.trim();
  if (idBuscado) {
    const encontrado = nodos.find((n: any) => n?.node_id === idBuscado);
    if (!encontrado) {
      throw new Error(
        `No se encontró el nodo con node_id '${idBuscado}' en el proyecto. Usa listGns3Nodes para ver los nodos reales.`,
      );
    }
    return encontrado;
  }

  const nombreBuscado = nodeName?.trim().toLowerCase();
  if (!nombreBuscado) {
    throw new Error(
      "Debes indicar 'nodeId' o 'nodeName' para elegir el nodo de destino.",
    );
  }

  const exactos = nodos.filter(
    (n: any) => String(n?.name ?? "").toLowerCase() === nombreBuscado,
  );
  const candidatos =
    exactos.length > 0
      ? exactos
      : nodos.filter((n: any) =>
          String(n?.name ?? "").toLowerCase().includes(nombreBuscado),
        );

  if (candidatos.length === 0) {
    throw new Error(
      `No se encontró ningún nodo cuyo nombre coincida con '${nodeName}'. Usa listGns3Nodes para ver los nombres reales.`,
    );
  }
  if (candidatos.length > 1) {
    const nombres = candidatos.map((n: any) => `"${n?.name}"`).join(", ");
    throw new Error(
      `Ambigüedad: varios nodos coinciden con '${nodeName}': ${nombres}. Repite la operación con 'nodeId' para elegir uno.`,
    );
  }
  return candidatos[0];
}

function resolverSnapshot(
  snapshots: any[],
  snapshotId?: string,
  snapshotName?: string,
): any {
  const idBuscado = snapshotId?.trim();
  if (idBuscado) {
    const encontrado = snapshots.find((s: any) => s?.snapshot_id === idBuscado);
    if (!encontrado) {
      throw new Error(
        `No se encontró el snapshot con snapshot_id '${idBuscado}' en el proyecto. Usa listGns3Snapshots para ver los snapshots reales.`,
      );
    }
    return encontrado;
  }

  const nombreBuscado = snapshotName?.trim().toLowerCase();
  if (!nombreBuscado) {
    throw new Error(
      "Debes indicar 'snapshotId' o 'snapshotName' para elegir el snapshot.",
    );
  }

  const exactos = snapshots.filter(
    (s: any) => String(s?.name ?? "").toLowerCase() === nombreBuscado,
  );
  const candidatos =
    exactos.length > 0
      ? exactos
      : snapshots.filter((s: any) =>
          String(s?.name ?? "").toLowerCase().includes(nombreBuscado),
        );

  if (candidatos.length === 0) {
    throw new Error(
      `No se encontró ningún snapshot cuyo nombre coincida con '${snapshotName}'. Usa listGns3Snapshots para ver los snapshots reales.`,
    );
  }
  if (candidatos.length > 1) {
    const nombres = candidatos.map((s: any) => `"${s?.name}"`).join(", ");
    throw new Error(
      `Ambigüedad: varios snapshots coinciden con '${snapshotName}': ${nombres}. Repite la operación con 'snapshotId' para elegir uno.`,
    );
  }
  return candidatos[0];
}

function normalizarArchivosNodo(archivos: any[]): Array<{ name: string; path: string }> {
  return (archivos ?? [])
    .map((f: any) => {
      if (typeof f === "string") return { name: f, path: f };
      const ruta = f?.path ?? f?.name;
      return { name: f?.name ?? ruta, path: ruta };
    })
    .filter((f: any) => Boolean(f.path));
}

const GNS3_UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "gns3");

function timestampArchivo(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function slugProyecto(nombre: string): string {
  const slug = String(nombre ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "proyecto";
}

async function slugDeProyecto(client: Gns3Client, proyecto: string): Promise<string> {
  try {
    const detalle = await client.getProject(proyecto);
    return slugProyecto(detalle?.name ?? proyecto);
  } catch {
    return slugProyecto(proyecto);
  }
}

async function resolverPlantilla(
  client: Gns3Client,
  templateId?: string,
  templateName?: string,
): Promise<any> {
  const plantillas = (await client.getTemplates()) ?? [];

  const idBuscado = templateId?.trim();
  if (idBuscado) {
    const encontrada = plantillas.find(
      (t: any) => t?.template_id === idBuscado,
    );
    if (!encontrada) {
      throw new Error(
        `No se encontró la plantilla con template_id '${idBuscado}'. Usa getGns3Templates para ver las plantillas reales.`,
      );
    }
    return encontrada;
  }

  const nombreBuscado = templateName?.trim().toLowerCase();
  if (!nombreBuscado) {
    throw new Error(
      "Debes indicar 'templateId' o 'templateName' para elegir la plantilla.",
    );
  }

  const exactas = plantillas.filter(
    (t: any) => String(t?.name ?? "").toLowerCase() === nombreBuscado,
  );
  const candidatas =
    exactas.length > 0
      ? exactas
      : plantillas.filter((t: any) =>
          String(t?.name ?? "").toLowerCase().includes(nombreBuscado),
        );

  if (candidatas.length === 0) {
    throw new Error(
      `No se encontró ninguna plantilla cuyo nombre coincida con '${templateName}'. Usa getGns3Templates para ver las plantillas reales.`,
    );
  }
  if (candidatas.length > 1) {
    const nombres = candidatas
      .map((t: any) => `"${t?.name}" (${t?.template_id})`)
      .join(", ");
    throw new Error(
      `Ambigüedad: varias plantillas coinciden con '${templateName}': ${nombres}. Repite la operación con 'templateId' para elegir una.`,
    );
  }
  return candidatas[0];
}

function resumirPlantilla(plantilla: any) {
  return {
    template_id: plantilla?.template_id,
    name: plantilla?.name,
    category: plantilla?.category,
    node_type: plantilla?.node_type,
    template_type: plantilla?.template_type,
    image: plantilla?.image,
    console_type: plantilla?.console_type,
    interfaces: plantilla?.interfaces,
  };
}

async function resolverNodoPorReferencia(
  client: Gns3Client,
  proyecto: string,
  referencia: string,
): Promise<any> {
  try {
    return await resolverNodo(client, proyecto, referencia, undefined);
  } catch {
    return await resolverNodo(client, proyecto, undefined, referencia);
  }
}

async function resolverEnlace(
  client: Gns3Client,
  proyecto: string,
  linkId?: string,
  nodeA?: string,
  nodeB?: string,
): Promise<any> {
  const enlaces = (await client.getLinks(proyecto)) ?? [];

  const idBuscado = linkId?.trim();
  if (idBuscado) {
    const encontrado = enlaces.find((l: any) => l?.link_id === idBuscado);
    if (!encontrado) {
      throw new Error(
        `No se encontró el enlace con link_id '${idBuscado}' en el proyecto. Usa listGns3Links para ver los enlaces reales.`,
      );
    }
    return encontrado;
  }

  const referenciaA = nodeA?.trim();
  const referenciaB = nodeB?.trim();
  if (!referenciaA || !referenciaB) {
    throw new Error(
      "Debes indicar 'linkId' o el par 'nodeA' y 'nodeB' para elegir el enlace.",
    );
  }

  const nodoA = await resolverNodoPorReferencia(client, proyecto, referenciaA);
  const nodoB = await resolverNodoPorReferencia(client, proyecto, referenciaB);
  if (nodoA.node_id === nodoB.node_id) {
    throw new Error(
      `'nodeA' y 'nodeB' apuntan al mismo nodo ("${nodoA.name}"); indica dos nodos distintos unidos por un cable.`,
    );
  }

  const candidatos = enlaces.filter((l: any) => {
    const ids = new Set(
      (l?.nodes ?? []).map((n: any) => String(n?.node_id ?? "")),
    );
    return ids.has(String(nodoA.node_id)) && ids.has(String(nodoB.node_id));
  });

  if (candidatos.length === 0) {
    throw new Error(
      `No hay ningún enlace entre "${nodoA.name}" y "${nodoB.name}". Usa listGns3Links para ver los cables reales del proyecto.`,
    );
  }
  if (candidatos.length > 1) {
    const ids = candidatos.map((l: any) => `"${l?.link_id}"`).join(", ");
    throw new Error(
      `Ambigüedad: hay varios enlaces entre "${nodoA.name}" y "${nodoB.name}" (${ids}). Repite la operación con 'linkId' para elegir uno.`,
    );
  }
  return candidatos[0];
}

const ARCHIVOS_NODO_CANDIDATOS = [
  "dynamips_i1_log.txt",
  "dynamips_i1_stdout.txt",
  "c7200_i1_log.txt",
  "configs/i1_startup-config.cfg",
  "iou.log",
  "qemu.log",
  "vpcs.log",
  "log.txt",
  "ubridge.log",
];

function resumirProyecto(project: any) {
  return {
    project_id: project?.project_id,
    name: project?.name,
    status: project?.status,
    filename: project?.filename,
    opened: project?.opened ?? (project?.status === "opened"),
  };
}

const listGns3ProjectsTool = tool(
  async () => {
    try {
      const client = await getGns3Client();
      const projects = (await client.getProjects()) ?? [];
      return JSON.stringify({
        success: true,
        projects: projects.map(resumirProyecto),
      });
    } catch (error: any) {
      throw new Error(
        `Error listando los proyectos GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "listGns3Projects",
    description:
      "List all saved GNS3 projects with project_id, name, status and open flag; use it first whenever the user mentions \"my project\", \"my lab\" or \"my setup\".",
    schema: z.object({}),
  },
);

const findGns3ProjectTool = tool(
  async ({ name }) => {
    try {
      const client = await getGns3Client();
      const projects = (await client.getProjects()) ?? [];
      const buscado = name.toLowerCase().trim();
      const matches = projects
        .filter((project: any) =>
          String(project?.name ?? "").toLowerCase().includes(buscado),
        )
        .map(resumirProyecto);

      return JSON.stringify({
        success: true,
        matches,
        message: matches.length
          ? `Se encontraron ${matches.length} proyecto(s) que coinciden con '${name}'.`
          : `No existe ningún proyecto GNS3 cuyo nombre contenga '${name}'. Usa 'listGns3Projects' para ver los nombres reales disponibles.`,
      });
    } catch (error: any) {
      throw new Error(
        `Error buscando el proyecto GNS3 '${name}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "findGns3Project",
    description:
      "Find GNS3 projects by partial name (case-insensitive) and return their project_id; returns an empty match list instead of an error.",
    schema: z.object({
      name: z
        .string()
        .describe("Lab name or partial name to search (e.g. 'aprendiendo-1')"),
    }),
  },
);

const getGns3ProjectTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const project = await client.getProject(projectId);

      const [nodes, links] = await Promise.allSettled([
        client.getNodes(projectId),
        client.getLinks(projectId),
      ]);

      return JSON.stringify({
        success: true,
        project: {
          project_id: project?.project_id,
          name: project?.name,
          status: project?.status,
        },
        counts: {
          nodes:
            nodes.status === "fulfilled" ? (nodes.value?.length ?? null) : null,
          links:
            links.status === "fulfilled" ? (links.value?.length ?? null) : null,
        },
      });
    } catch (error: any) {
      throw new Error(
        `Error consultando el proyecto GNS3 '${projectId}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "getGns3Project",
    description:
      "Get one GNS3 project's summary (project_id, name, status) plus node and link counts; use it to check the lab state before operating.",
    schema: z.object({
      projectId: z.string().describe("GNS3 project id (from listGns3Projects)"),
    }),
  },
);

const openGns3ProjectTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const project = await client.openProject(projectId);
      await setActiveProject(projectId);
      return JSON.stringify({
        success: true,
        message: "Proyecto abierto y marcado como activo.",
        project,
      });
    } catch (error: any) {
      throw new Error(
        `Error abriendo el proyecto GNS3 '${projectId}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "openGns3Project",
    description:
      "Open a GNS3 project and set it as the chat's active project; use it before powering on nodes, since other tools default to that project.",
    schema: z.object({
      projectId: z
        .string()
        .describe("GNS3 project id to open (from listGns3Projects)"),
    }),
  },
);

const closeGns3ProjectTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const project = await client.closeProject(projectId);
      return JSON.stringify({
        success: true,
        message: `Proyecto '${projectId}' cerrado.`,
        project,
      });
    } catch (error: any) {
      throw new Error(
        `Error cerrando el proyecto GNS3 '${projectId}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "closeGns3Project",
    description:
      "Close an open GNS3 project (nodes shut down, topology is kept); use it only when the user wants to free server resources.",
    schema: z.object({
      projectId: z.string().describe("GNS3 project id to close"),
    }),
  },
);

const deleteGns3ProjectTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const result = await client.deleteProject(projectId);
      return JSON.stringify({
        success: true,
        message: `Proyecto '${projectId}' eliminado definitivamente.`,
        result,
      });
    } catch (error: any) {
      throw new Error(
        `Error eliminando el proyecto GNS3 '${projectId}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "deleteGns3Project",
    description:
      "Permanently delete a GNS3 project and all its content (irreversible); use it only when the user explicitly asks and confirms which project.",
    schema: z.object({
      projectId: z.string().describe("GNS3 project id to delete"),
    }),
  },
);

const createGns3ProjectTool = tool(
  async ({ name }) => {
    try {
      const client = await getGns3Client();
      const project = await client.createProject(name);

      if (project?.project_id) await setActiveProject(project.project_id);
      return JSON.stringify({
        success: true,
        message: `Proyecto '${name}' creado.`,
        project,
      });
    } catch (error: any) {

      throw new Error(
        `Error creando el proyecto GNS3 '${name}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "createGns3Project",
    description:
      "Create a new empty GNS3 lab; use it only when the user asks for a new lab, otherwise locate the existing one with listGns3Projects/findGns3Project.",
    schema: z.object({
      name: z.string().describe("Name of the new network lab (e.g. 'lab-ospf')"),
    }),
  },
);

const createGns3NodeTool = tool(
  async ({ projectId, name, nodeType, templateId }) => {
    try {
      const client = await getGns3Client();
      const node = await client.createNode(
        projectId,
        name,
        nodeType,
        templateId,
      );
      return JSON.stringify({
        success: true,
        message: `Dispositivo '${name}' instanciado.`,
        node,
      });
    } catch (error: any) {
      throw new Error(
        `Error instanciando el nodo '${name}' en GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "createGns3Node",
    description:
      "Create a new node/device (router, switch, vpcs, firewall) inside an existing GNS3 project; use it to add devices to the lab.",
    schema: z.object({
      projectId: z.string().describe("Active GNS3 project id"),
      name: z
        .string()
        .describe("Device name (e.g. R1, SW-Core)"),
      nodeType: z
        .string()
        .describe("Virtualization type: 'dynamips', 'qemu', 'vpcs' or 'iou'"),
      templateId: z
        .string()
        .optional()
        .describe("Optional id of a preconfigured device template"),
    }),
  },
);

const connectGns3NodesTool = tool(
  async ({ projectId, nodeAId, adapterA, portA, nodeBId, adapterB, portB }) => {
    try {
      const client = await getGns3Client();
      const link = await client.createLink(
        projectId,
        nodeAId,
        adapterA,
        portA,
        nodeBId,
        adapterB,
        portB,
      );
      return JSON.stringify({
        success: true,
        message: "Enlace físico establecido exitosamente.",
        link,
      });
    } catch (error: any) {
      throw new Error(
        `Error conectando los nodos en GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "connectGns3Nodes",
    description:
      "Connect two GNS3 devices with a virtual cable, specifying the adapter and port on each side; use it to build the lab topology.",
    schema: z.object({
      projectId: z.string().describe("GNS3 project id"),
      nodeAId: z.string().describe("Id of the first node"),
      adapterA: z
        .number()
        .int()
        .describe("Adapter number of the first node (usually 0)"),
      portA: z
        .number()
        .int()
        .describe("Interface port number of the first node"),
      nodeBId: z.string().describe("Id of the second node"),
      adapterB: z
        .number()
        .int()
        .describe("Adapter number of the second node"),
      portB: z
        .number()
        .int()
        .describe("Interface port number of the second node"),
    }),
  },
);

const controlGns3NodePowerTool = tool(
  async ({ projectId, nodeId, action }) => {
    try {
      const client = await getGns3Client();
      if (action === "start") {
        await client.startNode(projectId, nodeId);
      } else {
        await client.stopNode(projectId, nodeId);
      }
      return JSON.stringify({
        success: true,
        message: `Dispositivo puesto en estado: ${action}`,
      });
    } catch (error: any) {
      throw new Error(
        `Error cambiando el estado del nodo GNS3 a '${action}': ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "controlGns3NodePower",
    description: "Start or stop a GNS3 node by projectId and nodeId; use it to power devices on before sending console commands.",
    schema: z.object({
      projectId: z.string().describe("GNS3 project id"),
      nodeId: z.string().describe("Node id"),
      action: z
        .enum(["start", "stop"])
        .describe("'start' to power the node on, 'stop' to power it off"),
    }),
  },
);

const getGns3TemplatesTool = tool(
  async () => {
    try {
      const client = await getGns3Client();
      const templates = await client.getTemplates();

      const summary = templates.map((t: any) => ({
        template_id: t.template_id,
        name: t.name,
        category: t.category,
        node_type: t.node_type,
      }));
      return JSON.stringify({ success: true, templates: summary });
    } catch (error: any) {
      throw new Error(
        `Error listando las plantillas GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "getGns3Templates",
    description:
      "List every device template available on the GNS3 server (IOSv, Cisco, Mikrotik, Linux, VPCS); use it to get template_id before creating a node.",
    schema: z.object({}),
  },
);

const listGns3NodesTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const nodes = await client.getNodes(projectId);
      const summary = nodes.map((n: any) => ({
        node_id: n.node_id,
        name: n.name,
        status: n.status,
        console_host: n.console_host, // Host donde escucha la consola del nodo
        console: n.console, // Puerto Telnet/VNC asignado
        x: n.x,
        y: n.y,
      }));
      return JSON.stringify({ success: true, nodes: summary });
    } catch (error: any) {
      throw new Error(
        `Error listando los nodos del proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "listGns3Nodes",
    description:
      "List all nodes of a GNS3 project with status (started/stopped), console host, console port and coordinates; use it to get node ids and names.",
    schema: z.object({
      projectId: z.string().describe("Active GNS3 project id"),
    }),
  },
);

const listGns3LinksTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const links = await client.getLinks(projectId);
      const summary = links.map((l: any) => ({
        link_id: l.link_id,
        nodes: l.nodes.map(
          (n: any) =>
            `Node: ${n.node_id} en Puerto/Interface: ${n.port_number}`,
        ),
      }));
      return JSON.stringify({ success: true, links: summary });
    } catch (error: any) {
      throw new Error(
        `Error listando los enlaces del proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "listGns3Links",
    description:
      "List the virtual links between devices of a GNS3 project with link_id and endpoint ports; use it to find cables before capturing or deleting.",
    schema: z.object({
      projectId: z.string().describe("Active GNS3 project id"),
    }),
  },
);

const testGns3ConnectivityTool = tool(
  async ({ host, port, timeoutMs, label }) => {
    const limiteMs = timeoutMs ?? 5000;
    const inicio = Date.now();

    const resultado = await new Promise<Record<string, unknown>>((resolve) => {
      const socket = new Socket();
      let finalizado = false;

      const finalizar = (payload: Record<string, unknown>) => {
        if (finalizado) return;
        finalizado = true;
        socket.destroy();
        resolve(payload);
      };

      socket.setTimeout(limiteMs);

      socket.once("connect", () => {
        finalizar({ reachable: true, latencyMs: Date.now() - inicio });
      });
      socket.once("timeout", () => {
        finalizar({ reachable: false, error: "timeout" });
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        finalizar({ reachable: false, error: error.code ?? error.message });
      });

      try {
        socket.connect(port, host);
      } catch (error: any) {
        finalizar({
          reachable: false,
          error: error?.code ?? error?.message ?? "desconocido",
        });
      }
    });

    return JSON.stringify({
      host,
      port,
      ...(label ? { label } : {}),
      ...resultado,
    });
  },
  {
    name: "testGns3Connectivity",
    description:
      "Check whether a GNS3 node TCP port (Telnet/VNC console, RDP, SSH) is open; use it after powering a node on to verify its console responds. Never throws.",
    schema: z.object({
      host: z
        .string()
        .describe("Node host/IP (console_host from listGns3Nodes)"),
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .describe("TCP port to test (console from listGns3Nodes)"),
      timeoutMs: z
        .number()
        .int()
        .min(1)
        .max(20000)
        .default(5000)
        .describe(
          "Timeout in milliseconds (default 5000, max 20000)",
        ),
      label: z
        .string()
        .optional()
        .describe("Optional node label (e.g. R1) to identify the result"),
    }),
  },
);

const sendGns3ConsoleCommandsTool = tool(
  async ({ projectId, nodeId, nodeName, commands }) => {
    try {
      const client = await getGns3Client();

      const proyecto = resolverProyectoActivo(projectId);
      const nodo = await resolverNodo(client, proyecto, nodeId, nodeName);

      if (nodo.status !== "started") {
        throw new Error(
          `El nodo "${nodo.name}" está apagado. Enciéndelo con controlGns3NodePower y reintenta.`,
        );
      }
      if (nodo.console_type !== "telnet") {
        throw new Error(
          `La consola del nodo "${nodo.name}" es de tipo "${nodo.console_type}" y no puede operarse por comandos.`,
        );
      }
      const host =
        typeof nodo.console_host === "string" ? nodo.console_host.trim() : "";
      const puerto = Number(nodo.console);
      if (!host || !Number.isFinite(puerto)) {
        throw new Error(
          `El nodo "${nodo.name}" no tiene una consola Telnet accesible (console/console_host ausentes).`,
        );
      }

      const telnet = new TelnetClient(host, puerto);
      let output = "";
      try {
        output = await telnet.executeCommands(commands);
      } finally {
        await telnet.disconnect().catch(() => undefined);
      }

      return JSON.stringify({
        success: true,
        node: {
          node_id: nodo.node_id,
          name: nodo.name,
          node_type: nodo.node_type,
        },
        console: { host, port: puerto },
        output: output.slice(0, 8000),
      });
    } catch (error: any) {
      throw new Error(
        `Error enviando comandos a la consola GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "sendGns3ConsoleCommands",
    description:
      "Send 1-30 commands to the Telnet console of a started node (IOS/IOSv or VPCS) in the active GNS3 project; requires HITL approval, never closes the session.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
      nodeId: z
        .string()
        .optional()
        .describe("Unique node id (alternative to nodeName)"),
      nodeName: z
        .string()
        .optional()
        .describe(
          "Node name (e.g. R1); exact then partial match, case-insensitive",
        ),
        commands: z
          .array(z.string())
          .min(1)
          .max(30)
          .describe("Console commands to send, in order (1-30)"),
      }),
    },
  );

const listGns3SnapshotsTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const snapshots = (await client.getSnapshots(proyecto)) ?? [];
      return JSON.stringify({
        success: true,
        snapshots: snapshots.map((s: any) => ({
          snapshot_id: s?.snapshot_id,
          name: s?.name,
          created_at: s?.created_at,
        })),
      });
    } catch (error: any) {
      throw new Error(
        `Error listando los snapshots del proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "listGns3Snapshots",
    description:
      "List the snapshots (restore points) of a GNS3 project with snapshot_id, name and creation date; use it before restoring or deleting one.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
    }),
  },
);

const createGns3SnapshotTool = tool(
  async ({ projectId, name }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const snapshot = await client.createSnapshot(proyecto, name);
      const nombreFinal = snapshot?.name ?? name ?? "sin nombre";
      return JSON.stringify({
        success: true,
        message: `Snapshot '${nombreFinal}' creado.`,
        snapshot,
      });
    } catch (error: any) {
      throw new Error(
        `Error creando el snapshot GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "createGns3Snapshot",
    description:
      "Create a snapshot (restore point) of the active GNS3 project before a risky change; the name is optional and GNS3 generates one if omitted.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
      name: z
        .string()
        .optional()
        .describe(
          "Snapshot name (e.g. 'before-ospf'); GNS3 generates one when omitted",
        ),
    }),
  },
);

const restoreGns3SnapshotTool = tool(
  async ({ projectId, snapshotId, snapshotName }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const snapshots = (await client.getSnapshots(proyecto)) ?? [];
      const snapshot = resolverSnapshot(snapshots, snapshotId, snapshotName);
      const result = await client.restoreSnapshot(
        proyecto,
        snapshot.snapshot_id,
      );
      return JSON.stringify({
        success: true,
        message: `Snapshot '${snapshot.name}' restaurado: el laboratorio volvió al estado guardado. Los cambios no guardados desde ese snapshot se perdieron.`,
        snapshot: {
          snapshot_id: snapshot.snapshot_id,
          name: snapshot.name,
        },
        result,
      });
    } catch (error: any) {
      throw new Error(
        `Error restaurando el snapshot GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "restoreGns3Snapshot",
    description:
      "Restore a GNS3 project to a saved snapshot state, discarding unsaved changes (topology and config revert); irreversible, use it to roll back risky changes.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
      snapshotId: z
        .string()
        .optional()
        .describe("Unique snapshot id (alternative to snapshotName)"),
      snapshotName: z
        .string()
        .optional()
        .describe("Snapshot name to restore (case-insensitive)"),
    }),
  },
);

const deleteGns3SnapshotTool = tool(
  async ({ projectId, snapshotId, snapshotName }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const snapshots = (await client.getSnapshots(proyecto)) ?? [];
      const snapshot = resolverSnapshot(snapshots, snapshotId, snapshotName);
      const result = await client.deleteSnapshot(
        proyecto,
        snapshot.snapshot_id,
      );
      return JSON.stringify({
        success: true,
        message: `Snapshot '${snapshot.name}' eliminado.`,
        snapshot: {
          snapshot_id: snapshot.snapshot_id,
          name: snapshot.name,
        },
        result,
      });
    } catch (error: any) {
      throw new Error(
        `Error eliminando el snapshot GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "deleteGns3Snapshot",
    description:
      "Delete a GNS3 snapshot (restore point) identified by snapshotName or snapshotId; it keeps the topology, use it only on explicit request.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
      snapshotId: z
        .string()
        .optional()
        .describe("Unique snapshot id (alternative to snapshotName)"),
      snapshotName: z
        .string()
        .optional()
        .describe("Snapshot name to delete (case-insensitive)"),
    }),
  },
);

const getGns3ProjectStatsTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const stats = (await client.getProjectStats(proyecto)) ?? {};
      return JSON.stringify({
        success: true,
        project: { project_id: proyecto },
        counts: {
          nodes: stats.nodes ?? 0,
          links: stats.links ?? 0,
          snapshots: stats.snapshots ?? 0,
          drawings: stats.drawings ?? 0,
        },
      });
    } catch (error: any) {
      throw new Error(
        `Error consultando las estadísticas del proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "getGns3ProjectStats",
    description:
      "Return quick counts for the active GNS3 project (nodes, links, snapshots, drawings); use it as a light summary without fetching the full topology.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
    }),
  },
);

const listGns3NodeFilesTool = tool(
  async ({ projectId, nodeId, nodeName }) => {
    const client = await getGns3Client();
    const proyecto = resolverProyectoActivo(projectId);
    const nodo = await resolverNodo(client, proyecto, nodeId, nodeName);

    try {
      const archivos = normalizarArchivosNodo(
        (await client.getNodeFiles(proyecto, nodo.node_id, {
          computeId: nodo.compute_id,
          nodeName: nodo.name,
        })) ?? [],
      );
      return JSON.stringify({
        success: true,
        node: { node_id: nodo.node_id, name: nodo.name },
        files: archivos,
      });
    } catch (error: any) {

      return JSON.stringify({
        success: false,
        message: error?.message ?? "desconocido",
        candidates: ARCHIVOS_NODO_CANDIDATOS,
      });
    }
  },
  {
    name: "listGns3NodeFiles",
    description:
      "List a GNS3 node's working files (boot logs, configs) with name and relative path; use it to discover files readable by readGns3NodeLog.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
      nodeId: z
        .string()
        .optional()
        .describe("Unique node id (alternative to nodeName)"),
      nodeName: z
        .string()
        .optional()
        .describe(
          "Node name (e.g. R1); exact then partial match, case-insensitive",
        ),
    }),
  },
);

const readGns3NodeLogTool = tool(
  async ({ projectId, nodeId, nodeName, file }) => {
    const client = await getGns3Client();
    const proyecto = resolverProyectoActivo(projectId);

    const ruta = file?.trim() ?? "";
    const segmentos = ruta.split("/").filter((segmento) => segmento.length > 0);
    const rutaValida =
      ruta.length > 0 &&
      !ruta.includes("\\") &&
      !ruta.startsWith("/") &&
      !/^[a-zA-Z]:/.test(ruta) &&
      segmentos.every((segmento) => segmento !== "." && segmento !== "..");
    if (!rutaValida) {
      throw new Error(
        `Ruta de archivo no permitida: "${file}". Usa una ruta relativa como 'dynamips_i1_log.txt' o 'configs/i1_startup-config.cfg' (sin '..', '\\' ni rutas absolutas).`,
      );
    }

    const nodo = await resolverNodo(client, proyecto, nodeId, nodeName);

    try {

      const contenido = String(
        (await client.readNodeFile(proyecto, nodo.node_id, ruta)) ?? "",
      );
      return JSON.stringify({
        success: true,
        node: { node_id: nodo.node_id, name: nodo.name },
        file: ruta,
        content: contenido.slice(0, 12000),
        truncated: contenido.length > 12000,
      });
    } catch (error: any) {
      const detalle = String(error?.message ?? "");

      if (!/\(404\)/.test(detalle)) {
        throw new Error(`Error leyendo el log del nodo GNS3: ${detalle || "desconocido"}`);
      }

      try {
        const archivos = normalizarArchivosNodo(
          (await client.getNodeFiles(proyecto, nodo.node_id, {
            computeId: nodo.compute_id,
            nodeName: nodo.name,
          })) ?? [],
        );
        return JSON.stringify({
          success: false,
          message: `Archivo no encontrado en el nodo ${nodo.name}.`,
          files: archivos.map((f) => f.path),
        });
      } catch {
        return JSON.stringify({
          success: false,
          message: `Archivo no encontrado. Prueba con: ${ARCHIVOS_NODO_CANDIDATOS.join(", ")}`,
        });
      }
    }
  },
  {
    name: "readGns3NodeLog",
    description:
      "Read a node log file (up to 12000 chars, e.g. 'dynamips_i1_log.txt', 'iou.log') using a relative path; a missing file returns candidates, never an error.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "GNS3 project id; defaults to the chat's active project",
        ),
      nodeId: z
        .string()
        .optional()
        .describe("Unique node id (alternative to nodeName)"),
      nodeName: z
        .string()
        .optional()
        .describe(
          "Node name (e.g. R1); exact then partial match, case-insensitive",
        ),
      file: z
        .string()
        .describe(
          "Relative node file path (e.g. 'dynamips_i1_log.txt', 'iou.log')",
        ),
    }),
  },
);

const getGns3ServerResourcesTool = tool(
  async ({ computeId }) => {
    try {
      const client = await getGns3Client();
      const computo = (await client.getCompute(computeId)) ?? {};
      const compute: Record<string, any> = {};
      if (computo.compute_id !== undefined)
        compute.compute_id = computo.compute_id;
      if (computo.name !== undefined) compute.name = computo.name;
      if (computo.connected !== undefined) compute.connected = computo.connected;
      if (computo.cpu_usage_percent !== undefined)
        compute.cpu_usage_percent = computo.cpu_usage_percent;
      if (computo.memory_usage_percent !== undefined)
        compute.memory_usage_percent = computo.memory_usage_percent;
      return JSON.stringify({ success: true, compute });
    } catch (error: any) {
      throw new Error(
        `Error consultando los recursos del servidor GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "getGns3ServerResources",
    description:
      "Get a GNS3 compute's status (id, name, connected flag, CPU/RAM usage; defaults to 'local'); use it to confirm resources before starting more nodes.",
    schema: z.object({
      computeId: z
        .string()
        .optional()
        .describe(
          "GNS3 compute id; defaults to 'local'",
        ),
    }),
  },
);

const getGns3TemplateTool = tool(
  async ({ templateId, templateName }) => {
    try {
      const client = await getGns3Client();
      const plantilla = await resolverPlantilla(client, templateId, templateName);
      return JSON.stringify({
        success: true,
        template: resumirPlantilla(plantilla),
      });
    } catch (error: any) {
      throw new Error(
        `Error consultando la plantilla GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "getGns3Template",
    description:
      "Get a GNS3 template's details (name, category, node_type, image, console_type, interfaces) by templateName or templateId; use it before editing or deleting.",
    schema: z.object({
      templateId: z
        .string()
        .optional()
        .describe("Unique template id (alternative to templateName)"),
      templateName: z
        .string()
        .optional()
        .describe(
          "Template name (e.g. 'IOSv-L2'); exact then partial match",
        ),
    }),
  },
);

const createGns3TemplateTool = tool(
  async ({ name, cloneFromTemplateId, cloneFromTemplateName }) => {
    try {
      const client = await getGns3Client();
      if (!cloneFromTemplateId?.trim() && !cloneFromTemplateName?.trim()) {
        throw new Error(
          "Para crear una plantilla indica 'cloneFromTemplateName' (o 'cloneFromTemplateId'): GNS3 necesita partir de una plantilla existente para no generar una plantilla incompleta. Usa getGns3Templates para ver las disponibles.",
        );
      }
      const origen = await resolverPlantilla(
        client,
        cloneFromTemplateId,
        cloneFromTemplateName,
      );
      const duplicada = await client.duplicateTemplate(origen.template_id);
      const nuevoId = duplicada?.template_id ?? duplicada?.id;
      if (!nuevoId) {
        throw new Error(
          "GNS3 no devolvió el id de la plantilla duplicada; no se puede renombrar.",
        );
      }
      const creada = await client.updateTemplate(nuevoId, { name });
      return JSON.stringify({
        success: true,
        message: `Plantilla '${name}' creada a partir de '${origen.name}'.`,
        template: resumirPlantilla(creada ?? duplicada),
      });
    } catch (error: any) {
      throw new Error(
        `Error creando la plantilla GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "createGns3Template",
    description:
      "Create a GNS3 device template by cloning an existing one (cloneFromTemplateName/TemplateId) and renaming it; cloning is required for a valid template.",
    schema: z.object({
      name: z
        .string()
        .min(1)
        .describe("New template name (e.g. 'IOSv-Lab-SW')"),
      cloneFromTemplateId: z
        .string()
        .optional()
        .describe("Id of the template to clone (alternative to cloneFromTemplateName)"),
      cloneFromTemplateName: z
        .string()
        .optional()
        .describe("Name of the template to clone (case-insensitive)"),
    }),
  },
);

const updateGns3TemplateTool = tool(
  async ({ templateId, templateName, changes }) => {
    try {
      const client = await getGns3Client();
      if (!changes || Object.keys(changes).length === 0) {
        throw new Error(
          "'changes' no puede estar vacío: indica al menos un campo a modificar (p. ej. { name: \"nuevo-nombre\" }).",
        );
      }
      const plantilla = await resolverPlantilla(client, templateId, templateName);
      const actualizada = await client.updateTemplate(
        plantilla.template_id,
        changes,
      );
      return JSON.stringify({
        success: true,
        message: `Plantilla '${plantilla.name}' actualizada.`,
        template: resumirPlantilla(
          actualizada ?? { ...plantilla, ...changes },
        ),
      });
    } catch (error: any) {
      throw new Error(
        `Error actualizando la plantilla GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "updateGns3Template",
    description:
      "Update the fields of an existing GNS3 template by templateName or templateId, passing only the fields to change in 'changes'; affects new nodes only.",
    schema: z.object({
      templateId: z
        .string()
        .optional()
        .describe("Unique template id (alternative to templateName)"),
      templateName: z
        .string()
        .optional()
        .describe("Template name to update (case-insensitive)"),
      changes: z
        .record(z.string(), z.any())
        .describe(
          "Fields to update as an object (e.g. { \"name\": \"IOSv-L2-v2\" })",
        ),
    }),
  },
);

const deleteGns3TemplateTool = tool(
  async ({ templateId, templateName }) => {
    try {
      const client = await getGns3Client();
      const plantilla = await resolverPlantilla(client, templateId, templateName);
      const resultado = await client.deleteTemplate(plantilla.template_id);
      return JSON.stringify({
        success: true,
        message: `Plantilla '${plantilla.name}' eliminada.`,
        template: {
          template_id: plantilla.template_id,
          name: plantilla.name,
        },
        result: resultado,
      });
    } catch (error: any) {
      throw new Error(
        `Error eliminando la plantilla GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "deleteGns3Template",
    description:
      "Permanently delete a GNS3 device template by templateName or templateId; existing nodes keep working, no new ones can use it; use only on explicit request.",
    schema: z.object({
      templateId: z
        .string()
        .optional()
        .describe("Unique template id (alternative to templateName)"),
      templateName: z
        .string()
        .optional()
        .describe("Template name to delete (case-insensitive)"),
    }),
  },
);

const duplicateGns3TemplateTool = tool(
  async ({ templateId, templateName, newName }) => {
    try {
      const client = await getGns3Client();
      const plantilla = await resolverPlantilla(client, templateId, templateName);
      const duplicada = await client.duplicateTemplate(plantilla.template_id);
      const nuevoId = duplicada?.template_id ?? duplicada?.id;
      const nombreNuevo = newName?.trim();
      let resultado = duplicada;
      if (nombreNuevo) {
        if (!nuevoId) {
          throw new Error(
            "GNS3 no devolvió el id de la plantilla duplicada; no se puede renombrar.",
          );
        }
        resultado = await client.updateTemplate(nuevoId, { name: nombreNuevo });
      }
      return JSON.stringify({
        success: true,
        message: nombreNuevo
          ? `Plantilla '${plantilla.name}' duplicada como '${nombreNuevo}'.`
          : `Plantilla '${plantilla.name}' duplicada.`,
        template: resumirPlantilla(resultado ?? duplicada),
      });
    } catch (error: any) {
      throw new Error(
        `Error duplicando la plantilla GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "duplicateGns3Template",
    description:
      "Duplicate a GNS3 template to work on a copy without touching the original, optionally renaming it with newName; identify it by templateName or templateId.",
    schema: z.object({
      templateId: z
        .string()
        .optional()
        .describe("Source template id (alternative to templateName)"),
      templateName: z
        .string()
        .optional()
        .describe("Source template name (case-insensitive)"),
      newName: z
        .string()
        .optional()
        .describe("Name for the copy; GNS3 keeps the source name if omitted"),
    }),
  },
);

const startGns3LinkCaptureTool = tool(
  async ({ projectId, linkId, nodeA, nodeB }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const enlace = await resolverEnlace(client, proyecto, linkId, nodeA, nodeB);
      const resultado = await client.startLinkCapture(proyecto, enlace.link_id);
      return JSON.stringify({
        success: true,
        message: `Captura de tráfico iniciada en el enlace '${enlace.link_id}'. Genera tráfico y luego ciérrala con stopGns3LinkCapture para descargar el .pcap.`,
        link_id: enlace.link_id,
        result: resultado,
      });
    } catch (error: any) {
      throw new Error(
        `Error iniciando la captura del enlace GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "startGns3LinkCapture",
    description:
      "Start a Wireshark capture on a link of the active project. Pick the link with 'linkId' or with 'nodeA'/'nodeB' (id or name). Requires human approval.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("GNS3 project id; defaults to the chat active project"),
      linkId: z
        .string()
        .optional()
        .describe("Link id (alternative to nodeA/nodeB)"),
      nodeA: z
        .string()
        .optional()
        .describe("First link endpoint (node id or name)"),
      nodeB: z
        .string()
        .optional()
        .describe("Second link endpoint (node id or name)"),
    }),
  },
);

const stopGns3LinkCaptureTool = tool(
  async ({ projectId, linkId, nodeA, nodeB }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const enlace = await resolverEnlace(client, proyecto, linkId, nodeA, nodeB);
      const resultado = await client.stopLinkCapture(proyecto, enlace.link_id);
      return JSON.stringify({
        success: true,
        message: `Captura detenida en el enlace '${enlace.link_id}'. Usa downloadGns3LinkPcap para descargar el .pcap.`,
        link_id: enlace.link_id,
        result: resultado,
      });
    } catch (error: any) {
      throw new Error(
        `Error deteniendo la captura del enlace GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "stopGns3LinkCapture",
    description:
      "Stop the running capture of a link (pick it with 'linkId' or 'nodeA'/'nodeB') so its PCAP can be downloaded.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("GNS3 project id; defaults to the chat active project"),
      linkId: z
        .string()
        .optional()
        .describe("Link id (alternative to nodeA/nodeB)"),
      nodeA: z
        .string()
        .optional()
        .describe("First link endpoint (node id or name)"),
      nodeB: z
        .string()
        .optional()
        .describe("Second link endpoint (node id or name)"),
    }),
  },
);

const getGns3LinkCaptureTool = tool(
  async ({ projectId, linkId, nodeA, nodeB }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const enlace = await resolverEnlace(client, proyecto, linkId, nodeA, nodeB);
      const detalle = (await client.getLink(proyecto, enlace.link_id)) ?? {};
      return JSON.stringify({
        success: true,
        link_id: enlace.link_id,
        capturing: detalle.capturing ?? false,
        filters: detalle.filters ?? {},
      });
    } catch (error: any) {
      throw new Error(
        `Error consultando la captura del enlace GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "getGns3LinkCapture",
    description:
      "Report whether a link of the active project is capturing traffic and which capture filters are applied.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("GNS3 project id; defaults to the chat active project"),
      linkId: z
        .string()
        .optional()
        .describe("Link id (alternative to nodeA/nodeB)"),
      nodeA: z
        .string()
        .optional()
        .describe("First link endpoint (node id or name)"),
      nodeB: z
        .string()
        .optional()
        .describe("Second link endpoint (node id or name)"),
    }),
  },
);

const downloadGns3LinkPcapTool = tool(
  async ({ projectId, linkId, nodeA, nodeB }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const enlace = await resolverEnlace(client, proyecto, linkId, nodeA, nodeB);
      const contenido = await client.downloadLinkPcap(proyecto, enlace.link_id);
      const buffer = Buffer.isBuffer(contenido)
        ? contenido
        : Buffer.from(contenido ?? []);
      await fs.mkdir(GNS3_UPLOADS_DIR, { recursive: true });
      const fileName = `${await slugDeProyecto(client, proyecto)}-${String(enlace.link_id).slice(0, 8)}-${timestampArchivo()}.pcap`;
      await fs.writeFile(path.join(GNS3_UPLOADS_DIR, fileName), buffer);
      return JSON.stringify({
        success: true,
        fileName,
        sizeBytes: buffer.byteLength,
        downloadUrl: `/api/gns3/files/${fileName}`,
      });
    } catch (error: any) {
      throw new Error(
        `Error descargando el pcap del enlace GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "downloadGns3LinkPcap",
    description:
      "Download the PCAP file of a link capture (stop the capture first); returns fileName, sizeBytes and a downloadUrl to open in Wireshark.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("GNS3 project id; defaults to the chat active project"),
      linkId: z
        .string()
        .optional()
        .describe("Link id (alternative to nodeA/nodeB)"),
      nodeA: z
        .string()
        .optional()
        .describe("First link endpoint (node id or name)"),
      nodeB: z
        .string()
        .optional()
        .describe("Second link endpoint (node id or name)"),
    }),
  },
);

const exportGns3ProjectTool = tool(
  async ({ projectId }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      let contenido: any;
      try {
        contenido = await client.exportProject(proyecto);
      } catch (error: any) {

        const detalle = String(error?.message ?? "").toLowerCase();
        if (detalle.includes("409") || detalle.includes("must be stopped")) {
          return JSON.stringify({
            success: false,
            code: "PROJECT_OPEN",
            message:
              "El proyecto debe estar cerrado para exportarse. Usa closeGns3Project, vuelve a intentar el export y abre el proyecto de nuevo con openGns3Project.",
            retryAfterClose: true,
          });
        }
        throw error;
      }
      const buffer = Buffer.isBuffer(contenido)
        ? contenido
        : Buffer.from(contenido ?? []);
      await fs.mkdir(GNS3_UPLOADS_DIR, { recursive: true });
      const fileName = `${await slugDeProyecto(client, proyecto)}-${timestampArchivo()}.gns3project`;
      await fs.writeFile(path.join(GNS3_UPLOADS_DIR, fileName), buffer);
      return JSON.stringify({
        success: true,
        message:
          "Proyecto exportado. Descárgalo con 'downloadUrl' para respaldarlo o pásalo a otro servidor GNS3 e impórtalo con importGns3Project.",
        project_id: proyecto,
        fileName,
        sizeBytes: buffer.byteLength,
        downloadUrl: `/api/gns3/files/${fileName}`,
      });
    } catch (error: any) {
      throw new Error(
        `Error exportando el proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "exportGns3Project",
    description:
      "Export the whole project (topology, configuration and artifacts) to a .gns3project file; returns fileName, sizeBytes and downloadUrl. GNS3 requires the project closed: on 'PROJECT_OPEN' close it, export and reopen.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("GNS3 project id; defaults to the chat active project"),
    }),
  },
);

const importGns3ProjectTool = tool(
  async ({ fileName, name }) => {
    try {
      const client = await getGns3Client();

      const archivo = fileName?.trim() ?? "";
      if (
        !archivo ||
        !/^[A-Za-z0-9._-]+$/.test(archivo) ||
        !archivo.toLowerCase().endsWith(".gns3project")
      ) {
        throw new Error(
          `Nombre de archivo no permitido: "${fileName}". Debe ser un .gns3project generado por exportGns3Project (sin rutas ni '..').`,
        );
      }

      const rutaAbsoluta = path.resolve(GNS3_UPLOADS_DIR, archivo);
      if (!rutaAbsoluta.startsWith(GNS3_UPLOADS_DIR + path.sep)) {
        throw new Error(`Nombre de archivo no permitido: "${fileName}".`);
      }

      let buffer: Buffer;
      try {
        buffer = await fs.readFile(rutaAbsoluta);
      } catch {
        throw new Error(
          `No existe el archivo "${archivo}" en el directorio de exportaciones. Genera uno primero con exportGns3Project.`,
        );
      }

      const nombreProyecto =
        name?.trim() || path.basename(archivo, ".gns3project");
      const proyecto = await client.createProject(nombreProyecto);
      const projectId = proyecto?.project_id;
      if (!projectId) {
        throw new Error(
          "GNS3 no devolvió el project_id del proyecto creado para importar el archivo.",
        );
      }
      const importado = await client.importProject(projectId, buffer);
      return JSON.stringify({
        success: true,
        message: `Proyecto '${nombreProyecto}' importado desde '${archivo}'.`,
        project: importado ?? proyecto,
      });
    } catch (error: any) {
      throw new Error(
        `Error importando el proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "importGns3Project",
    description:
      "Import a .gns3project file from the export directory into a new project on this server (topology and configuration included); 'fileName' must be a plain name with the .gns3project extension.",
    schema: z.object({
      fileName: z
        .string()
        .describe(
          "Name of the .gns3project file in the export directory (e.g. 'lab-redes-20260918120000.gns3project')",
        ),
      name: z
        .string()
        .optional()
        .describe("Name for the imported project; defaults to the file name"),
    }),
  },
);

const autoLayoutGns3ProjectTool = tool(
  async ({ projectId, spacingX, spacingY, margin }) => {
    try {
      const client = await getGns3Client();
      const proyecto = resolverProyectoActivo(projectId);
      const nodos = (await client.getNodes(proyecto)) ?? [];
      const enlaces = (await client.getLinks(proyecto)) ?? [];

      const adyacencia = new Map<string, Set<string>>();
      const tipoPorNodo = new Map<string, string>();
      for (const nodo of nodos) {
        const id = String(nodo?.node_id ?? "");
        if (!id) continue;
        adyacencia.set(id, new Set());
        tipoPorNodo.set(id, String(nodo?.node_type ?? ""));
      }
      for (const enlace of enlaces) {
        const extremos = (enlace?.nodes ?? [])
          .map((n: any) => String(n?.node_id ?? ""))
          .filter((id: string) => adyacencia.has(id));
        for (const origen of extremos) {
          for (const destino of extremos) {
            if (origen !== destino) adyacencia.get(origen)!.add(destino);
          }
        }
      }

      const ids = [...adyacencia.keys()];
      const grado = (id: string) => adyacencia.get(id)?.size ?? 0;

      const noNubes = ids.filter((id) => tipoPorNodo.get(id) !== "cloud");
      const candidatosRaiz = (noNubes.length > 0 ? noNubes : ids)
        .slice()
        .sort((a, b) => grado(b) - grado(a));
      const gradoMaximo =
        candidatosRaiz.length > 0 ? grado(candidatosRaiz[0]) : 0;
      const raices = candidatosRaiz.filter((id) => grado(id) === gradoMaximo);

      const nivel = new Map<string, number>();
      const cola: string[] = [];
      for (const raiz of raices) {
        nivel.set(raiz, 0);
        cola.push(raiz);
      }
      for (let i = 0; i < cola.length; i++) {
        const actual = cola[i];
        const siguiente = (nivel.get(actual) ?? 0) + 1;
        for (const vecino of adyacencia.get(actual) ?? []) {
          if (!nivel.has(vecino)) {
            nivel.set(vecino, siguiente);
            cola.push(vecino);
          }
        }
      }

      const posiciones = new Map<string, { x: number; y: number }>();
      const indicePorNivel = new Map<number, number>();
      let maxNivel = 0;
      for (const id of ids) {
        const nivelNodo = nivel.get(id);
        if (nivelNodo === undefined) continue;
        const indice = indicePorNivel.get(nivelNodo) ?? 0;
        indicePorNivel.set(nivelNodo, indice + 1);
        maxNivel = Math.max(maxNivel, nivelNodo);
        posiciones.set(id, {
          x: margin + nivelNodo * spacingX,
          y: margin + indice * spacingY,
        });
      }
      const columnaExtra = maxNivel + (nivel.size > 0 ? 1 : 0);
      let indiceExtra = 0;
      for (const id of ids) {
        if (nivel.has(id)) continue;
        posiciones.set(id, {
          x: margin + columnaExtra * spacingX,
          y: margin + indiceExtra * spacingY,
        });
        indiceExtra += 1;
      }

      let moved = 0;
      for (const [id, posicion] of posiciones) {
        await client.updateNode(proyecto, id, posicion);
        moved += 1;
      }

      return JSON.stringify({
        success: true,
        message: `Topología reordenada: ${moved} nodo(s) reposicionado(s).`,
        moved,
      });
    } catch (error: any) {
      throw new Error(
        `Error aplicando el auto-layout al proyecto GNS3: ${error?.message ?? "desconocido"}`,
      );
    }
  },
  {
    name: "autoLayoutGns3Project",
    description:
      "Re-layout every node of the active project into BFS columns by connection level; unconnected nodes are placed last. Prevents overlapping node positions.",
    schema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("GNS3 project id; defaults to the chat active project"),
      spacingX: z
        .number()
        .int()
        .min(40)
        .max(2000)
        .default(220)
        .describe("Horizontal spacing between columns in pixels (default 220)"),
      spacingY: z
        .number()
        .int()
        .min(40)
        .max(2000)
        .default(140)
        .describe("Vertical spacing between nodes in pixels (default 140)"),
      margin: z
        .number()
        .int()
        .min(0)
        .max(2000)
        .default(60)
        .describe("Initial margin from the canvas border in pixels (default 60)"),
    }),
  },
);

export const GNS3_TOOLS_ADMIN = [
  listGns3ProjectsTool,
  findGns3ProjectTool,
  getGns3ProjectTool,
  openGns3ProjectTool,
  closeGns3ProjectTool,
  deleteGns3ProjectTool,
  createGns3ProjectTool,
  createGns3NodeTool,
  connectGns3NodesTool,
  controlGns3NodePowerTool,
  getGns3TemplatesTool,
  listGns3NodesTool,
  listGns3LinksTool,
  testGns3ConnectivityTool,
  sendGns3ConsoleCommandsTool,
  openGns3ConsoleTool,

  listGns3SnapshotsTool,
  createGns3SnapshotTool,
  restoreGns3SnapshotTool,
  deleteGns3SnapshotTool,
  getGns3ProjectStatsTool,
  listGns3NodeFilesTool,
  readGns3NodeLogTool,
  getGns3ServerResourcesTool,

  getGns3TemplateTool,
  createGns3TemplateTool,
  updateGns3TemplateTool,
  deleteGns3TemplateTool,
  duplicateGns3TemplateTool,
  startGns3LinkCaptureTool,
  stopGns3LinkCaptureTool,
  getGns3LinkCaptureTool,
  downloadGns3LinkPcapTool,
  exportGns3ProjectTool,
  importGns3ProjectTool,
  autoLayoutGns3ProjectTool,

  ...TERMINAL_TOOLS,
  ...CONNECTION_TOOLS,
  searchKnowledgeBaseTool,
];
