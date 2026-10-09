
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


const sesiones = new Map<string, DeviceTransport>();


function claveSesion(host: string, puerto: number, username?: string): string {
  return `${username ?? "anon"}@${host}:${puerto}`;
}


async function obtenerSesion(
  host: string,
  puerto: number,
  credenciales: { username?: string; password?: string; privateKey?: string },
): Promise<DeviceTransport> {
  const clave = claveSesion(host, puerto, credenciales.username);
  const existente = sesiones.get(clave);
  if (existente?.isConnected()) return existente;

  const transporte = crearTransporte({
    protocol: "SSH",
    host,
    port: puerto,
    username: credenciales.username,
    password: credenciales.password,
    privateKey: credenciales.privateKey,
  });
  await transporte.connect();
  sesiones.set(clave, transporte);
  return transporte;
}


export async function cerrarSesionesSsh(): Promise<void> {
  for (const transporte of sesiones.values()) {
    await transporte.disconnect().catch(() => undefined);
  }
  sesiones.clear();
}

const herramientas: DefinicionToolGenerica[] = [
  definirTool({
    name: "ssh_detect_vendor",
    description:
      "Se conecta por SSH a un equipo, lee su prompt y determina el FABRICANTE (Cisco IOS, Huawei VRP, MikroTik, ArubaOS, JunOS o genérico). " +
      "Úsala antes de configurar para que los comandos usen la sintaxis correcta.",
    inputSchema: {
      host: z.string().describe("IP o nombre del equipo"),
      username: z.string().describe("Usuario SSH"),
      password: z
        .string()
        .optional()
        .describe("Contraseña (si usas clave privada, omítela)"),
      privateKey: z
        .string()
        .optional()
        .describe("Clave privada en formato PEM, como texto"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Puerto SSH (por defecto 22)"),
    },
    handler: async ({ host, username, password, privateKey, port }) => {
      const transporte = await obtenerSesion(host, port ?? 22, {
        username,
        password,
        privateKey,
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
        port: port ?? 22,
        vendor: resultado.vendorId,
        vendorLabel: resultado.vendorLabel,
        prompt: resultado.prompt,
        confiable: resultado.vendorId !== "conservative",
        nota: notaVendorConservador(resultado),
      };
    },
  }),
  definirTool({
    name: "ssh_send_commands",
    description:
      "Envía comandos por SSH y devuelve la salida de cada uno. " +
      "Detecta el fabricante, aplica el preámbulo del perfil (por ejemplo 'terminal length 0' en Cisco) " +
      "y descarta los comandos que cerrarían la sesión. Es la vía recomendada frente a Telnet.",
    inputSchema: {
      host: z.string().describe("IP o nombre del equipo"),
      username: z.string().describe("Usuario SSH"),
      commands: z
        .array(z.string())
        .min(1)
        .describe("Comandos a enviar, en orden"),
      password: z
        .string()
        .optional()
        .describe("Contraseña (si usas clave privada, omítela)"),
      privateKey: z
        .string()
        .optional()
        .describe("Clave privada en formato PEM, como texto"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Puerto SSH (por defecto 22)"),
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
      username,
      commands,
      password,
      privateKey,
      port,
      idleMs,
      maxMs,
    }) => {
      const transporte = await obtenerSesion(host, port ?? 22, {
        username,
        password,
        privateKey,
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
    name: "ssh_disconnect",
    description: "Cierra la sesión SSH con un equipo para liberarla.",
    inputSchema: {
      host: z.string().describe("IP o nombre del equipo"),
      username: z
        .string()
        .optional()
        .describe("Usuario de la sesión a cerrar"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Puerto SSH (por defecto 22)"),
    },
    handler: async ({ host, username, port }) => {
      const clave = claveSesion(host, port ?? 22, username);
      const transporte = sesiones.get(clave);
      if (!transporte) {
        return {
          success: true,
          cerrada: false,
          mensaje: `No había sesión SSH abierta con ${host}:${port ?? 22}.`,
        };
      }
      await transporte.disconnect();
      sesiones.delete(clave);
      return {
        success: true,
        cerrada: true,
        mensaje: `Sesión SSH con ${host}:${port ?? 22} cerrada.`,
      };
    },
  }),
];

export const moduloSsh: ModuloDominio = {
  id: "ssh",
  prefix: "ssh_",
  description:
    "Sesiones SSH contra equipos reales: detectar el fabricante y enviar comandos de configuración de forma cifrada.",
  tools: herramientas,
};
