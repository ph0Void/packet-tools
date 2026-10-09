/**
 * Dominio `@gns3`: proyectos, nodos, enlaces y snapshots del servidor GNS3.
 *
 * PROCEDENCIA: las operaciones y sus rutas salen de
 * `packages/server/src/client/Gns3Client.ts`, que es la implementación probada
 * contra el API real. Aquí solo cambia de dónde salen las credenciales (la BD
 * propia del MCP) y se añade el prefijo `gns3_` a los nombres.
 *
 * CONCEPTO IMPORTANTE: casi todas las operaciones necesitan un `projectId`. Para
 * no obligar al modelo a recordarlo en cada llamada, se guarda el proyecto
 * activo en memoria: al abrir o crear uno, pasa a ser el de por defecto. Aun así
 * todas las herramientas aceptan `projectId` explícito.
 */
import { z } from "zod";
import type { ModuloDominio, DefinicionToolGenerica } from "@/core/ToolRegistry";
import { definirTool } from "@/core/ToolRegistry";
import { crearClienteGns3, resolverCredencialesGns3 } from "./Gns3McpClient";
import { Logger } from "@/utils/Logger";
import { McpToolError } from "@/core/errors";
import { prismaClient } from "@/prisma/lib/PrismaClient";

/**
 * Proyecto activo, por servidor.
 *
 * Se indexa por proveedor (o por URL cuando no hay fila) para que trabajar con
 * dos servidores GNS3 a la vez no haga que uno herede el proyecto del otro.
 */
const proyectosActivos = new Map<string, string>();

/**
 * Clave del proyecto activo para un proveedor dado.
 */
async function claveProyecto(providerId?: string | null): Promise<string> {
  if (providerId?.trim()) return providerId.trim();
  const credenciales = await resolverCredencialesGns3(null);
  return credenciales.baseUrl;
}

/**
 * Recuerda el proyecto activo.
 */
async function recordarProyecto(
  providerId: string | null | undefined,
  projectId: string,
): Promise<void> {
  proyectosActivos.set(await claveProyecto(providerId), projectId);
}

/**
 * Resuelve el proyecto objetivo: el explícito manda; si no, el activo.
 * Si no hay ninguno, se lanza un error que le dice al modelo exactamente qué
 * hacer (listar y abrir), en vez de un "falta projectId" seco.
 */
async function resolverProyecto(
  providerId: string | null | undefined,
  projectId?: string,
): Promise<string> {
  const explicito = projectId?.trim();
  if (explicito) return explicito;
  const activo = proyectosActivos.get(await claveProyecto(providerId));
  if (activo) return activo;
  throw new McpToolError(
    "NO_ENCONTRADO",
    "No hay ningún proyecto GNS3 activo y no se indicó 'projectId'.",
    {
      sugerencia:
        "Llama primero a gns3_list_projects para ver los proyectos disponibles y luego a gns3_open_project con el 'projectId' elegido; a partir de ahí las demás herramientas ya sabrán cuál usar. También puedes pasar 'projectId' explícitamente en cada llamada.",
    },
  );
}

/**
 * Resuelve un nodo por id o por nombre.
 *
 * POR QUÉ POR NOMBRE: el modelo casi nunca conoce el `node_id` (es un UUID),
 * pero sí el nombre que puso el usuario ("R1", "SW1"). Se acepta coincidencia
 * exacta sin distinguir mayúsculas y, si no hay, parcial; ante AMBIGÜEDAD se
 * rechaza y se listan los candidatos, porque elegir uno al azar en un equipo de
 * red es peor que preguntar.
 */
