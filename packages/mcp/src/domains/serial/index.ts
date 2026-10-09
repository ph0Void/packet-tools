
import { z } from "zod";
import type { ModuloDominio, DefinicionToolGenerica } from "@/core/ToolRegistry";
import { definirTool } from "@/core/ToolRegistry";
import { crearTransporte, listarPuertosSerie } from "@/transports/adapters";
import { ejecutarComandos, notaVendorConservador } from "@/transports/commandEngine";
import type { DeviceTransport } from "@/transports/DeviceTransport";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";


const sesiones = new Map<string, DeviceTransport>();


function claveSesion(puerto: string, baudRate: number): string {
  return `${puerto}@${baudRate}`;
}


async function obtenerSesion(
  puerto: string,
  baudRate: number,
): Promise<{ transporte: DeviceTransport; typeDevice: string | null }> {
  const clave = claveSesion(puerto, baudRate);
  const existente = sesiones.get(clave);
  if (existente?.isConnected()) {
    return { transporte: existente, typeDevice: await typeDeviceDePuerto(puerto) };
  }
  const transporte = crearTransporte({
    protocol: "SERIAL",
    serialPort: puerto,
    baudRate,
  });
  await transporte.connect();
  sesiones.set(clave, transporte);
  return { transporte, typeDevice: await typeDeviceDePuerto(puerto) };
}


async function typeDeviceDePuerto(puerto: string): Promise<string | null> {
  try {
    const fila = await prismaClient.deviceProviderMcp.findFirst({
      where: { serialPort: puerto },
      select: { typeDevice: true },
    });
    return fila?.typeDevice ?? null;
  } catch (error) {
    Logger.debug(`No se pudo leer el tipo declarado del puerto ${puerto}.`, {
      error: String(error),
    });
    return null;
  }
}


export async function cerrarSesionesSerie(): Promise<void> {
  for (const [clave, transporte] of sesiones) {
    try {
      await transporte.disconnect();
    } catch (error) {
      Logger.debug(`Error cerrando la sesión serie ${clave}.`, { error: String(error) });
    }
  }
  sesiones.clear();
}

