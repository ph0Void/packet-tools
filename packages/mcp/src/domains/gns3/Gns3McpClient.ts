/**
 * Cliente GNS3 del servidor MCP.
 *
 * POR QUÉ SE REIMPLEMENTA: el servidor tiene `packages/server/src/client/Gns3Client.ts`,
 * pero su resolución de credenciales (`forRequest`/`fromDatabase`) acaba SIEMPRE
 * en la Prisma del backend. El MCP es un proceso independiente con su PROPIA
 * base de datos, así que necesita leer las credenciales de GNS3 de ahí.
 *
 * Lo que sí se conserva literal es el protocolo contra el API de GNS3 (rutas,
 * normalización de URL y autenticación básica), que es lo que no se puede
 * inventar.
 */
import { envConfig } from "@/config/EnvConfig";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { errorDeConfiguracion, errorNoDisponible, McpToolError } from "@/core/errors";

/** URL base por defecto del API de GNS3 (mismo valor que usa el servidor). */
const BASE_POR_DEFECTO = "http://localhost:3080/v2";

/** Timeout de una petición al API de GNS3. */
const TIMEOUT_MS = 15_000;

/**
 * Normaliza la URL base: sin barra final y con `/v2` al final.
 * GNS3 siempre expone su API bajo `/v2`, y el usuario suele escribir la raíz.
 */
function normalizarBaseUrl(host?: string | null): string {
  const valor = (host ?? envConfig.MCP_GNS3_URL ?? "").trim().replace(/\/+$/, "");
  if (!valor) return BASE_POR_DEFECTO;
  return valor.endsWith("/v2") ? valor : `${valor}/v2`;
}

/** Credenciales resueltas para hablar con GNS3. */
interface CredencialesGns3 {
  baseUrl: string;
  username: string | null;
  password: string | null;
}

/**
 * Resuelve las credenciales de GNS3 desde la BD propia del MCP.
 *
 * Orden: `providerId` explícito → la primera fila de tipo GNS3 → variables de
 * entorno / valor por defecto. Degrada con elegancia: si la BD no está
 * inicializada, se sigue con la URL por defecto y GNS3 responderá lo que tenga
 * que responder.
 */
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

/**
 * Cliente HTTP del API de GNS3.
 *
 * Se instancia por llamada con las credenciales ya resueltas, en vez de ser un
 * singleton como en el servidor: así el modelo puede trabajar contra varios
 * servidores GNS3 sin que uno pise al otro.
 */
export class Gns3McpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | null;

  constructor(credenciales: CredencialesGns3) {
    this.baseUrl = credenciales.baseUrl;
    // Igual que en el servidor: Basic solo cuando hay usuario Y contraseña.
    this.authHeader =
      credenciales.username && credenciales.password
        ? `Basic ${Buffer.from(`${credenciales.username}:${credenciales.password}`).toString("base64")}`
        : null;
  }

  /** URL base en uso (para mensajes de error y diagnóstico). */
  get url(): string {
    return this.baseUrl;
  }

  /**
   * Petición al API.
   *
   * `parseAs` permite leer respuestas que no son JSON (archivos de nodo en texto
   * plano, pcaps y exports en binario) sin pasarlas por `JSON.parse`.
   */
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
      // El servidor contestó 2xx pero el cuerpo no era lo esperado.
      return null;
    }
  }

  /** GET de conveniencia. */
  async get(endpoint: string, parseAs: "json" | "text" | "buffer" = "json"): Promise<unknown> {
    return this.request(endpoint, { method: "GET" }, parseAs);
  }

  /** POST de conveniencia. */
  async post(endpoint: string, cuerpo?: unknown): Promise<unknown> {
    return this.request(endpoint, {
      method: "POST",
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
  }

  /** PUT de conveniencia. */
  async put(endpoint: string, cuerpo?: unknown): Promise<unknown> {
    return this.request(endpoint, {
      method: "PUT",
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
  }

  /** DELETE de conveniencia. */
  async del(endpoint: string): Promise<unknown> {
    return this.request(endpoint, { method: "DELETE" });
  }
}

/** Crea el cliente con las credenciales del proveedor indicado ya resueltas. */
export async function crearClienteGns3(
  providerId?: string | null,
): Promise<Gns3McpClient> {
  const credenciales = await resolverCredencialesGns3(providerId);
  return new Gns3McpClient(credenciales);
}