async function resolverNodo(
  cliente: Awaited<ReturnType<typeof crearClienteGns3>>,
  projectId: string,
  nodeId?: string,
  nodeName?: string,
): Promise<Record<string, unknown>> {
  const nodos = ((await cliente.get(`/projects/${projectId}/nodes`)) ?? []) as Array<
    Record<string, unknown>
  >;
  if (nodeId?.trim()) {
    const encontrado = nodos.find((n) => n?.node_id === nodeId.trim());
    if (!encontrado) {
      throw new McpToolError(
        "NO_ENCONTRADO",
        `No existe ningún nodo con node_id '${nodeId}' en el proyecto.`,
        { sugerencia: "Usa gns3_list_nodes para ver los nodos reales del proyecto." },
      );
    }
    return encontrado;
  }
  const buscado = nodeName?.trim().toLowerCase();
  if (!buscado) {
    throw new McpToolError(
      "VALIDACION",
      "Hay que indicar 'nodeId' o 'nodeName' para elegir el nodo.",
      { sugerencia: "Los nombres son los que ves en la interfaz de GNS3; si no los recuerdas, usa gns3_list_nodes." },
    );
  }
  const exactos = nodos.filter((n) => String(n?.name ?? "").toLowerCase() === buscado);
  const candidatos =
    exactos.length > 0
      ? exactos
      : nodos.filter((n) => String(n?.name ?? "").toLowerCase().includes(buscado));
  if (candidatos.length === 0) {
    throw new McpToolError(
      "NO_ENCONTRADO",
      `Ningún nodo del proyecto se llama '${nodeName}'.`,
      { sugerencia: "Usa gns3_list_nodes para ver los nombres reales." },
    );
  }
  if (candidatos.length > 1) {
    const nombres = candidatos.map((n) => `"${n?.name}"`).join(", ");
    throw new McpToolError(
      "VALIDACION",
      `Varios nodos coinciden con '${nodeName}': ${nombres}.`,
      { sugerencia: "Repite la llamada indicando 'nodeId' para elegir uno sin ambigüedad." },
    );
  }
  return candidatos[0];
}

/**
 * Argumento común: servidor GNS3 concreto (opcional).
 */
const argProviderId = z
  .string()
  .optional()
  .describe("Id del dispositivo GNS3 configurado en el MCP; omítelo si solo tienes uno");

/**
 * Argumento común: proyecto (opcional si ya hay uno activo).
 */
const argProjectId = z
  .string()
  .optional()
  .describe("Id del proyecto GNS3; omítelo para usar el proyecto activo");