const herramientas: DefinicionToolGenerica[] = [
  definirTool({
    name: "serial_list_ports",
    description:
      "Lista los puertos serie disponibles en ESTE equipo (COM3, /dev/ttyUSB0...), con el fabricante y el número de serie del adaptador cuando el sistema los expone. " +
      "Úsala antes de conectarte: es la forma de saber el nombre exacto del puerto. " +
      "El campo 'manufacturer' ayuda a reconocer el adaptador USB-serie (por ejemplo un cable de consola FTDI o Prolific).",
    inputSchema: {},
    handler: async () => {
      const puertos = await listarPuertosSerie();
      if (puertos.length === 0) {
        return {
          success: true,
          puertos: [],
          mensaje:
            "No se detectó ningún puerto serie en este equipo. Comprueba que el adaptador USB-serie está conectado " +
            "y que su driver está instalado; en Linux puede requerir permisos sobre /dev/ttyUSB*.",
        };
      }
      return {
        success: true,
        total: puertos.length,
        puertos,
        ayuda:
          "Usa el campo 'path' de un puerto en las herramientas serial_send_commands o serial_detect_vendor. " +
          "La mayoría de consolas de red funcionan a 9600 baudios (valor por defecto).",
      };
    },
  }),
  definirTool({
    name: "serial_detect_vendor",
    description:
      "Abre el puerto serie, lee el banner/prompt del equipo y determina su FABRICANTE (Cisco IOS, Huawei VRP, MikroTik RouterOS, ArubaOS, JunOS o genérico). " +
      "Es el paso que permite enviar después los comandos con la sintaxis correcta. " +
      "Úsala nada más conectar el cable: si el equipo está arrancando, pulsa Enter para provocar el prompt.",
    inputSchema: {
      path: z.string().describe("Puerto serie, tal cual lo devuelve serial_list_ports (por ejemplo 'COM3' o '/dev/ttyUSB0')"),
      baudRate: z.number().int().positive().optional().describe("Velocidad en baudios (por defecto 9600)"),
      enviarEnter: z
        .boolean()
        .optional()
        .describe("Envía un Enter antes de leer para forzar la aparición del prompt (por defecto true)"),
    },
    handler: async ({ path: puerto, baudRate, enviarEnter }) => {
      const velocidad = baudRate ?? 9600;
      const { transporte, typeDevice } = await obtenerSesion(puerto, velocidad);
      
      
      if (enviarEnter !== false) {
        await transporte.sendCommand("");
        await transporte.readOutput({ idleMs: 700, maxMs: 4000 });
      }
      const resultado = await ejecutarComandos(
        transporte,
        [], 
        { typeDevice },
        { sinPreambulo: true },
      );
      
      
      
      await guardarDeteccion(puerto, resultado.vendorId, resultado.prompt);
      return {
        success: true,
        puerto,
        baudRate: velocidad,
        vendor: resultado.vendorId,
        vendorLabel: resultado.vendorLabel,
        promptDetectado: resultado.prompt,
        confiable: resultado.vendorId !== "conservative",
        mensaje:
          resultado.vendorId === "conservative"
            ? "No se pudo identificar el fabricante. Puede que el equipo esté apagado, arrancando, o que su prompt no delate la marca. " +
              "Si conoces la marca, indícala al configurar el dispositivo (typeDevice) para que se use su sintaxis; mientras tanto los comandos se enviarán tal cual, sin preámbulo ni transiciones de modo."
            : `Fabricante identificado: ${resultado.vendorLabel}. Los comandos se enviarán con su sintaxis.`,
        nota: notaVendorConservador(resultado),
      };
    },
  }),
  definirTool({
    name: "serial_send_commands",
    description:
      "Envía uno o varios comandos por el puerto serie y devuelve la salida de cada uno. " +
      "Resuelve el fabricante antes de enviar (o usa el que ya se detectó), aplica el preámbulo del perfil para desactivar la paginación " +
      "y descarta los comandos que cerrarían la sesión (exit, quit, logout). " +
      "Úsala tanto para leer ('show running-config') como para configurar.",
    inputSchema: {
      path: z.string().describe("Puerto serie (el mismo que devuelve serial_list_ports)"),
      commands: z
        .array(z.string())
        .min(1)
        .describe("Comandos a enviar, uno por elemento, en orden"),
      baudRate: z.number().int().positive().optional().describe("Velocidad en baudios (por defecto 9600)"),
      idleMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Milisegundos de silencio para considerar que la salida terminó (por defecto 700). Súbelo si la salida se corta."),
      maxMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Tiempo máximo de espera por comando en milisegundos (por defecto 20000)"),
    },
    handler: async ({ path: puerto, commands, baudRate, idleMs, maxMs }) => {
      const velocidad = baudRate ?? 9600;
      const { transporte, typeDevice } = await obtenerSesion(puerto, velocidad);
      const resultado = await ejecutarComandos(
        transporte,
        commands,
        { typeDevice },
        { idleMs, maxMs },
      );
      await guardarDeteccion(puerto, resultado.vendorId, resultado.prompt);
      return {
        success: true,
        puerto,
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
    name: "serial_read_console",
    description:
      "Lee lo que el equipo está emitiendo por el puerto serie SIN enviar ningún comando. " +
      "Úsala para ver el arranque del equipo, mensajes de log o comprobar si está vivo.",
    inputSchema: {
      path: z.string().describe("Puerto serie"),
      baudRate: z.number().int().positive().optional().describe("Velocidad en baudios (por defecto 9600)"),
      maxMs: z.number().int().positive().optional().describe("Cuánto escuchar en milisegundos (por defecto 3000)"),
    },
    handler: async ({ path: puerto, baudRate, maxMs }) => {
      const velocidad = baudRate ?? 9600;
      const { transporte } = await obtenerSesion(puerto, velocidad);
      const salida = await transporte.readOutput({
        idleMs: 500,
        maxMs: maxMs ?? 3000,
      });
      return {
        success: true,
        puerto,
        output: salida,
        mensaje:
          salida.trim().length === 0
            ? "No se recibió nada del equipo. Comprueba que está encendido, que el cable es de consola (no solo de datos), y que la velocidad en baudios es la correcta."
            : "Salida leída correctamente.",
      };
    },
  }),
  definirTool({
    name: "serial_disconnect",
    description:
      "Cierra la sesión del puerto serie para liberarlo y que otro programa (o el usuario) pueda usarlo. " +
      "Úsala al terminar de trabajar con un equipo físico.",
    inputSchema: {
      path: z.string().describe("Puerto serie a liberar"),
      baudRate: z.number().int().positive().optional().describe("Velocidad con la que se abrió (por defecto 9600)"),
    },
    handler: async ({ path: puerto, baudRate }) => {
      const clave = claveSesion(puerto, baudRate ?? 9600);
      const transporte = sesiones.get(clave);
      if (!transporte) {
        return {
          success: true,
          liberado: false,
          mensaje: `No había ninguna sesión abierta en ${puerto}.`,
        };
      }
      await transporte.disconnect();
      sesiones.delete(clave);
      return { success: true, liberado: true, mensaje: `Puerto ${puerto} liberado.` };
    },
  }),
];


async function guardarDeteccion(
  puerto: string,
  vendorId: string,
  prompt: string | null,
): Promise<void> {
  try {
    const dispositivo = await prismaClient.deviceProviderMcp.findFirst({
      where: { serialPort: puerto },
      select: { id: true },
    });
    if (!dispositivo) return;
    await prismaClient.vendorCacheMcp.upsert({
      where: { providerId: dispositivo.id },
      create: {
        providerId: dispositivo.id,
        vendorId,
        prompt,
        source: vendorId === "conservative" ? "conservative" : "prompt",
      },
      update: {
        vendorId,
        prompt,
        source: vendorId === "conservative" ? "conservative" : "prompt",
      },
    });
  } catch (error) {
    Logger.debug(`No se pudo cachear la detección de fabricante de ${puerto}.`, {
      error: String(error),
    });
  }
}

export const moduloSerial: ModuloDominio = {
  id: "serial",
  prefix: "serial_",
  description:
    "Puerto serie / consola física (RS-232, USB): enumerar puertos, detectar el fabricante del equipo conectado y enviar comandos de configuración.",
  tools: herramientas,
};
