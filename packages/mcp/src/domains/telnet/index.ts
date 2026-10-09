/**
 * Dominio `@telnet`: sesiones Telnet contra equipos reales.
 *
 * Comparte TODO el motor con el resto de transportes (`transports/commandEngine.ts`):
 * detección de fabricante, preámbulo del perfil, saneado de comandos y
 * recorte de salida. Lo único propio de este dominio es abrir y cachear las
 * sesiones Telnet, para no reconectar en cada comando.
 */
import { z } from "zod";
import type {
  ModuloDominio,
  DefinicionToolGenerica,
} from "@/core/ToolRegistry";
import { definirTool } from "@/core/ToolRegistry";
import { crearTransporte } from "@/transports/adapters";
import {
  ejecutarComandos,
  notaVendorConservador,
} from "@/transports/commandEngine";
import type { DeviceTransport } from "@/transports/DeviceTransport";

/** Sesiones Telnet vivas, por `host:puerto`. */
const sesiones = new Map<string, DeviceTransport>();

/** Clave estable de una sesión Telnet. */
function claveSesion(host: string, puerto: number): string {
  return `${host}:${puerto}`;
}

/** Obtiene o abre la sesión indicada. */
async function obtenerSesion(
  host: string,
  puerto: number,
  credenciales: { username?: string; password?: string },
): Promise<DeviceTransport> {
  const clave = claveSesion(host, puerto);
  const existente = sesiones.get(clave);
  if (existente?.isConnected()) return existente;

  const transporte = crearTransporte({
    protocol: "TELNET",
    host,
    port: puerto,
    username: credenciales.username,
    password: credenciales.password,
  });
  await transporte.connect();
  sesiones.set(clave, transporte);
  return transporte;
}

/** Cierra todas las sesiones Telnet (apagado ordenado y pruebas). */
export async function cerrarSesionesTelnet(): Promise<void> {
  for (const transporte of sesiones.values()) {
    await transporte.disconnect().catch(() => undefined);
  }
  sesiones.clear();
}

const herramientas: DefinicionToolGenerica[] = [
  definirTool({
    name: "telnet_detect_vendor",
    description:
      "Se conecta por Telnet a un equipo, lee su prompt y determina el FABRICANTE (Cisco IOS, Huawei VRP, MikroTik, ArubaOS, JunOS o genérico). " +
      "Úsala antes de configurar un equipo del que no conozcas la marca, para que los comandos se envíen con la sintaxis correcta.",
    inputSchema: {
      host: z.string().describe("IP o nombre del equipo"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Puerto Telnet (por defecto 23)"),
      username: z
        .string()
        .optional()
        .describe("Usuario, si el equipo lo pide"),
      password: z
        .string()
        .optional()
        .describe("Contraseña, si el equipo la pide"),
    },
    handler: async ({ host, port, username, password }) => {
      const transporte = await obtenerSesion(host, port ?? 23, {
        username,
        password,
      });
      const resultado = await ejecutarComandos(
        transporte,
        [],
        {},
        { sinPreambulo: true },
      );
      return {
        success: true,
        host,
        port: port ?? 23,
        vendor: resultado.vendorId,
        vendorLabel: resultado.vendorLabel,
        prompt: resultado.prompt,
        confiable: resultado.vendorId !== "conservative",
        nota: notaVendorConservador(resultado),
      };
    },
  }),
  definirTool({
    name: "telnet_send_commands",
    description:
      "Envía comandos por Telnet y devuelve la salida de cada uno. " +
      "Detecta el fabricante, aplica el preámbulo para desactivar la paginación y descarta los comandos que cerrarían la sesión. " +
      "El equipo debe tener Telnet habilitado: si no, usa el dominio ssh_.",
    inputSchema: {
      host: z.string().describe("IP o nombre del equipo"),
      commands: z
        .array(z.string())
        .min(1)
        .describe("Comandos a enviar, en orden"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Puerto Telnet (por defecto 23)"),
      username: z
        .string()
        .optional()
        .describe("Usuario, si el equipo lo pide"),
      password: z
        .string()
        .optional()
        .describe("Contraseña, si el equipo la pide"),
      idleMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Silencio para dar la salida por terminada (por defecto 700 ms)"),
      maxMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Espera máxima por comando (por defecto 20000 ms)"),
    },
    handler: async ({
      host,
      commands,
      port,
      username,
      password,
      idleMs,
      maxMs,
    }) => {
      const transporte = await obtenerSesion(host, port ?? 23, {
        username,
        password,
      });
      const resultado = await ejecutarComandos(
        transporte,
        commands,
        {},
        { idleMs, maxMs },
      );
      return {
        success: true,
        host,
        vendor: resultado.vendorId,
        vendorLabel: resultado.vendorLabel,
        prompt: resultado.prompt,
        duracionMs: resultado.duracionMs,
        output: resultado.output,
        nota: notaVendorConservador(resultado),
      };
    },
  }),
  definirTool({
    name: "telnet_disconnect",
    description: "Cierra la sesión Telnet con un equipo para liberarla.",
    inputSchema: {
      host: z.string().describe("IP o nombre del equipo"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Puerto Telnet (por defecto 23)"),
    },
    handler: async ({ host, port }) => {
      const clave = claveSesion(host, port ?? 23);
      const transporte = sesiones.get(clave);
      if (!transporte) {
        return {
          success: true,
          cerrada: false,
          mensaje: `No había sesión abierta con ${host}:${port ?? 23}.`,
        };
      }
      await transporte.disconnect();
      sesiones.delete(clave);
      return {
        success: true,
        cerrada: true,
        mensaje: `Sesión con ${host}:${port ?? 23} cerrada.`,
      };
    },
  }),
];

export const moduloTelnet: ModuloDominio = {
  id: "telnet",
  prefix: "telnet_",
  description:
    "Sesiones Telnet contra equipos reales: detectar el fabricante y enviar comandos de configuración con la sintaxis correcta.",
  tools: herramientas,
};
