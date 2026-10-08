import { prismaClient } from "@/prisma/lib/PrismaClient";
import { requestContext } from "@/utils/RequestContext";
import { Logger } from "@/utils/Logger";

export interface Gns3ProviderInfo {
  providerId: string | null;
  name: string | null;
  baseUrl: string;
  hasCredentials: boolean;
}

export interface Gns3TestResult {
  ok: boolean;
  status?: number;
  version?: string;
  error?: string;
}

interface Gns3ProviderRow {
  id: string;
  name: string;
  host: string | null;
  username: string | null;
  password: string | null;
  typeDevice: string;
}

const DEFAULT_BASE_URL = "http://localhost:3080/v2";
const DEFAULT_TIMEOUT_MS = 8000;

function normalizeBaseUrl(host?: string | null): string {
  const value = (host ?? "").trim().replace(/\/+$/, "");
  if (!value) return DEFAULT_BASE_URL;
  return value.endsWith("/v2") ? value : `${value}/v2`;
}

function encodeNodeFilePath(filePath: string): string {
  return filePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment === "." || segment === "..") {
        throw new Error(`Ruta de archivo no válida para GNS3: ${filePath}`);
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

export class Gns3Client {
  private baseUrl: string;
  private username: string | null;
  private password: string | null;
  private authHeader: string | null;
  private providerId: string | null = null;
  private providerName: string | null = null;

  constructor(baseUrl?: string, user?: string | null, pass?: string | null) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.username = typeof user === "string" && user.trim() ? user.trim() : null;

    this.password = typeof pass === "string" && pass.trim() ? pass : null;

    this.authHeader =
      this.username && this.password
        ? "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64")
        : null;
  }

  get info(): Gns3ProviderInfo {
    return {
      providerId: this.providerId,
      name: this.providerName,
      baseUrl: this.baseUrl,
      hasCredentials: this.authHeader !== null,
    };
  }

  private static fromProvider(provider: Gns3ProviderRow): Gns3Client {
    const client = new Gns3Client(provider.host ?? undefined, provider.username, provider.password);
    client.providerId = provider.id;
    client.providerName = provider.name;
    Logger.info({
      message: "[Gns3Client] Configuración de GNS3 cargada desde la base de datos.",
      data: { host: client.info.baseUrl, username: provider.username ?? null },
    });
    return client;
  }

  static async fromDatabase(providerId?: string): Promise<Gns3Client> {
    try {
      const provider: Gns3ProviderRow | null = providerId
        ? await prismaClient.deviceProviders.findUnique({ where: { id: providerId } })
        : await prismaClient.deviceProviders.findFirst({
            where: { typeDevice: "GNS3" },
            orderBy: { updatedAt: "desc" },
          });

      if (provider) return Gns3Client.fromProvider(provider);

      Logger.warning({
        message:
          "[Gns3Client] No hay dispositivos GNS3 configurados en la base de datos; se usa la configuración por defecto.",
        data: { baseUrl: DEFAULT_BASE_URL },
      });
    } catch (error) {
      Logger.error({
        message: "[Gns3Client] Error al cargar la configuración desde la base de datos.",
        data: error,
      });
    }
    return new Gns3Client();
  }

  static async forRequest(providerId?: string | null): Promise<Gns3Client> {
    const store = requestContext.getStore();
    const candidate =
      providerId?.trim() || store?.connectionProviderId || store?.mentionedProviderId || null;

    if (candidate) {
      try {
        const provider: Gns3ProviderRow | null = await prismaClient.deviceProviders.findUnique({
          where: { id: candidate },
        });
        if (provider?.typeDevice === "GNS3") return Gns3Client.fromProvider(provider);

        Logger.warning({
          message:
            "[Gns3Client] El dispositivo indicado no es de tipo GNS3; se usa el primer GNS3 de la base de datos.",
          data: { providerId: candidate, typeDevice: provider?.typeDevice ?? null },
        });
      } catch (error) {
        Logger.error({
          message: "[Gns3Client] Error resolviendo el dispositivo GNS3 del turno.",
          data: error,
        });
      }
    }
    return Gns3Client.fromDatabase();
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authHeader) headers.Authorization = this.authHeader;
    return { ...headers, ...(extra ?? {}) };
  }

  private async request(
    endpoint: string,
    options: RequestInit = {},
    parseAs: "json" | "text" | "buffer" = "json",
  ): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: this.buildHeaders(options.headers as Record<string, string> | undefined),
      });
    } catch (error: any) {
      const detalle = error?.cause?.message ?? error?.message ?? "error desconocido";
      Logger.error({
        message: `[Gns3Client] No se pudo conectar al servidor GNS3 (${endpoint}).`,
        data: { endpoint, baseUrl: this.baseUrl, error: detalle },
      });
      throw new Error(
        `No se pudo conectar al servidor GNS3 en ${this.baseUrl}: ${detalle}`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      Logger.error({
        message: `[Gns3Client] Error en GNS3 API (${response.status}).`,
        data: { endpoint, status: response.status },
      });
      if (response.status === 401) {
        throw new Error(
          "Error en GNS3 API (401): credenciales inválidas. Revisa usuario y contraseña del dispositivo GNS3.",
        );
      }
      throw new Error(
        `Error en GNS3 API (${response.status}): ${errorText || "respuesta sin detalle"}`,
      );
    }

    if (response.status === 204) return parseAs === "text" ? "" : null;
    if (parseAs === "text") return await response.text();
    if (parseAs === "buffer") return Buffer.from(await response.arrayBuffer());
    return await response.json();
  }

  private async requestBinaryBody(
    endpoint: string,
    body: Buffer,
    method: string = "POST",
  ): Promise<any> {
    return this.request(
      endpoint,
      {
        method,
        body: new Uint8Array(body),
        headers: { "Content-Type": "application/octet-stream" },
      },
      "json",
    );
  }

  async getVersion(): Promise<any> {
    return this.request("/version");
  }

  async testConnection(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Gns3TestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/version`, {
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (response.status === 401) {
        return {
          ok: false,
          status: 401,
          error: "Credenciales GNS3 inválidas (401). Revisa usuario y contraseña.",
        };
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          ok: false,
          status: response.status,
          error: `Error en GNS3 API (${response.status}): ${errorText || "respuesta sin detalle"}`,
        };
      }

      const data = await response.json().catch(() => null);
      return { ok: true, status: response.status, version: data?.version };
    } catch (error: any) {
      if (controller.signal.aborted) {
        return {
          ok: false,
          error: `Tiempo de espera agotado (${timeoutMs} ms) al conectar con GNS3.`,
        };
      }
      const detalle = error?.cause?.message ?? error?.message ?? "error desconocido";
      return {
        ok: false,
        error: `No se pudo conectar al servidor GNS3 en ${this.baseUrl}: ${detalle}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async getProjects(): Promise<any[]> {
    return this.request("/projects");
  }

  async getProject(projectId: string): Promise<any> {
    return this.request(`/projects/${projectId}`);
  }

  async createProject(name: string): Promise<any> {
    return this.request("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async openProject(projectId: string): Promise<any> {
    return this.request(`/projects/${projectId}/open`, { method: "POST" });
  }

  async closeProject(projectId: string): Promise<any> {
    return this.request(`/projects/${projectId}/close`, { method: "POST" });
  }

  async deleteProject(projectId: string): Promise<any> {
    return this.request(`/projects/${projectId}`, { method: "DELETE" });
  }

  async exportProject(projectId: string): Promise<Buffer> {
    return this.request(`/projects/${projectId}/export`, {}, "buffer");
  }

  async importProject(projectId: string, archive: Buffer): Promise<any> {
    return this.requestBinaryBody(`/projects/${projectId}/import`, archive);
  }

  async getSnapshots(projectId: string): Promise<any[]> {
    return (await this.request(`/projects/${projectId}/snapshots`)) ?? [];
  }

  async createSnapshot(projectId: string, name?: string): Promise<any> {
    return this.request(`/projects/${projectId}/snapshots`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    });
  }

  async restoreSnapshot(projectId: string, snapshotId: string): Promise<any> {
    return this.request(`/projects/${projectId}/snapshots/${snapshotId}/restore`, {
      method: "POST",
    });
  }

  async deleteSnapshot(projectId: string, snapshotId: string): Promise<any> {
    return this.request(`/projects/${projectId}/snapshots/${snapshotId}`, {
      method: "DELETE",
    });
  }

  async getProjectStats(
    projectId: string,
  ): Promise<{ drawings?: number; links?: number; nodes?: number; snapshots?: number }> {
    return this.request(`/projects/${projectId}/stats`);
  }

  async getNodes(projectId: string): Promise<any[]> {
    return this.request(`/projects/${projectId}/nodes`);
  }

  async createNode(
    projectId: string,
    name: string,
    nodeType: string,
    templateId?: string,
  ): Promise<any> {
    const body: Record<string, any> = {
      name,
      node_type: nodeType,
      compute_id: "local",
    };
    if (templateId) body.template_id = templateId;

    return this.request(`/projects/${projectId}/nodes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async startNode(projectId: string, nodeId: string): Promise<any> {
    return this.request(`/projects/${projectId}/nodes/${nodeId}/start`, {
      method: "POST",
    });
  }

  async stopNode(projectId: string, nodeId: string): Promise<any> {
    return this.request(`/projects/${projectId}/nodes/${nodeId}/stop`, {
      method: "POST",
    });
  }

  async getNodeFiles(
    projectId: string,
    nodeId: string,
    opts?: { computeId?: string; nodeName?: string },
  ): Promise<Array<{ name?: string; path: string }>> {
    const computeId = opts?.computeId?.trim() || "local";

    let entradas: any[];
    try {
      entradas =
        (await this.request(`/compute/projects/${encodeURIComponent(projectId)}/files`)) ?? [];
    } catch (error: any) {
      Logger.error({
        message: "[Gns3Client] No se pudo listar los archivos del proyecto en el compute.",
        data: { projectId, computeId, error: error?.message ?? "desconocido" },
      });
      throw new Error(
        "No se pudo listar los archivos del nodo en este servidor GNS3 (el compute debe ser local).",
      );
    }

    const extraer = (coincide: (segmento: string) => boolean) => {
      const archivos: Array<{ name: string; path: string }> = [];
      const vistos = new Set<string>();

      for (const entrada of entradas ?? []) {
        if (!entrada) continue;

        if (typeof entrada === "object" && entrada.is_dir === true) continue;
        const rutaCruda = typeof entrada === "string" ? entrada : entrada.path;
        if (typeof rutaCruda !== "string" || !rutaCruda.trim()) continue;

        const segmentos = rutaCruda
          .replace(/\\/g, "/")
          .split("/")
          .filter((segmento) => segmento.length > 0);
        const indice = segmentos.findIndex(coincide);
        if (indice < 0) continue;

        const relativa = segmentos.slice(indice + 1).join("/");
        if (!relativa || vistos.has(relativa)) continue;
        vistos.add(relativa);
        archivos.push({ name: segmentos[segmentos.length - 1], path: relativa });
      }
      return archivos;
    };

    const idBuscado = nodeId?.trim();
    let archivos = idBuscado ? extraer((segmento) => segmento === idBuscado) : [];

    const nombreBuscado = opts?.nodeName?.trim().toLowerCase();
    if (archivos.length === 0 && nombreBuscado) {
      archivos = extraer((segmento) => segmento.toLowerCase().includes(nombreBuscado));
    }

    return archivos
      .sort((a, b) => {
        const porNombre = (a.name ?? a.path).localeCompare(b.name ?? b.path);
        return porNombre !== 0 ? porNombre : a.path.localeCompare(b.path);
      })
      .slice(0, 200);
  }

  async readNodeFile(projectId: string, nodeId: string, filePath: string): Promise<string> {
    const encodedPath = encodeNodeFilePath(filePath);
    return this.request(
      `/projects/${projectId}/nodes/${nodeId}/files/${encodedPath}`,
      {},
      "text",
    );
  }

  async createLink(
    projectId: string,
    nodeAId: string,
    adapterA: number,
    portA: number,
    nodeBId: string,
    adapterB: number,
    portB: number,
  ): Promise<any> {
    const body = {
      nodes: [
        { node_id: nodeAId, adapter_number: adapterA, port_number: portA },
        { node_id: nodeBId, adapter_number: adapterB, port_number: portB },
      ],
    };
    return this.request(`/projects/${projectId}/links`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getTemplates(): Promise<any[]> {
    return this.request("/templates");
  }

  async getTemplate(templateId: string): Promise<any> {
    return this.request(`/templates/${templateId}`);
  }

  async createTemplate(data: Record<string, any>): Promise<any> {
    return this.request("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTemplate(templateId: string, data: Record<string, any>): Promise<any> {
    return this.request(`/templates/${templateId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTemplate(templateId: string): Promise<any> {
    return this.request(`/templates/${templateId}`, { method: "DELETE" });
  }

  async duplicateTemplate(templateId: string): Promise<any> {
    return this.request(`/templates/${templateId}/duplicate`, { method: "POST" });
  }

  async getLinks(projectId: string): Promise<any[]> {
    return this.request(`/projects/${projectId}/links`);
  }

  async getLink(projectId: string, linkId: string): Promise<any> {
    return this.request(`/projects/${projectId}/links/${linkId}`);
  }

  async startLinkCapture(projectId: string, linkId: string): Promise<any> {
    return this.request(`/projects/${projectId}/links/${linkId}/start_capture`, {
      method: "POST",
    });
  }

  async stopLinkCapture(projectId: string, linkId: string): Promise<any> {
    return this.request(`/projects/${projectId}/links/${linkId}/stop_capture`, {
      method: "POST",
    });
  }

  async downloadLinkPcap(projectId: string, linkId: string): Promise<Buffer> {
    return this.request(`/projects/${projectId}/links/${linkId}/pcap`, {}, "buffer");
  }

  async updateNode(
    projectId: string,
    nodeId: string,
    data: Record<string, any>,
  ): Promise<any> {
    return this.request(`/projects/${projectId}/nodes/${nodeId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteNode(projectId: string, nodeId: string): Promise<any> {
    return this.request(`/projects/${projectId}/nodes/${nodeId}`, {
      method: "DELETE",
    });
  }

  async deleteLink(projectId: string, linkId: string): Promise<any> {
    return this.request(`/projects/${projectId}/links/${linkId}`, {
      method: "DELETE",
    });
  }

  async getComputes(): Promise<any[]> {
    return (await this.request("/computes")) ?? [];
  }

  async getCompute(computeId?: string): Promise<any> {
    const id = computeId?.trim() || "local";
    return this.request(`/computes/${encodeURIComponent(id)}`);
  }
}

export const gns3Client = new Gns3Client();
