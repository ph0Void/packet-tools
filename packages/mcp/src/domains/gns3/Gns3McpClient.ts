
import { envConfig } from "@/config/EnvConfig";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { errorDeConfiguracion, errorNoDisponible, McpToolError } from "@/core/errors";


const BASE_POR_DEFECTO = "http://localhost:3080/v2";


const TIMEOUT_MS = 15_000;


function normalizarBaseUrl(host?: string | null): string {
  const valor = (host ?? envConfig.MCP_GNS3_URL ?? "").trim().replace(/\/+$/, "");
  if (!valor) return BASE_POR_DEFECTO;
  return valor.endsWith("/v2") ? valor : `${valor}/v2`;
}


interface CredencialesGns3 {
  baseUrl: string;
  username: string | null;
  password: string | null;
}


export async function resolverCredencialesGns3(
  providerId?: string | null,
): Promise<CredencialesGns3> {
  try {
    const fila = providerId?.trim()
      ? await prismaClient.deviceProviderMcp.findUnique({ where: { id: providerId.trim() } })
      : await prismaClient.deviceProviderMcp.findFirst({
          where: { typeDevice: "GNS3" },
          orderBy: { updatedAt: "desc" },
        });

    if (fila) {
      if (fila.typeDevice !== "GNS3" && providerId) {
        throw errorDeConfiguracion(
          `El dispositivo '${fila.name}' no es de tipo GNS3 (es ${fila.typeDevice}).`,
          "Usa el id de un dispositivo GNS3 o llama a gns3_list_configured_servers para ver los que hay configurados.",
        );
      }
      return {
        baseUrl: normalizarBaseUrl(fila.host),
        username: fila.username ?? null,
        password: fila.password ?? null,
      };
    }
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    Logger.debug("No se pudieron leer las credenciales de GNS3 de la BD del MCP.", {
      error: String(error),
    });
  }

  return {
    baseUrl: normalizarBaseUrl(null),
    username: null,
    password: null,
  };
}


export class Gns3McpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | null;

  constructor(credenciales: CredencialesGns3) {
    this.baseUrl = credenciales.baseUrl;
    
    this.authHeader =
      credenciales.username && credenciales.password
        ? `Basic ${Buffer.from(`${credenciales.username}:${credenciales.password}`).toString("base64")}`
        : null;
  }

  
  get url(): string {
    return this.baseUrl;
  }

  
  async request(
    endpoint: string,
    options: RequestInit = {},
    parseAs: "json" | "text" | "buffer" = "json",
  ): Promise<unknown> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controlador.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
          ...((options.headers as Record<string, string>) ?? {}),
        },
      });
    } catch (error) {
      clearTimeout(temporizador);
      const mensaje = error instanceof Error ? error.message : String(error);
      throw errorNoDisponible(
        `No se pudo contactar con el servidor GNS3 en ${this.baseUrl}: ${mensaje}`,
        "Comprueba que el servidor GNS3 está arrancado y que la URL es correcta (por defecto http://localhost:3080/v2). " +
          "Si tu GNS3 está en otra máquina o puerto, configura el dispositivo GNS3 con esa URL.",
      );
    }
    clearTimeout(temporizador);

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "");
      const recortado = detalle.slice(0, 300);
      if (respuesta.status === 401 || respuesta.status === 403) {
        throw errorDeConfiguracion(
          `GNS3 rechazó la autenticación (HTTP ${respuesta.status}).`,
          "Revisa el usuario y la contraseña del dispositivo GNS3 en la configuración del MCP.",
        );
      }
      throw new McpToolError(
        "OPERACION_FALLIDA",
        `GNS3 respondió HTTP ${respuesta.status} en ${endpoint}${recortado ? `: ${recortado}` : ""}`,
        {
          sugerencia:
            "Comprueba que el proyecto y los identificadores existen (usa las herramientas gns3_list_* para ver los reales) y que el servidor GNS3 está operativo.",
        },
      );
    }

    if (respuesta.status === 204) return null;

    try {
      if (parseAs === "text") return await respuesta.text();
      if (parseAs === "buffer") return Buffer.from(await respuesta.arrayBuffer());
      return await respuesta.json();
    } catch {
      
      return null;
    }
  }

  
  async get(endpoint: string, parseAs: "json" | "text" | "buffer" = "json"): Promise<unknown> {
    return this.request(endpoint, { method: "GET" }, parseAs);
  }

  
  async post(endpoint: string, cuerpo?: unknown): Promise<unknown> {
    return this.request(endpoint, {
      method: "POST",
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
  }

  
  async put(endpoint: string, cuerpo?: unknown): Promise<unknown> {
    return this.request(endpoint, {
      method: "PUT",
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
  }

  
  async del(endpoint: string): Promise<unknown> {
    return this.request(endpoint, { method: "DELETE" });
  }
}


export async function crearClienteGns3(
  providerId?: string | null,
): Promise<Gns3McpClient> {
  const credenciales = await resolverCredencialesGns3(providerId);
  return new Gns3McpClient(credenciales);
}