const herramientas: DefinicionToolGenerica[] = [
  // -------------------------------------------------------------------------
  // Servidor y proyectos
  // -------------------------------------------------------------------------
  definirTool({
    name: "gns3_list_configured_servers",
    description:
      "Lista los servidores GNS3 configurados en el MCP (con su id, nombre y URL). " +
      "Úsala cuando tengas varias instalaciones de GNS3 y necesites saber a cuál dirigirte.",
    inputSchema: {},
    handler: async () => {
      const filas = await prismaClient.deviceProviderMcp.findMany({
        where: { typeDevice: "GNS3" },
        select: { id: true, name: true, host: true, username: true, status: true },
      });
      const porDefecto = await resolverCredencialesGns3(null);
      return {
        success: true,
        configurados: filas.map((fila) => ({
          id: fila.id,
          nombre: fila.name,
          url: fila.host,
          usuario: fila.username,
          estado: fila.status,
        })),
        total: filas.length,
        urlPorDefecto: porDefecto.baseUrl,
        mensaje:
          filas.length === 0
            ? "No hay ningún servidor GNS3 configurado, así que se usará la URL por defecto. Si tu GNS3 está en otra dirección, configúralo para que el MCP lo encuentre."
            : "Pasa el 'id' de uno de estos servidores como 'providerId' para dirigirte a él.",
      };
    },
  }),
  definirTool({
    name: "gns3_test_connection",
    description:
      "Comprueba que el servidor GNS3 responde y devuelve su versión. " +
      "Úsala primero, para distinguir 'GNS3 no está disponible' de 'el proyecto no existe'.",
    inputSchema: { providerId: argProviderId },
    handler: async ({ providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      try {
        const version = await cliente.get("/version");
        return {
          success: true,
          conectado: true,
          url: cliente.url,
          version,
        };
      } catch (error) {
        if (error instanceof McpToolError) {
          // Se devuelve en vez de lanzar: esta herramienta EXISTE para informar
          // del estado de la conexión, así que "no conecta" es un resultado.
          return {
            success: false,
            conectado: false,
            url: cliente.url,
            error: error.message,
            sugerencia: error.sugerencia,
          };
        }
        throw error;
      }
    },
  }),
  definirTool({
    name: "gns3_list_projects",
    description:
      "Lista los proyectos del servidor GNS3. Es el punto de partida: de aquí sale el 'projectId' que necesitan las demás herramientas.",
    inputSchema: { providerId: argProviderId },
    handler: async ({ providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const proyectos = await cliente.get("/projects");
      return { success: true, url: cliente.url, proyectos: proyectos ?? [] };
    },
  }),
  definirTool({
    name: "gns3_find_project",
    description:
      "Busca proyectos GNS3 por nombre (coincidencia parcial, sin distinguir mayúsculas). " +
      "Úsala cuando sepas cómo se llama el proyecto pero no su id.",
    inputSchema: {
      name: z.string().describe("Texto a buscar en el nombre del proyecto"),
      providerId: argProviderId,
    },
    handler: async ({ name, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const proyectos = ((await cliente.get("/projects")) ?? []) as Array<Record<string, unknown>>;
      const buscado = name.trim().toLowerCase();
      const encontrados = proyectos.filter((p) =>
        String(p?.name ?? "").toLowerCase().includes(buscado),
      );
      return {
        success: true,
        encontrados,
        total: encontrados.length,
        ...(encontrados.length === 0
          ? {
              mensaje: `Ningún proyecto contiene '${name}'. Usa gns3_list_projects para ver todos los nombres.`,
            }
          : {}),
      };
    },
  }),
  definirTool({
    name: "gns3_get_project",
    description: "Devuelve los datos de un proyecto GNS3 concreto (estado, número de nodos y enlaces, ruta en disco).",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, proyecto: await cliente.get(`/projects/${id}`) };
    },
  }),
  definirTool({
    name: "gns3_create_project",
    description:
      "Crea un proyecto GNS3 nuevo y lo deja como proyecto activo. " +
      "Úsala para empezar una topología desde cero.",
    inputSchema: {
      name: z.string().describe("Nombre del proyecto nuevo"),
      providerId: argProviderId,
    },
    handler: async ({ name, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const proyecto = (await cliente.post("/projects", { name })) as Record<string, unknown>;
      const id = String(proyecto?.project_id ?? "");
      if (id) await recordarProyecto(providerId, id);
      return {
        success: true,
        proyecto,
        mensaje: id ? `Proyecto '${name}' creado y marcado como activo.` : "Proyecto creado.",
      };
    },
  }),
  definirTool({
    name: "gns3_open_project",
    description:
      "Abre un proyecto GNS3 y lo deja como proyecto ACTIVO, de modo que el resto de herramientas ya sepan sobre cuál operar. " +
      "Úsala después de gns3_list_projects.",
    inputSchema: { projectId: z.string().describe("Id del proyecto a abrir"), providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const resultado = await cliente.post(`/projects/${projectId}/open`);
      await recordarProyecto(providerId, projectId);
      return {
        success: true,
        proyecto: resultado,
        mensaje: `Proyecto '${projectId}' abierto y marcado como activo.`,
      };
    },
  }),
  definirTool({
    name: "gns3_close_project",
    description:
      "Cierra un proyecto GNS3 (apaga sus nodos y libera recursos). No borra nada: el proyecto sigue en disco y se puede reabrir.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, resultado: await cliente.post(`/projects/${id}/close`) };
    },
  }),
  definirTool({
    name: "gns3_delete_project",
    description:
      "ELIMINA un proyecto GNS3 y todo su contenido (nodos, enlaces, snapshots). Es IRREVERSIBLE: " +
      "confírmalo con el usuario antes de llamarla salvo que lo haya pedido él explícitamente. " +
      "Si solo quieres dejarlo apagado, usa gns3_close_project.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, resultado: await cliente.del(`/projects/${id}`) };
    },
  }),
  definirTool({
    name: "gns3_get_project_stats",
    description: "Devuelve estadísticas de un proyecto GNS3 (número de nodos, enlaces y su estado).",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, estadisticas: await cliente.get(`/projects/${id}/stats`) };
    },
  }),
  definirTool({
    name: "gns3_get_server_resources",
    description:
      "Consulta los recursos del servidor GNS3 (CPU, memoria y disco). " +
      "Úsala antes de levantar topologías grandes, para saber si el servidor aguantará.",
    inputSchema: { providerId: argProviderId },
    handler: async ({ providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      // El endpoint de recursos es del COMPUTE (el que ejecuta las máquinas),
      // no del controlador: se toma el primero disponible.
      const computos = ((await cliente.get("/computes")) ?? []) as Array<Record<string, unknown>>;
      const computeId = String(computos[0]?.compute_id ?? "local");
      return {
        success: true,
        computos,
        recursos: await cliente.get(`/computes/${computeId}/resources`),
      };
    },
  }),

  // -------------------------------------------------------------------------
  // Nodos
  // -------------------------------------------------------------------------
  definirTool({
    name: "gns3_list_nodes",
    description:
      "Lista los nodos (dispositivos) de un proyecto GNS3, con su id, nombre, tipo, plantilla y estado de encendido. " +
      "Úsala para descubrir los nombres reales antes de operar sobre ellos.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const nodos = (await cliente.get(`/projects/${id}/nodes`)) ?? [];
      return { success: true, proyectId: id, nodos };
    },
  }),
  definirTool({
    name: "gns3_get_templates",
    description:
      "Lista las plantillas de dispositivo disponibles en el servidor GNS3 (routers, switches, hosts...). " +
      "Úsala antes de crear un nodo: el 'templateId' tiene que ser uno de estos.",
    inputSchema: { providerId: argProviderId },
    handler: async ({ providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      return { success: true, plantillas: (await cliente.get("/templates")) ?? [] };
    },
  }),
  definirTool({
    name: "gns3_create_node",
    description:
      "Crea un nodo (dispositivo) en un proyecto GNS3 a partir de una plantilla. " +
      "El nombre debe ser único dentro del proyecto. Usa gns3_get_templates para conocer el 'templateId'.",
    inputSchema: {
      name: z.string().describe("Nombre del nodo nuevo, por ejemplo 'R1'"),
      templateId: z.string().describe("Id de la plantilla a usar (de gns3_get_templates)"),
      x: z.number().optional().describe("Posición X en el lienzo (por defecto 0)"),
      y: z.number().optional().describe("Posición Y en el lienzo (por defecto 0)"),
      computeId: z.string().optional().describe("Id del compute donde ejecutarlo (por defecto 'local')"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ name, templateId, x, y, computeId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const nodo = await cliente.post(`/projects/${id}/templates/${templateId}`, {
        name,
        x: x ?? 0,
        y: y ?? 0,
        compute_id: computeId ?? "local",
      });
      return { success: true, nodo };
    },
  }),
  definirTool({
    name: "gns3_control_node_power",
    description:
      "Enciende, apaga, suspende o reinicia un nodo GNS3. " +
      "Usa gns3_list_nodes para el nombre o el id si no los recuerdas.",
    inputSchema: {
      action: z
        .enum(["start", "stop", "suspend", "reload"])
        .describe("Acción de energía a aplicar"),
      nodeId: z.string().optional().describe("Id del nodo"),
      nodeName: z.string().optional().describe("Nombre del nodo (alternativa a nodeId)"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ action, nodeId, nodeName, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const nodo = await resolverNodo(cliente, id, nodeId, nodeName);
      const nodeIdReal = String(nodo.node_id);
      const resultado = await cliente.post(`/projects/${id}/nodes/${nodeIdReal}/${action}`);
      return {
        success: true,
        nodo: nodo.name,
        accion: action,
        resultado,
      };
    },
  }),
  definirTool({
    name: "gns3_list_node_files",
    description: "Lista los archivos asociados a un nodo GNS3 (por ejemplo, sus imágenes o sus logs).",
    inputSchema: {
      nodeId: z.string().optional().describe("Id del nodo"),
      nodeName: z.string().optional().describe("Nombre del nodo (alternativa a nodeId)"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ nodeId, nodeName, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const nodo = await resolverNodo(cliente, id, nodeId, nodeName);
      return {
        success: true,
        archivos: await cliente.get(`/projects/${id}/nodes/${String(nodo.node_id)}/files`),
      };
    },
  }),
  definirTool({
    name: "gns3_read_node_log",
    description:
      "Lee el log de un nodo GNS3. Es la forma de ver POR QUÉ un dispositivo no arranca o por qué una imagen falla.",
    inputSchema: {
      nodeId: z.string().optional().describe("Id del nodo"),
      nodeName: z.string().optional().describe("Nombre del nodo (alternativa a nodeId)"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ nodeId, nodeName, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const nodo = await resolverNodo(cliente, id, nodeId, nodeName);
      const nodeIdReal = String(nodo.node_id);
      const archivos = ((await cliente.get(`/projects/${id}/nodes/${nodeIdReal}/files`)) ?? []) as string[];
      const archivoLog = archivos.find((f) => /\.log$/i.test(String(f)));
      if (!archivoLog) {
        return {
          success: false,
          error: `El nodo '${nodo.name}' no tiene ningún archivo .log.`,
          archivosDisponibles: archivos,
        };
      }
      return {
        success: true,
        nodo: nodo.name,
        archivo: archivoLog,
        contenido: await cliente.get(
          `/projects/${id}/nodes/${nodeIdReal}/files/${encodeURIComponent(archivoLog)}`,
          "text",
        ),
      };
    },
  }),

  // -------------------------------------------------------------------------
  // Enlaces
  // -------------------------------------------------------------------------
  definirTool({
    name: "gns3_list_links",
    description: "Lista los enlaces (cables) de un proyecto GNS3, con los nodos y adaptadores que conectan.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, enlaces: (await cliente.get(`/projects/${id}/links`)) ?? [] };
    },
  }),
  definirTool({
    name: "gns3_connect_nodes",
    description:
      "Conecta dos nodos GNS3 con un cable. Hay que indicar el adaptador y el puerto de cada extremo " +
      "(normalmente adaptador 0 y puerto 0 para la primera interfaz). " +
      "Consulta gns3_list_nodes si no sabes qué adaptadores tiene cada nodo.",
    inputSchema: {
      node1Name: z.string().optional().describe("Nombre del primer nodo"),
      node1Id: z.string().optional().describe("Id del primer nodo (alternativa al nombre)"),
      adapter1: z.number().int().min(0).optional().describe("Adaptador del primer nodo (por defecto 0)"),
      port1: z.number().int().min(0).optional().describe("Puerto del primer nodo (por defecto 0)"),
      node2Name: z.string().optional().describe("Nombre del segundo nodo"),
      node2Id: z.string().optional().describe("Id del segundo nodo (alternativa al nombre)"),
      adapter2: z.number().int().min(0).optional().describe("Adaptador del segundo nodo (por defecto 0)"),
      port2: z.number().int().min(0).optional().describe("Puerto del segundo nodo (por defecto 0)"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async (args) => {
      const cliente = await crearClienteGns3(args.providerId);
      const id = await resolverProyecto(args.providerId, args.projectId);
      const nodo1 = await resolverNodo(cliente, id, args.node1Id, args.node1Name);
      const nodo2 = await resolverNodo(cliente, id, args.node2Id, args.node2Name);
      const enlace = await cliente.post(`/projects/${id}/links`, {
        nodes: [
          {
            node_id: nodo1.node_id,
            adapter_number: args.adapter1 ?? 0,
            port_number: args.port1 ?? 0,
          },
          {
            node_id: nodo2.node_id,
            adapter_number: args.adapter2 ?? 0,
            port_number: args.port2 ?? 0,
          },
        ],
      });
      return {
        success: true,
        enlace,
        mensaje: `Conectados '${nodo1.name}' y '${nodo2.name}'.`,
      };
    },
  }),
  definirTool({
    name: "gns3_start_link_capture",
    description:
      "Empieza a capturar tráfico en un enlace GNS3. Después se descarga el pcap con gns3_download_link_pcap.",
    inputSchema: {
      linkId: z.string().describe("Id del enlace a capturar (de gns3_list_links)"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ linkId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return {
        success: true,
        captura: await cliente.post(`/projects/${id}/links/${linkId}/capture/start`),
      };
    },
  }),
  definirTool({
    name: "gns3_stop_link_capture",
    description: "Detiene la captura de tráfico de un enlace GNS3.",
    inputSchema: {
      linkId: z.string().describe("Id del enlace"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ linkId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return {
        success: true,
        captura: await cliente.post(`/projects/${id}/links/${linkId}/capture/stop`),
      };
    },
  }),
  definirTool({
    name: "gns3_get_link_capture",
    description: "Consulta el estado de la captura de un enlace GNS3 (si está activa y dónde se guarda el pcap).",
    inputSchema: {
      linkId: z.string().describe("Id del enlace"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ linkId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, captura: await cliente.get(`/projects/${id}/links/${linkId}/capture`) };
    },
  }),
  definirTool({
    name: "gns3_download_link_pcap",
    description:
      "Descarga el archivo pcap de la captura de un enlace y devuelve su tamaño. " +
      "Úsala para analizar el tráfico capturado.",
    inputSchema: {
      linkId: z.string().describe("Id del enlace"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ linkId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const datos = await cliente.get(`/projects/${id}/links/${linkId}/capture/download`, "buffer");
      const buffer = Buffer.isBuffer(datos) ? datos : Buffer.alloc(0);
      return {
        success: true,
        bytes: buffer.length,
        // No se devuelve el binario en base64: inflaría la respuesta y el modelo
        // no puede hacer nada útil con un pcap en texto. El archivo está en el
        // servidor GNS3, que es donde hay que abrirlo con Wireshark.
        mensaje:
          buffer.length > 0
            ? `Captura obtenida (${buffer.length} bytes). El archivo pcap está en el servidor GNS3; ábrelo allí con Wireshark.`
            : "El enlace no tiene ninguna captura disponible.",
      };
    },
  }),

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------
  definirTool({
    name: "gns3_list_snapshots",
    description: "Lista los snapshots (puntos de restauración) de un proyecto GNS3.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, snapshots: (await cliente.get(`/projects/${id}/snapshots`)) ?? [] };
    },
  }),
  definirTool({
    name: "gns3_create_snapshot",
    description:
      "Crea un snapshot de un proyecto GNS3: guarda el estado de todos sus nodos para poder volver a él. " +
      "Úsala antes de hacer cambios arriesgados.",
    inputSchema: {
      name: z.string().describe("Nombre del snapshot"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ name, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return { success: true, snapshot: await cliente.post(`/projects/${id}/snapshots`, { name }) };
    },
  }),
  definirTool({
    name: "gns3_restore_snapshot",
    description:
      "Restaura un proyecto GNS3 a un snapshot: DESCARTA los cambios hechos desde entonces. " +
      "Confírmalo con el usuario si no lo ha pedido él.",
    inputSchema: {
      snapshotId: z.string().describe("Id del snapshot a restaurar"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ snapshotId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return {
        success: true,
        resultado: await cliente.post(`/projects/${id}/snapshots/${snapshotId}/restore`),
      };
    },
  }),
  definirTool({
    name: "gns3_delete_snapshot",
    description: "Elimina un snapshot de un proyecto GNS3. Operación irreversible.",
    inputSchema: {
      snapshotId: z.string().describe("Id del snapshot a eliminar"),
      projectId: argProjectId,
      providerId: argProviderId,
    },
    handler: async ({ snapshotId, projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      return {
        success: true,
        resultado: await cliente.del(`/projects/${id}/snapshots/${snapshotId}`),
      };
    },
  }),

  // -------------------------------------------------------------------------
  // Plantillas (escritura)
  // -------------------------------------------------------------------------
  definirTool({
    name: "gns3_get_template",
    description: "Devuelve el detalle de una plantilla GNS3 (imagen, adaptadores, RAM, consola...).",
    inputSchema: {
      templateId: z.string().describe("Id de la plantilla"),
      providerId: argProviderId,
    },
    handler: async ({ templateId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      return { success: true, plantilla: await cliente.get(`/templates/${templateId}`) };
    },
  }),
  definirTool({
    name: "gns3_create_template",
    description:
      "Crea una plantilla de dispositivo GNS3 nueva. Necesita al menos el nombre, el tipo de plantilla y la imagen o el modelo, " +
      "según el tipo (qemu, docker, dynamips, vpcs...).",
    inputSchema: {
      name: z.string().describe("Nombre de la plantilla"),
      templateType: z
        .string()
        .describe("Tipo de plantilla: 'qemu', 'docker', 'dynamips', 'iou', 'vpcs'..."),
      computeId: z.string().optional().describe("Id del compute donde ejecutarla (por defecto 'local')"),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Propiedades específicas del tipo (imagen, ram, adaptadores...). Se pasan tal cual al API de GNS3."),
      providerId: argProviderId,
    },
    handler: async ({ name, templateType, computeId, properties, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const plantilla = await cliente.post("/templates", {
        name,
        template_type: templateType,
        compute_id: computeId ?? "local",
        ...(properties ?? {}),
      });
      return { success: true, plantilla };
    },
  }),
  definirTool({
    name: "gns3_update_template",
    description:
      "Modifica una plantilla GNS3 existente. Solo se envían los campos indicados, así que no hace falta pasar la plantilla entera.",
    inputSchema: {
      templateId: z.string().describe("Id de la plantilla a modificar"),
      changes: z
        .record(z.string(), z.unknown())
        .describe("Campos a cambiar, tal cual los entiende el API de GNS3 (por ejemplo {name, ram})"),
      providerId: argProviderId,
    },
    handler: async ({ templateId, changes, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      return { success: true, plantilla: await cliente.put(`/templates/${templateId}`, changes) };
    },
  }),
  definirTool({
    name: "gns3_delete_template",
    description: "Elimina una plantilla GNS3. Irreversible: los nodos ya creados con ella no se borran, pero no se podrán crear más.",
    inputSchema: {
      templateId: z.string().describe("Id de la plantilla a eliminar"),
      providerId: argProviderId,
    },
    handler: async ({ templateId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      return { success: true, resultado: await cliente.del(`/templates/${templateId}`) };
    },
  }),
  definirTool({
    name: "gns3_duplicate_template",
    description:
      "Duplica una plantilla GNS3 con un nombre nuevo. Útil para crear variantes sin tocar la original.",
    inputSchema: {
      templateId: z.string().describe("Id de la plantilla a duplicar"),
      name: z.string().describe("Nombre de la plantilla nueva"),
      providerId: argProviderId,
    },
    handler: async ({ templateId, name, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const original = (await cliente.get(`/templates/${templateId}`)) as Record<string, unknown>;
      // Se copia la original quitando los campos que asigna el servidor: mandar
      // el `template_id` viejo haría que GNS3 rechazara la creación.
      const { template_id: _ignorado, ...resto } = original ?? {};
      void _ignorado;
      return {
        success: true,
        plantilla: await cliente.post("/templates", { ...resto, name }),
      };
    },
  }),

  // -------------------------------------------------------------------------
  // Utilidades de proyecto
  // -------------------------------------------------------------------------
  definirTool({
    name: "gns3_export_project",
    description:
      "Exporta un proyecto GNS3 completo. Devuelve el tamaño del archivo exportado; " +
      "el archivo queda en el servidor GNS3, listo para descargar o importar.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      const datos = await cliente.get(`/projects/${id}/export`, "buffer");
      const buffer = Buffer.isBuffer(datos) ? datos : Buffer.alloc(0);
      return {
        success: true,
        bytes: buffer.length,
        mensaje:
          buffer.length > 0
            ? `Proyecto exportado (${buffer.length} bytes). Puedes importarlo en otro servidor con gns3_import_project.`
            : "El servidor no devolvió contenido al exportar el proyecto.",
      };
    },
  }),
  definirTool({
    name: "gns3_import_project",
    description:
      "Importa un proyecto GNS3 desde un archivo .gns3project que esté EN EL SERVIDOR GNS3 " +
      "(indica su ruta con 'path'). El proyecto importado se marca como activo.",
    inputSchema: {
      name: z.string().describe("Nombre que tendrá el proyecto importado"),
      path: z.string().describe("Ruta del archivo .gns3project en el servidor GNS3"),
      providerId: argProviderId,
    },
    handler: async ({ name, path: ruta, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const proyecto = (await cliente.post("/projects/import", {
        name,
        path: ruta,
      })) as Record<string, unknown>;
      const id = String(proyecto?.project_id ?? "");
      if (id) await recordarProyecto(providerId, id);
      return { success: true, proyecto };
    },
  }),
  definirTool({
    name: "gns3_auto_layout_project",
    description:
      "Reorganiza automáticamente la posición de los nodos del proyecto para que el diagrama se vea ordenado.",
    inputSchema: { projectId: argProjectId, providerId: argProviderId },
    handler: async ({ projectId, providerId }) => {
      const cliente = await crearClienteGns3(providerId);
      const id = await resolverProyecto(providerId, projectId);
      try {
        return { success: true, resultado: await cliente.post(`/projects/${id}/auto_layout`) };
      } catch (error) {
        // El endpoint de auto-layout no existe en todas las versiones de GNS3.
        Logger.debug("GNS3 no soporta auto_layout en esta versión.", {
          error: String(error),
        });
        return {
          success: false,
          error:
            "Este servidor GNS3 no soporta la reorganización automática (endpoint /auto_layout no disponible). " +
            "Puedes mover los nodos uno a uno desde la interfaz de GNS3.",
        };
      }
    },
  }),
];

export const moduloGns3: ModuloDominio = {
  id: "gns3",
  prefix: "gns3_",
  description:
    "Servidor GNS3: proyectos, nodos y su energía, enlaces, capturas de tráfico, snapshots y plantillas de dispositivo.",
  tools: herramientas,
};
