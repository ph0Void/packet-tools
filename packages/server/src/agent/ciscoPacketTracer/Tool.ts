import {
  TIMEOUT_POR_HERRAMIENTA,
  ciscoClient,
} from "@/client/PacketTracerClient";
import {
  ejecutarYEsperar,
  type ResultadoCiclo,
} from "@/client/PacketTracerConsola";
import { topologyService } from "@/service/TopologyService";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { tool } from "@langchain/core/tools";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { searchKnowledgeBaseTool } from "../knowledge/Tool";
import { CONNECTION_TOOLS } from "../tools/DeviceTools";
import { classifyCommand, READONLY_PREFIXES } from "../security/CommandClassifier";
import { requestContext } from "@/utils/RequestContext";

const ALLOWED_LINK_TYPES = [
  "straight",
  "cross",
  "fiber",
  "serial",
  "auto",
] as const;

export const TTL_CATALOGO_MODELOS_MS = 60_000;

const MAX_SUGERENCIAS_MODELO = 5;

let cacheCatalogoModelos: { modelos: string[]; expiraEn: number } | null = null;

export function extraerModelosValidos(respuesta: unknown): string[] {
  const bruto = payloadDe(respuesta);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return [];
  if (bruto.success === false || bruto.error) return [];

  const catalogo = bruto.models ?? bruto.data?.models ?? bruto.data;
  const ids: string[] = [];
  for (const modelo of comoArray(catalogo)) {
    if (typeof modelo === "string" || typeof modelo === "number") {
      const id = String(modelo).trim();
      if (id) ids.push(id);
      continue;
    }
    const id = textoONull(modelo?.id) ?? textoONull(modelo?.model);
    if (id) ids.push(id.trim());
  }
  return Array.from(new Set(ids));
}

function puntosDeSimilitud(termino: string, candidato: string): number {
  const modelo = String(candidato ?? "").trim().toLowerCase();
  if (!modelo) return 0;

  let comunes = 0;
  while (
    comunes < termino.length &&
    comunes < modelo.length &&
    termino[comunes] === modelo[comunes]
  ) {
    comunes++;
  }
  const contiene = modelo.includes(termino) || termino.includes(modelo);
  if (comunes < 2 && !contiene) return 0;
  return comunes * 2 + (contiene ? 1 : 0);
}

export function modelosMasParecidos(
  modelo: string,
  catalogo: string[],
): string[] {
  const termino = String(modelo ?? "").trim().toLowerCase();
  if (!termino) return [];

  return (catalogo ?? [])
    .map((candidato) => ({
      candidato: String(candidato).trim(),
      puntos: puntosDeSimilitud(termino, candidato),
    }))
    .filter((entrada) => entrada.puntos > 0)
    .sort(
      (a, b) =>
        b.puntos - a.puntos ||
        a.candidato.length - b.candidato.length ||
        a.candidato.localeCompare(b.candidato),
    )
    .slice(0, MAX_SUGERENCIAS_MODELO)
    .map((entrada) => entrada.candidato);
}

export type ValidacionModelo =
  | { ok: true; modelo: string }
  | { ok: false; error: string; sugerencias: string[] };

export function validarModeloDeDispositivo(
  modelo: string,
  catalogo: string[],
): ValidacionModelo {
  const pedido = String(modelo ?? "").trim();
  if (!pedido) {
    return {
      ok: false,
      error:
        "No se indicó el modelo del dispositivo. Llama a listDeviceModels para ver " +
        "el catálogo de modelos que acepta esta instalación de Packet Tracer y " +
        "repite con un id exacto (p. ej. '2911', '2960-24TT', 'Router-PT', 'PC-PT').",
      sugerencias: [],
    };
  }

  const disponibles = (catalogo ?? [])
    .map((entrada) => String(entrada ?? "").trim())
    .filter(Boolean);

  const existente = disponibles.find((entrada) => entrada === pedido);
  if (existente) return { ok: true, modelo: existente };

  const sugerencias = modelosMasParecidos(pedido, disponibles);
  const pista =
    sugerencias.length > 0
      ? ` Los modelos del catálogo más parecidos son: ${sugerencias.join(", ")}.`
      : "";

  return {
    ok: false,
    error:
      `'${pedido}' no es un modelo de dispositivo de Packet Tracer.${pista} ` +
      `Llama a listDeviceModels para ver el catálogo REAL (lo decide el motor de ` +
      `Packet Tracer, no esta tool) y repite con un id exacto: la comparación ` +
      `distingue mayúsculas y minúsculas.`,
    sugerencias,
  };
}

export async function leerCatalogoDeModelos(): Promise<string[]> {
  const ahora = Date.now();
  if (cacheCatalogoModelos && cacheCatalogoModelos.expiraEn > ahora) {
    return cacheCatalogoModelos.modelos;
  }

  const modelos = extraerModelosValidos(
    await ciscoClient.callTool("listDeviceModels", {}),
  );
  if (modelos.length === 0) {
    cacheCatalogoModelos = null;
    return [];
  }

  cacheCatalogoModelos = {
    modelos,
    expiraEn: ahora + TTL_CATALOGO_MODELOS_MS,
  };
  return modelos;
}

async function getCurrentUser() {
  const ctx = requestContext.getStore();
  if (!ctx?.id) {
    return {
      success: false,
      message: "No se encontró sesión activa (contexto de usuario no disponible).",
      data: null,
    };
  }

  const user = await prismaClient.user.findUnique({ where: { id: ctx.id } });
  if (!user) {
    return {
      success: false,
      message: "Usuario no encontrado en la base de datos.",
      data: null,
    };
  }
  return {
    success: true,
    message: "Usuario autenticado",
    data: user,
  };
}

async function getCurrentTopology() {
  const currentUser = await getCurrentUser();

  if (!currentUser.success || !currentUser.data?.id) {
    return {
      success: false,
      message: "No se encontró sesión activa (Token faltante).",
      data: null,
    };
  }

  const topology = await topologyService.getLastOwnerTopology(
    currentUser.data.id,
  );
  return topology;
}

async function createLog({
  level,
  title,
  content,
}: {
  level: string;
  title: string;
  content: string;
}) {
  try {
    const topologia = await getCurrentTopology();

    const datos = (topologia as { data?: { id?: string; ownerId?: string } } | null)?.data;
    const topologiaId = datos?.id;
    const ownerId = datos?.ownerId ?? requestContext.getStore()?.id ?? null;
    if (!topologiaId) {
      console.warn(
        `No se pudo registrar el log [${title}] porque el usuario todavía no tiene ninguna topología activa creada.`,
      );
      return;
    }

    await prismaClient.log.create({
      data: {
        level: level.toUpperCase(),
        title,
        content,
        userId: ownerId,
        topology: {
          connect: {
            id: topologiaId,
          },
        },
      },
    });
  } catch (error) {
    console.error("Error al registrar el log en la base de datos:", error);
  }
}

export function operacionOk(resultado: unknown): boolean {
  const bruto = payloadDe(resultado);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return false;
  if (bruto.success === false) return false;
  if (bruto.succes === false) return false;
  if (bruto.error) return false;
  return true;
}

export function detalleDeFallosParciales(resultado: unknown): string | null {
  const bruto = payloadDe(resultado);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;

  const resultados = comoArray(bruto.results);
  const fallos = resultados.filter(
    (fila: any) => fila && (fila.success === false || fila.error),
  );
  if (fallos.length === 0) return null;
  if (fallos.length === resultados.length) return null;

  const numerico = (valor: unknown): number | null =>
    typeof valor === "number" && Number.isFinite(valor) ? valor : null;
  const total =
    numerico(bruto.totalDevices) ?? numerico(bruto.total) ?? resultados.length;
  const cuantos = numerico(bruto.failCount) ?? fallos.length;
  const nombres = fallos
    .map(
      (fila: any) =>
        `'${fila?.device ?? fila?.name ?? fila?.target ?? "?"}'` +
        (fila?.error ? ` (${String(fila.error)})` : ""),
    )
    .join(", ");

  return `En la operación en lote fallaron ${cuantos} de ${total}: ${nombres}.`;
}

export interface ContenidoLogOperacion {
  titulo: string;
  content: string;
}

function recortado(texto: string, maximo = 200): string {
  const limpio = texto.trim();
  return limpio.length > maximo
    ? `${limpio.substring(0, maximo)}...`
    : limpio;
}

export function contenidoDeLogDeOperacion(args: {

  resultado: unknown;

  tituloOk: string;

  tituloFallo: string;

  exito: string;

  intento: string;

  detalle?: string | null;
}): ContenidoLogOperacion {
  const bruto = payloadDe(args.resultado);

  if (operacionOk(bruto)) {
    const extras: string[] = [];
    if (args.detalle) extras.push(args.detalle);
    const mensaje = textoONull(bruto?.message);
    if (mensaje) extras.push(`respuesta de Packet Tracer: ${recortado(mensaje)}`);
    return {
      titulo: args.tituloOk,
      content: `${args.exito}${extras.length > 0 ? ` | ${extras.join(" | ")}` : "."}`,
    };
  }

  const motivo =
    textoONull(bruto?.error) ??
    (bruto && typeof bruto === "object" ? textoONull(bruto.message) : null);

  const causas: string[] = [];
  if (motivo) causas.push(`Causa informada por Packet Tracer: ${recortado(motivo)}.`);
  if (args.detalle) causas.push(`Detalle: ${args.detalle}`);
  const causa =
    causas.length > 0
      ? causas.join(" ")
      : "Packet Tracer no confirmó la operación ni devolvió un motivo, así que " +
        "no se puede afirmar que se aplicara.";

  return {
    titulo: args.tituloFallo,
    content: `${args.intento}, pero la operación NO se pudo completar (la extensión no la confirmó). ${causa}`,
  };
}

async function registrarOperacion(
  level: string,
  args: Parameters<typeof contenidoDeLogDeOperacion>[0],
): Promise<void> {
  const { titulo, content } = contenidoDeLogDeOperacion(args);
  await createLog({ level, title: titulo, content });
}

const createTopologyTool = tool(
  async ({ name, description }) => {
    const currentUser = await getCurrentUser();

    if (!currentUser.success || !currentUser.data?.id) {
      return JSON.stringify({
        success: false,
        message: "Usuario no autorizado o no encontrado.",
      });
    }

    const ownerId = currentUser.data.id;

    const resultado = await topologyService.createOrUpdate({
      name,
      description,
      topologyJson: "{}",
      owner: {
        connect: {
          id: ownerId,
        },
      },
    });

    const normalizado: Record<string, unknown> = {
      success: (resultado as { succes?: boolean })?.succes === true,
      message: resultado?.message,
      data: resultado?.data,
    };

    await registrarOperacion("CREATE", {
      resultado: normalizado,
      tituloOk: "Topología Inicializada",
      tituloFallo: "Topología No Inicializada",
      exito: `Nueva topología creada: '${name}' | Descripción: ${description || "Ninguna"}.`,
      intento: `Se intentó crear la topología '${name}'`,
    });

    return JSON.stringify(normalizado);
  },
  {
    name: "createTopology",
    description:
      "Create a new topology in the Packet Tracer workspace; use when starting a project before adding devices.",
    schema: z.object({
      name: z.string().describe("Topology name"),
      description: z
        .string()
        .optional()
        .describe("Topology description (optional)"),
    }),
  },
);

const addDeviceTool = tool(
  async ({ deviceName, deviceModel, x, y }) => {

    const catalogo = await leerCatalogoDeModelos();
    if (catalogo.length === 0) {
      return JSON.stringify({
        success: false,
        error:
          `No se pudo leer el catálogo de modelos de Packet Tracer, así que no se ` +
          `puede confirmar que '${deviceModel}' exista y NO se coloca ningún equipo. ` +
          `Comprueba que Packet Tracer está abierto con el motor conectado y llama a ` +
          `listDeviceModels para ver el catálogo.`,
      });
    }

    const validacion = validarModeloDeDispositivo(deviceModel, catalogo);
    if (!validacion.ok) {
      return JSON.stringify({
        success: false,
        error: validacion.error,
        sugerencias: validacion.sugerencias,
        modelosDisponibles: catalogo.length,
      });
    }

    const result = await ciscoClient.callTool("addDevice", {
      deviceName,
      deviceModel: validacion.modelo,
      x,
      y,
    });

    await registrarOperacion("CREATE", {
      resultado: result,
      tituloOk: "Dispositivo Agregado",
      tituloFallo: "Dispositivo No Agregado",
      exito: `Dispositivo '${deviceName}' (${validacion.modelo}) posicionado en [X: ${x}, Y: ${y}].`,
      intento: `Se intentó colocar '${deviceName}' (${validacion.modelo}) en [X: ${x}, Y: ${y}]`,
    });

    return JSON.stringify(result);
  },
  {
    name: "addDevice",
    description:
      "Add a device to the Packet Tracer workspace at spread-out x/y coordinates; names must be unique. deviceModel must be a model id that Packet Tracer really has (e.g. 2911, 2960-24TT, Router-PT, Switch-PT, PC-PT, Server-PT, Laptop-PT): the model is checked against the engine's own catalogue with listDeviceModels before the device is placed, and an unknown one is rejected here with the closest valid ids, so do not invent model names and do not assume the tool only accepts a short fixed list.",
    schema: z.object({
      deviceName: z
        .string()
        .describe("Unique device name, e.g. Router0 or PC1"),
      deviceModel: z
        .string()
        .min(1)
        .describe(
          "Model id exactly as Packet Tracer names it, e.g. '2911', '2960-24TT', 'Router-PT', 'Switch-PT', 'PC-PT'; call listDeviceModels to see every model this engine accepts",
        ),
      x: z.number().describe("Canvas X coordinate"),
      y: z.number().describe("Canvas Y coordinate"),
    }),
  },
);

const addModuleTool = tool(
  async ({ deviceName, slot, model }) => {
    const result = await ciscoClient.callTool("addModule", {
      deviceName,
      slot,
      model,
    });

    await registrarOperacion("MODULE", {
      resultado: result,
      tituloOk: "Hardware Modificado",
      tituloFallo: "Hardware No Modificado",
      exito: `Módulo '${model}' instalado correctamente en Slot ${slot} de '${deviceName}'.`,
      intento: `Se intentó instalar el módulo '${model}' en el Slot ${slot} de '${deviceName}'`,
    });

    return JSON.stringify(result);
  },
  {
    name: "addModule",
    description:
      "Install a physical interface module into a device slot in Packet Tracer (it powers the device off and back on); use when ports run out.",
    schema: z.object({
      deviceName: z.string().describe("Name of an existing device"),
      slot: z
        .number()
        .int()
        .min(0)
        .max(3)
        .describe("Expansion slot number (0-3)"),
      model: z
        .string()
        .describe(
          "Module model, e.g. 'HWIC-2T' (serial) or 'NM-4E' (ethernet)",
        ),
    }),
  },
);

const addLinkTool = tool(
  async ({
    device1Name,
    device1Interface,
    device2Name,
    device2Interface,
    linkType,
  }) => {
    const result = await ciscoClient.callTool("addLink", {
      device1Name,
      device1Interface,
      device2Name,
      device2Interface,
      linkType,
    });

    await registrarOperacion("LINK", {
      resultado: result,
      tituloOk: "Enlace Conectado",
      tituloFallo: "Enlace No Conectado",
      exito: `${device1Name} (${device1Interface}) <===[${linkType}]===> ${device2Name} (${device2Interface}).`,
      intento: `Se intentó cablear ${device1Name} (${device1Interface}) <===[${linkType}]===> ${device2Name} (${device2Interface})`,
      detalle: detalleDeFallosParciales(result),
    });

    return JSON.stringify(result);
  },
  {
    name: "addLink",
    description:
      "Connect two devices with a cable in Packet Tracer; both interfaces must be free (in_use=false). Reuse the port data you already read this turn; call getDeviceInfo only if a port was rejected or the topology changed since your last read.",
    schema: z.object({
      device1Name: z.string().describe("Name of the first device"),
      device1Interface: z
        .string()
        .describe(
          "Free interface on device 1, e.g. GigabitEthernet0/0",
        ),
      device2Name: z.string().describe("Name of the second device"),
      device2Interface: z
        .string()
        .describe("Free interface on device 2"),
      linkType: z
        .enum(ALLOWED_LINK_TYPES)
        .describe(
          "'straight' LAN, 'cross' PC-PC, 'serial' WAN, 'fiber', 'auto'",
        ),
    }),
  },
);

const removeDeviceTool = tool(
  async ({ deviceNames }) => {
    const result = await ciscoClient.callTool("removeDevice", { deviceNames });

    await registrarOperacion("DELETE", {
      resultado: result,
      tituloOk: "Dispositivo Eliminado",
      tituloFallo: "Dispositivo No Eliminado",
      exito: `Removido(s) de la red: ${deviceNames.join(", ")}.`,
      intento: `Se intentó eliminar de la red: ${deviceNames.join(", ")}`,

      detalle: detalleDeFallosParciales(result),
    });

    return JSON.stringify(result);
  },
  {
    name: "removeDevice",
    description:
      "Remove one or more devices from the Packet Tracer workspace using an array of names.",
    schema: z.object({
      deviceNames: z
        .array(z.string())
        .describe("Array of device names to delete"),
    }),
  },
);

const removeLinkTool = tool(
  async ({ links }) => {
    const result = await ciscoClient.callTool("removeLink", { links });

    const detalleEnlaces = links
      .map((l) => `${l.device} (${l.port})`)
      .join(" || ");
    await registrarOperacion("DELETE", {
      resultado: result,
      tituloOk: "Enlace Desconectado",
      tituloFallo: "Enlace No Desconectado",
      exito: `Cable removido de las interfaces: ${detalleEnlaces}.`,
      intento: `Se retiró el cable de las interfaces: ${detalleEnlaces}`,
      detalle: detalleDeFallosParciales(result),
    });

    return JSON.stringify(result);
  },
  {
    name: "removeLink",
    description:
      "Remove one or more cables in Packet Tracer; each entry identifies one endpoint by device and port.",
    schema: z.object({
      links: z
        .array(
          z.object({
            device: z
              .string()
              .describe("Device name at one end of the link"),
            port: z
              .string()
              .describe(
                "Interface/port at that end, e.g. FastEthernet0/1",
              ),
          }),
        )
        .describe("Array of link endpoints (device + port) to remove"),
    }),
  },
);

const configurePcIpTool = tool(
  async ({
    deviceName,
    dhcpEnabled,
    ipaddress,
    subnetMask,
    defaultGateway,
    dnsServer,
  }) => {
    const result = await ciscoClient.callTool("configurePcIp", {
      deviceName,
      dhcpEnabled,
      ipaddress,
      subnetMask,
      defaultGateway,
      dnsServer,
    });

    const modoText = dhcpEnabled
      ? "DHCP"
      : `Estática [IP: ${ipaddress} | Mask: ${subnetMask}]`;
    await registrarOperacion("CONFIGURE", {
      resultado: result,
      tituloOk: "Configuración IP Host",
      tituloFallo: "Configuración IP Host No Realizada",
      exito: `'${deviceName}' direccionada vía ${modoText} | GW: ${defaultGateway || "N/A"}.`,
      intento: `Se intentó direccionar '${deviceName}' vía ${modoText} | GW: ${defaultGateway || "N/A"}`,
    });

    return JSON.stringify(result);
  },
  {
    name: "configurePcIp",
    description:
      "Configure IP settings on a PC, Laptop, Server or Printer in Packet Tracer; use static or DHCP addressing. It only configures the FastEthernet0 port (the main NIC) of that device. With dhcpEnabled=false you MUST send ipaddress AND subnetMask together: the tool rejects the call otherwise, because Packet Tracer would answer success while applying nothing.",
    schema: z
      .object({
        deviceName: z.string().describe("Name of the existing host"),
        dhcpEnabled: z
          .boolean()
          .describe(
            "true = DHCP, false = static IP (ipaddress and subnetMask are then REQUIRED)",
          ),
        ipaddress: z
          .string()
          .optional()
          .describe(
            "Static IP address for FastEthernet0 (required when dhcpEnabled=false)",
          ),
        subnetMask: z
          .string()
          .optional()
          .describe(
            "Subnet mask for FastEthernet0 (required when dhcpEnabled=false)",
          ),
        defaultGateway: z
          .string()
          .optional()
          .describe("Default gateway IP address"),
        dnsServer: z.string().optional().describe("DNS server IP address"),
      })

      .superRefine((valor, ctx) => {
        if (valor.dhcpEnabled !== false) return;
        if (!valor.ipaddress?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ipaddress"],
            message:
              "Con dhcpEnabled=false es obligatorio enviar 'ipaddress': sin IP y máscara la extensión responde success:true sin configurar nada.",
          });
        }
        if (!valor.subnetMask?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["subnetMask"],
            message:
              "Con dhcpEnabled=false es obligatorio enviar 'subnetMask': la extensión solo aplica la IP si llegan ipaddress Y subnetMask.",
          });
        }
      }),
  },
);

const MODO_CONFIGURACION = "global";

export const COMANDO_GUARDADO_NVRAM = "do write memory";

export const MAX_LINEAS_LOTE = 120;

export const MAX_CARACTERES_LINEA = 200;

export const PRESUPUESTO_CICLO_CONFIG_MS = 25_000;

export const TECHO_RESPALDO_CONFIG_MS = TIMEOUT_POR_HERRAMIENTA.runDeviceCommands;

export type LoteConfiguracion =
  | { ok: true; lineas: string[] }
  | { ok: false; error: string };

export function parsearLoteConfiguracion(commands: string): LoteConfiguracion {
  const lineas = String(commands ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0);

  if (lineas.length === 0) {
    return {
      ok: false,
      error:
        "No se envió ninguna línea de configuración: escribe los comandos IOS uno por línea (hostname, interface, ip address, ...).",
    };
  }
  if (lineas.length > MAX_LINEAS_LOTE) {
    return {
      ok: false,
      error: `El lote tiene ${lineas.length} líneas y el máximo por llamada es ${MAX_LINEAS_LOTE}: divídelo en varias llamadas más cortas.`,
    };
  }
  const larga = lineas.find((linea) => linea.length > MAX_CARACTERES_LINEA);
  if (larga) {
    return {
      ok: false,
      error: `Una línea del lote supera los ${MAX_CARACTERES_LINEA} caracteres ('${larga.substring(0, 40)}...'): envía un comando por línea.`,
    };
  }
  return { ok: true, lineas };
}

export interface ExpectativasLote {

  hostname: string | null;

  ips: Array<{ ip: string; mascara: string }>;
}

export function extraerExpectativas(lineas: string[]): ExpectativasLote {
  let hostname: string | null = null;
  const ips: Array<{ ip: string; mascara: string }> = [];

  for (const linea of lineas) {
    if (hostname === null) {
      const host = /^hostname\s+(\S+)\s*$/i.exec(linea);
      if (host) {
        hostname = host[1];
        continue;
      }
    }
    const dir = /^ip\s+address\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+(\S+))?\s*$/i.exec(
      linea,
    );
    if (!dir) continue;
    const ip = dir[1];
    const mascara = dir[2] ?? "";
    if (ips.some((entrada) => entrada.ip === ip && entrada.mascara === mascara)) {
      continue;
    }
    ips.push({ ip, mascara });
  }

  return { hostname, ips };
}

export interface DatoVerificado {

  dato: string;

  esperado: string;

  encontrado: string;
  ok: boolean;
}

export interface Verificacion {

  realizada: boolean;

  ok: boolean;
  datos: DatoVerificado[];

  nvr: DatoVerificado | null;

  motivo?: string;
}

export function verificacionNoRealizada(motivo: string): Verificacion {
  return { realizada: false, ok: false, datos: [], nvr: null, motivo };
}

function hostnameEn(config: string): string | null {
  const found = /^\s*hostname\s+(\S+)\s*$/im.exec(config);
  return found ? found[1] : null;
}

function lineaIpEn(config: string, ip: string, mascara?: string): string | null {
  for (const bruta of config.split(/\r?\n/)) {
    const linea = bruta.trim();
    const found = /^ip\s+address\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+(\S+))?/i.exec(linea);
    if (!found || found[1] !== ip) continue;
    if (mascara !== undefined && found[2] !== mascara) continue;
    return linea;
  }
  return null;
}

function textoONull(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0 ? valor : null;
}

export function verificarLoteContraConfig(
  expectativas: ExpectativasLote,
  snapshot: any,
  deviceName: string,
): Verificacion {
  const config = extraerConfiguracion(snapshot);
  if (!config) {
    return verificacionNoRealizada(
      `Packet Tracer no devolvió la configuración de '${deviceName}' ` +
        `(startup/running-config vacíos o ilegibles` +
        `${snapshot?.warning ? `, aviso '${String(snapshot.warning)}'` : ""}` +
        `), así que no se puede afirmar qué se aplicó`,
    );
  }

  const datos: DatoVerificado[] = [];

  if (expectativas.hostname) {
    const actual = hostnameEn(config);
    const ok =
      actual !== null &&
      actual.toLowerCase() === expectativas.hostname.toLowerCase();
    datos.push({
      dato: "hostname",
      esperado: `hostname ${expectativas.hostname}`,
      encontrado: actual
        ? `hostname ${actual}`
        : "(no aparece ningún hostname en la configuración leída)",
      ok,
    });
  }

  for (const enviada of expectativas.ips) {
    const esperado = `ip address ${enviada.ip}${enviada.mascara ? ` ${enviada.mascara}` : ""}`;
    const exacta = lineaIpEn(config, enviada.ip, enviada.mascara || undefined);
    const conIp = exacta ?? lineaIpEn(config, enviada.ip);
    datos.push({
      dato: "ip address",
      esperado,
      encontrado: exacta
        ? exacta
        : conIp
          ? `${conIp} (con OTRA máscara de la enviada)`
          : "(no aparece esa dirección en la configuración leída)",
      ok: exacta !== null,
    });
  }

  return {
    realizada: true,
    ok: datos.every((dato) => dato.ok),
    datos,
    nvr: verificarNvrAm(expectativas, snapshot),
  };
}

function verificarNvrAm(
  expectativas: ExpectativasLote,
  snapshot: any,
): DatoVerificado {
  const esperado = `startup-config con lo aplicado tras '${COMANDO_GUARDADO_NVRAM}'`;
  const startup = textoONull(
    snapshot?.startupConfig ?? snapshot?.result?.startupConfig,
  );

  if (snapshot?.startupEmpty === true || !startup) {
    return {
      dato: "nvram",
      esperado,
      encontrado:
        "(startup-config vacío: el guardado no se ha podido confirmar en Packet Tracer)",
      ok: false,
    };
  }

  const faltan: string[] = [];

  if (expectativas.hostname) {
    const guardado = hostnameEn(startup);
    if (
      !guardado ||
      guardado.toLowerCase() !== expectativas.hostname.toLowerCase()
    ) {
      faltan.push(
        `hostname ${expectativas.hostname} (el startup-config tiene ${
          guardado ? `'${guardado}'` : "ningún hostname"
        })`,
      );
    }
  }

  for (const enviada of expectativas.ips) {
    const linea = lineaIpEn(startup, enviada.ip, enviada.mascara || undefined);
    if (!linea) {
      faltan.push(
        `ip address ${enviada.ip}${enviada.mascara ? ` ${enviada.mascara}` : ""}`,
      );
    }
  }

  if (faltan.length > 0) {
    return {
      dato: "nvram",
      esperado,
      encontrado: `el startup-config NO tiene: ${faltan.join(" ; ")}`,
      ok: false,
    };
  }

  return {
    dato: "nvram",
    esperado,
    encontrado: `el startup-config ya tiene lo aplicado (${startup.split(/\r?\n/).length} línea(s))`,
    ok: true,
  };
}

export interface EquipoRevisado {
  model: string | null;
  type: string | number | null;
  ips: string[];
  consolaIos: boolean;

  clase: ClaseEquipo;

  criterio: string;

  motivo: string;

  sinIpAntes: boolean;
}

export interface PreFlightConfig {
  ok: boolean;
  error?: string;
  equipo?: EquipoRevisado;
}

export function revisarEquipoParaConfig(
  info: any,
  deviceName: string,
  lineas: string[],
): PreFlightConfig {
  const vacio: EquipoRevisado = {
    model: null,
    type: null,
    ips: [],
    consolaIos: false,
    clase: "desconocido",
    criterio: "ninguno",
    motivo: "Packet Tracer no devolvió la ficha del equipo",
    sinIpAntes: true,
  };

  if (!info || typeof info !== "object") {
    return {
      ok: false,
      error: `Packet Tracer no devolvió datos de '${deviceName}': no se envía el lote. Revisa que el workspace esté abierto y el equipo exista.`,
      equipo: vacio,
    };
  }
  if (info.success === false || info.error) {
    return {
      ok: false,
      error: `El equipo '${deviceName}' no está en la topología (${String(info.error ?? "no encontrado")}): no se envía el lote.`,
      equipo: vacio,
    };
  }

  const dispositivo = info?.result?.device ?? info?.device;
  if (!dispositivo || typeof dispositivo !== "object") {
    return {
      ok: false,
      error: `Packet Tracer no devolvió la ficha de '${deviceName}': no se envía el lote.`,
      equipo: vacio,
    };
  }

  const ips = direccionamientoDe(dispositivo).ips;
  const clasificacion = clasificarEquipo(dispositivo);
  const equipo: EquipoRevisado = {
    model: textoONull(dispositivo?.model),
    type:
      typeof dispositivo?.type === "number" || typeof dispositivo?.type === "string"
        ? dispositivo.type
        : null,
    ips,
    consolaIos: clasificacion.consolaIos,
    clase: clasificacion.clase,
    criterio: clasificacion.criterio,
    motivo: clasificacion.motivo,
    sinIpAntes: ips.length === 0,
  };

  if (clasificacion.clase === "desconocido") {
    return {
      ok: false,
      error:
        `No se puede determinar si '${deviceName}' tiene consola IOS: ${clasificacion.motivo}. ` +
        `No se envía el lote porque a ciegas se perdería. Vuelve a leer la ficha del ` +
        `equipo con getDeviceInfo (comprueba que Packet Tracer esté abierto con el ` +
        `motor conectado); si el equipo es final, usa configurePcIp para su ` +
        `dirección y runDeviceCommand para leerlo.`,
      equipo,
    };
  }

  if (!clasificacion.consolaIos) {
    return {
      ok: false,
      error:
        `'${deviceName}' (${equipo.model ?? "equipo final"}) es un equipo final y no tiene ` +
        `consola IOS: un lote de configuración se perdería (${clasificacion.motivo}). Para su ` +
        `dirección usa configurePcIp, y para leerlo runDeviceCommand.`,
      equipo,
    };
  }

  if (ips.length === 0 && extraerExpectativas(lineas).ips.length === 0) {
    return {
      ok: false,
      error:
        `'${deviceName}' no tiene ninguna IP configurada en ninguna interfaz y el lote ` +
        `no incluye ninguna línea 'ip address ...': no se envía nada, porque el lote se ` +
        `perdería. Direcciona el equipo primero (configurePcIp en el host, o un lote con ` +
        `la línea 'ip address <ip> <mascara>' aquí) y vuelve a intentarlo.`,
      equipo,
    };
  }

  return { ok: true, equipo };
}

function faltantesDe(verificacion: Verificacion): string[] {
  return verificacion.datos
    .filter((dato) => !dato.ok)
    .map((dato) => `${dato.esperado} -> ${dato.encontrado}`);
}

export function contenidoDeLogConfiguracion(args: {
  deviceName: string;
  lineas: string[];
  exito: boolean;
  verificacion: Verificacion;
  problema?: string;
}): string {
  const resumen = args.lineas.join(" ; ");
  const recortado = `${resumen.substring(0, 60)}${resumen.length > 60 ? "..." : ""}`;
  const datos = args.verificacion.datos;

  if (!args.exito) {
    const encontrados =
      datos.length === 0
        ? "sin datos contrastables"
        : datos
            .map((dato) => `${dato.esperado}: ${dato.encontrado}`)
            .join(" ; ");
    return (
      `'${args.deviceName}': Comandos enviados [ ${recortado} ] | ` +
      `resultado: ${args.problema ?? "sin confirmar"} | ` +
      `verificación: ${encontrados}. NVRAM sin confirmar: no se puede afirmar el guardado.`
    );
  }

  const verificado =
    datos.length === 0
      ? "el lote no traía hostname ni ip address, así que no hay nada contrastable"
      : `verificado leyendo la configuración: ${datos
          .map((dato) => dato.esperado)
          .join(" ; ")}`;

  if (args.verificacion.nvr?.ok === true) {
    return `'${args.deviceName}': Comandos aplicados [ ${recortado} ] y guardados en NVRAM (${verificado}).`;
  }
  const detalleNvr = args.verificacion.nvr
    ? args.verificacion.nvr.encontrado
    : "el snapshot no informó del startup-config";
  return `'${args.deviceName}': Comandos aplicados [ ${recortado} ] (${verificado}); la persistencia en NVRAM no se pudo confirmar (${detalleNvr}).`;
}

const configureIosDeviceTool = tool(
  async ({ deviceName, commands }) => {

    const lote = parsearLoteConfiguracion(commands);
    if (!lote.ok) {
      return JSON.stringify({ success: false, error: lote.error });
    }

    const info = payloadDe(
      await ciscoClient.callTool("getDeviceInfo", { deviceName }),
    );
    const preflight = revisarEquipoParaConfig(info, deviceName, lote.lineas);
    if (!preflight.ok) {

      return JSON.stringify({
        success: false,
        error: preflight.error,
        equipo: preflight.equipo,
      });
    }

    const loteCompleto = [...lote.lineas, COMANDO_GUARDADO_NVRAM];
    const ciclo = await ejecutarYEsperar(deviceName, loteCompleto, {
      mode: MODO_CONFIGURACION,
      budgetMs: PRESUPUESTO_CICLO_CONFIG_MS,
      fallbackTimeoutMs: TECHO_RESPALDO_CONFIG_MS,

      reintentable: false,
      nombreTool: "configureIosDevice",
    });

    const expectativas = extraerExpectativas(lote.lineas);
    const verificacion = ciclo.timedOut
      ? verificacionNoRealizada(
          `el lote agotó el presupuesto (${ciclo.intentos} sondeo(s)) y puede seguir ` +
            `ejecutándose en Packet Tracer: no se lee la configuración para no dar un ` +
            `retrato a medias. Espera unos segundos y léela con getDeviceConfig.`,
        )
      : verificarLoteContraConfig(
          expectativas,
          payloadDe(
            await ciscoClient.callTool("getDeviceConfigSnapshot", { deviceName }),
          ),
          deviceName,
        );

    const payload = payloadDeConfigureIosDevice(ciclo, verificacion, preflight.equipo);

    await createLog({
      level: "CONFIGURE",
      title: "CLI Cisco IOS",
      content: contenidoDeLogConfiguracion({
        deviceName,
        lineas: lote.lineas,
        exito: payload.success === true,
        verificacion,
        problema: typeof payload.error === "string" ? payload.error : undefined,
      }),
    });

    return JSON.stringify(payload);
  },
  {
    name: "configureIosDevice",
    description:
      "Run Cisco IOS CLI commands on a router or switch (global config mode), save them to NVRAM and then READ BACK the configuration to confirm what was applied. It first checks the device exists, has an IOS console and is already addressed (it refuses to write otherwise), and it never retries a batch that a pending prompt ate: on doubt it reports what it found in 'verificado' with verificacionOk=false. Read 'verificado' to see what was expected and what is really there, and 'summary'/'results' for the per-line status; for read-only checks (show, ping, ...) use runDeviceCommand instead.",
    schema: z.object({
      deviceName: z.string().describe("Router or switch device name"),
      commands: z
        .string()
        .describe(
          "Commands to run in order, one per line (the NVRAM save is appended automatically)",
        ),
    }),
  },
);

export function payloadDeConfigureIosDevice(
  ciclo: ResultadoCiclo,
  verificacion: Verificacion,
  equipo?: EquipoRevisado,
): Record<string, unknown> {

  const salidaReal = ciclo.results.length > 0 && ciclo.fuente !== "buffer";
  const cicloOk =
    !ciclo.fallo && !ciclo.timedOut && salidaReal && ciclo.resumen.errors === 0;
  const exito = cicloOk && verificacion.ok;

  const payload: Record<string, unknown> = {

    ...ciclo.diagnostico,
    success: exito,
    deviceName: ciclo.deviceName,
    deviceType: ciclo.deviceType,
    results: ciclo.results,
    summary: ciclo.resumen,

    fuente: ciclo.fuente,
    pendienteMs: ciclo.pendienteMs,
    intentos: ciclo.intentos,
    timedOut: ciclo.timedOut,
    cicloOk,
    reintentado: ciclo.reintentado,
    comandoConsumido: ciclo.comandoConsumido === true,
    verificacionOk: verificacion.ok,
    verificacionRealizada: verificacion.realizada,
    verificado: verificacion.datos,
    nvr: verificacion.nvr,
  };

  if (verificacion.motivo) payload.verificacionMotivo = verificacion.motivo;
  if (equipo) payload.equipo = equipo;
  if (ciclo.respaldo) payload.respaldo = ciclo.respaldo;
  if (ciclo.motivoReintento) payload.motivoReintento = ciclo.motivoReintento;
  if (ciclo.bloqueoResuelto) payload.bloqueoResuelto = ciclo.bloqueoResuelto;
  if (ciclo.bloqueoAgotado) payload.bloqueoAgotado = true;

  if (!exito) {
    const partes: string[] = [];
    if (ciclo.comandoConsumido) {
      partes.push(
        `un prompt pendiente (${ciclo.bloqueoResuelto ?? "motivo desconocido"}) se comió ` +
          `el comando tecleado y NO se ha repetido: re-ejecutar el lote aplicaría la ` +
          `configuración dos veces`,
      );
    }
    if (ciclo.bloqueoAgotado) {
      partes.push(
        "el prompt pendiente no se deja pagar automáticamente: hay que atender la consola",
      );
    }
    if (ciclo.timedOut) {
      partes.push(
        `el lote no terminó en el presupuesto (${ciclo.intentos} sondeo(s)) y puede seguir ` +
          `ejecutándose en Packet Tracer`,
      );
    }
    if (ciclo.fallo) partes.push(ciclo.fallo);
    if (
      !ciclo.comandoConsumido &&
      !ciclo.timedOut &&
      !ciclo.fallo &&
      salidaReal &&
      ciclo.resumen.errors > 0
    ) {
      partes.push(
        `${ciclo.resumen.errors} de ${ciclo.resumen.total} línea(s) devolvieron error`,
      );
    }
    if (!salidaReal && !ciclo.fallo && !ciclo.timedOut) {
      partes.push("Packet Tracer no devolvió salida del lote");
    }

    if (!verificacion.realizada) {
      partes.push(`no se pudo verificar: ${verificacion.motivo ?? "sin motivo"}`);
    } else {
      const faltan = faltantesDe(verificacion);
      if (faltan.length > 0) {
        partes.push(`la configuración leída NO contiene: ${faltan.join(" ; ")}`);
      }
    }

    payload.error =
      partes.join(" | ") || "Packet Tracer no confirmó la aplicación del lote.";
    payload.aviso =
      `NO repitas el lote completo: ya se tecleó y parte de él puede haberse aplicado, ` +
      `así que reenviarlo lo aplicaría dos veces. Lee la consola (readDeviceConsole) y ` +
      `la configuración (getDeviceConfig) y, si hace falta, envía un lote nuevo SÓLO con ` +
      `las líneas que falten.`;
  } else if (equipo?.sinIpAntes === true) {

    payload.aviso =
      `'${ciclo.deviceName}' no tenía ninguna IP configurada antes de este lote ` +
      `(el lote la direcciona): la verificación posterior es la que confirma que ` +
      `quedó aplicada.`;
  }

  return payload;
}

const getNetworkTool = tool(
  async () => {
    const result = await ciscoClient.callTool("getNetwork", {});

    await createLog({
      level: "INFO",
      title: "Auditoría de Red",
      content:
        "Snapshot e inventario completo de la topología extraídos de Packet Tracer.",
    });

    return JSON.stringify(result);
  },
  {
    name: "getNetwork",
    description:
      "Read a full Packet Tracer snapshot of devices, interfaces in use and links; the usual starting point for troubleshooting. Read it once per turn and work from that copy unless something changed since.",
    schema: z.object({}),
  },
);

const getDeviceInfoTool = tool(
  async ({ deviceName }) => {
    const result = await ciscoClient.callTool("getDeviceInfo", { deviceName });

    await createLog({
      level: "INFO",
      title: "Consulta de Equipo",
      content: `Inspección de interfaces y estados físicos del dispositivo '${deviceName}'.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "getDeviceInfo",
    description:
      "Read full details of one device: model, interfaces, ports and attached links. Read it when you lack that data or after a mutation changed the device, not before every configuration or wiring step.",
    schema: z.object({
      deviceName: z.string().describe("Device name to inspect"),
    }),
  },
);

const setSimulationModeTool = tool(
  async ({ toSimMode }) => {
    const result = await ciscoClient.callTool("setSimulationMode", {
      toSimMode,
    });
    return JSON.stringify(result);
  },
  {
    name: "setSimulationMode",
    description:
      "Switch Packet Tracer between simulation mode (true) and real-time mode (false). Needed before sending PDUs; if you already switched it this turn, do not read or set it again.",
    schema: z.object({
      toSimMode: z
        .boolean()
        .describe("true = simulation mode, false = real-time mode"),
    }),
  },
);

const getSimulationStatusTool = tool(
  async () => {
    const result = await ciscoClient.callTool("getSimulationStatus", {});
    return JSON.stringify(result);
  },
  {
    name: "getSimulationStatus",
    description:
      "Report the simulation state: active mode, elapsed time and PDU frame counters.",
    schema: z.object({}),
  },
);

const stepSimulationTool = tool(
  async ({ direction, steps }) => {
    const result = await ciscoClient.callTool("stepSimulation", {
      direction,
      steps,
    });
    return JSON.stringify(result);
  },
  {
    name: "stepSimulation",
    description:
      "Step the simulation forward, backward or reset it. Requires simulation mode active.",
    schema: z.object({
      direction: z
        .enum(["forward", "backward", "reset"])
        .describe(
          "'forward' avanza un paso, 'backward' retrocede, 'reset' limpia todo al tiempo cero",
        ),
      steps: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(1)
        .describe("Number of steps to take (ignored on 'reset')"),
    }),
  },
);

const sendPduTool = tool(
  async ({ sourceDevice, destinationDevice }) => {
    const result = await ciscoClient.callTool("sendPdu", {
      sourceDevice,
      destinationDevice,
    });

    await createLog({
      level: "INFO",
      title: "Tráfico Generado",
      content: `Inyección ICMP (Ping): [${sourceDevice}] ===> [${destinationDevice}] en entorno de simulación.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "sendPdu",
    description:
      "Create and send a native ICMP ping (Simple PDU) between two devices; simulation mode is enabled automatically.",
    schema: z.object({
      sourceDevice: z.string().describe("Source device name"),
      destinationDevice: z.string().describe("Destination device name"),
    }),
  },
);

const renameDeviceTool = tool(
  async ({ deviceName, newName }) => {
    const result = await ciscoClient.callTool("renameDevice", {
      deviceName,
      newName,
    });

    await registrarOperacion("CONFIGURE", {
      resultado: result,
      tituloOk: "Dispositivo Renombrado",
      tituloFallo: "Dispositivo No Renombrado",
      exito: `Identificador modificado: '${deviceName}' cambiado a '${newName}'.`,
      intento: `Se cambió el identificador de '${deviceName}' a '${newName}'`,
    });

    return JSON.stringify(result);
  },
  {
    name: "renameDevice",
    description:
      "Rename a device in the topology; the new name must be unique.",
    schema: z.object({
      deviceName: z.string().describe("Current device name"),
      newName: z.string().describe("New unique name"),
    }),
  },
);

const moveDeviceTool = tool(
  async ({ deviceName, x, y }) => {
    const result = await ciscoClient.callTool("moveDevice", {
      deviceName,
      x,
      y,
    });

    await registrarOperacion("INFO", {
      resultado: result,
      tituloOk: "Lienzo Actualizado",
      tituloFallo: "Lienzo No Actualizado",
      exito: `Dispositivo '${deviceName}' reposicionado a coordenadas (${x}, ${y}).`,
      intento: `Se reposicionó '${deviceName}' a las coordenadas (${x}, ${y})`,
    });

    return JSON.stringify(result);
  },
  {
    name: "moveDevice",
    description:
      "Move a device to new x/y coordinates on the logical canvas to avoid overlaps.",
    schema: z.object({
      deviceName: z.string().describe("Device name to move"),
      x: z.number().describe("Nueva coordenada X"),
      y: z.number().describe("Nueva coordenada Y"),
    }),
  },
);

const setPowerTool = tool(
  async ({ deviceName, power }) => {
    const result = await ciscoClient.callTool("setPower", {
      deviceName,
      power,
    });

    await registrarOperacion("CONFIGURE", {
      resultado: result,
      tituloOk: power ? "Equipo Encendido" : "Equipo Apagado",
      tituloFallo: power ? "Equipo No Encendido" : "Equipo No Apagado",
      exito: `Estado de alimentación de '${deviceName}' cambiado a: ${power ? "ENCENDIDO" : "APAGADO"}.`,
      intento: `Se cambió el estado de alimentación de '${deviceName}' a ${power ? "ENCENDIDO" : "APAGADO"}`,
    });

    return JSON.stringify(result);
  },
  {
    name: "setPower",
    description: "Turn a device on or off.",
    schema: z.object({
      deviceName: z.string().describe("Device name"),
      power: z.boolean().describe("true = encender, false = apagar"),
    }),
  },
);

const getPduResultsTool = tool(
  async ({ types }) => {
    const result = await ciscoClient.callTool("getPduResults", { types });
    return JSON.stringify(result);
  },
  {
    name: "getPduResults",
    description:
      "Read simulated traffic results (source, destination, packet status). Call it after sendPdu/stepSimulation to confirm connectivity: one read at the end of each verification phase is enough.",
    schema: z.object({
      types: z
        .array(z.string())
        .optional()
        .describe(
          "Optional protocol filter (e.g. ['ICMP', 'ARP']) to remove background noise",
        ),
    }),
  },
);

const getCommandLogTool = tool(
  async ({ deviceName, limit }) => {
    const result = await ciscoClient.callTool("getCommandLog", {
      deviceName,
      limit,
    });

    await createLog({
      level: "INFO",
      title: "Historial CLI Solicitado",
      content: `Extracción de logs de consola de comandos IOS${deviceName ? ` para '${deviceName}'` : " generales"}.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "getCommandLog",
    description:
      "Read the IOS command history recorded by Packet Tracer.",
    schema: z.object({
      deviceName: z
        .string()
        .optional()
        .describe("Filter by a specific device; omit to list all"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe(
          "Max records to return, newest first",
        ),
    }),
  },
);

const TOPOLOGIES_DIR = path.resolve(process.cwd(), "uploads", "topologies");

const REGEX_NOMBRE = /^[a-zA-Z0-9_-]{1,60}$/;

function esComandoSoloLectura(linea: string): boolean {
  return classifyCommand(linea) === "readonly";
}

export type ListaBlancaComandos =
  | { ok: true; comandos: string[] }
  | { ok: false; error: string };

export function parsearComandosSoloLectura(
  command: string,
): ListaBlancaComandos {
  const lineas = String(command ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0);

  if (lineas.length === 0) {
    return {
      ok: false,
      error:
        "No se envió ningún comando: envía al menos una línea de solo lectura (show, display, ping, ipconfig, ...).",
    };
  }

  const rechazadas = lineas.filter((linea) => !esComandoSoloLectura(linea));
  if (rechazadas.length > 0) {
    return {
      ok: false,
      error: `Comando(s) no permitido(s) en runDeviceCommand: ${rechazadas.join(" ; ")}. Esta tool solo ejecuta comandos de solo lectura (${READONLY_PREFIXES.filter((p) => !p.startsWith("?") && !p.endsWith(" -v")).join(", ")}); para cambiar la configuración usa configureIosDevice.`,
    };
  }

  return { ok: true, comandos: lineas };
}

function direccionamientoDe(dispositivo: any): {
  ips: string[];
  mascara?: string;
  gateway?: string;
} {
  const esIp = (valor: unknown): valor is string =>
    typeof valor === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(valor.trim());

  const ips: string[] = [];
  let mascara: string | undefined;
  let gateway: string | undefined;

  const agregarIp = (valor: unknown) => {
    if (!esIp(valor)) return;
    const ip = valor.trim();
    if (!ips.includes(ip)) ips.push(ip);
  };
  const agregarMascara = (valor: unknown) => {
    if (!mascara && esIp(valor)) mascara = valor.trim();
  };
  const agregarGateway = (valor: unknown) => {
    if (!gateway && esIp(valor)) gateway = valor.trim();
  };

  const fuentes: any[] = [dispositivo];
  if (dispositivo?.ipConfiguration) fuentes.push(dispositivo.ipConfiguration);
  if (dispositivo?.ipConfig) fuentes.push(dispositivo.ipConfig);
  if (Array.isArray(dispositivo?.ips)) dispositivo.ips.forEach(agregarIp);
  if (Array.isArray(dispositivo?.interfaces)) {
    fuentes.push(...dispositivo.interfaces);
  }

  for (const fuente of fuentes) {
    agregarIp(fuente?.ip);
    agregarIp(fuente?.ipAddress);
    agregarIp(fuente?.ipaddress);
    agregarIp(fuente?.address);
    agregarMascara(fuente?.subnetMask ?? fuente?.mask ?? fuente?.netmask);
    agregarGateway(fuente?.defaultGateway ?? fuente?.gateway);
  }

  return { ips, mascara, gateway };
}

export const TIPOS_CON_CONSOLA_IOS = [0, 1, 16] as const;

export const TIPOS_CATALOGO_EXTENSION = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 21, 22, 23,
  24, 25, 27, 29, 30, 31, 32, 34, 35, 36, 37, 39, 40, 41, 44, 45, 46, 47, 48, 49,
  50,
] as const;

export const CATALOGO_MODELOS_EXTENSION: Record<string, number> = {
  "802": 34,
  "803": 34,
  "829": 0,
  "1841": 0,
  "1941": 0,
  "2811": 0,
  "2901": 0,
  "2911": 0,
  "5505": 27,
  "7960": 12,
  "2620XM": 0,
  "2621XM": 0,
  "819HG-4G-IOX": 0,
  "819HGW": 0,
  "CGR1240": 0,
  "ISR4321": 0,
  "ISR4331": 0,
  "Router-PT": 0,
  "Router-PT-Empty": 0,
  "2950-24": 1,
  "2950T-24": 1,
  "2960-24TT": 1,
  "Switch-PT": 1,
  "Switch-PT-Empty": 1,
  "Cloud-PT": 2,
  "Cloud-PT-Empty": 2,
  "Bridge-PT": 3,
  "Hub-PT": 4,
  "Repeater-PT": 5,
  "CoAxialSplitter-PT": 6,
  "AccessPoint-PT": 7,
  "AccessPoint-PT-A": 7,
  "AccessPoint-PT-AC": 7,
  "AccessPoint-PT-N": 7,
  "PC-PT": 8,
  "Server-PT": 9,
  "Printer-PT": 10,
  "Linksys-WRT300N": 11,
  "DSL-Modem-PT": 13,
  "Cable-Modem-PT": 14,
  "3560-24PS": 16,
  "3650-24PS": 16,
  "IE-2000": 16,
  "Laptop-PT": 18,
  "TabletPC-PT": 19,
  "SMARTPHONE-PT": 20,
  "WirelessEndDevice-PT": 21,
  "WiredEndDevice-PT": 22,
  "TV-PT": 23,
  "Home-VoIP-PT": 24,
  "Analog-Phone-PT": 25,
  "5506-X": 27,
  "DLC100": 29,
  "HomeRouter-PT-AC": 30,
  "Cell-Tower": 31,
  "Central-Office-Server": 32,
  "Sniffer": 35,
  "MCU-PT": 36,
  "SBC-PT": 37,
  "Air Conditioner": 39,
  "Air Cooler": 39,
  "Alarm": 39,
  "Appliance": 39,
  "Atm Pressure Monitor": 39,
  "Battery": 39,
  "Beacon": 39,
  "Blower": 39,
  "Bluetooth Speaker": 39,
  "Carbon Dioxide Detector": 39,
  "Carbon Monoxide Detector": 39,
  "Fan": 39,
  "Ceiling Sprinkler": 39,
  "Dimmable LED": 39,
  "Door": 39,
  "Fire Monitor": 39,
  "Fire Sprinkler": 39,
  "Flex Sensor": 39,
  "Floor Sprinkler": 39,
  "Furnace": 39,
  "Garage Door": 39,
  "Generic Environment Sensor": 39,
  "Generic Sensor": 39,
  "Heating Element": 39,
  "Home Speaker": 39,
  "Humidifier": 39,
  "Humidity Monitor": 39,
  "Humidity Sensor": 39,
  "Humiture Monitor": 39,
  "Humiture Sensor": 39,
  LCD: 39,
  LED: 39,
  "Lawn Sprinkler": 39,
  "Light": 39,
  "Membrane Potentiometer": 39,
  "Metal Sensor": 39,
  "Motion Detector": 39,
  "Motion Sensor": 39,
  "Motor": 39,
  "Old Car": 39,
  "Photo Sensor": 39,
  "Piezo Speaker": 39,
  "Portable Music Player": 39,
  Potentiometer: 39,
  "Power Meter": 39,
  "Push Button": 39,
  "Push Button Toggle Switch": 39,
  "RFID Card": 39,
  "RFID Reader": 39,
  "RGB LED": 39,
  "Rocker Switch": 39,
  "Servo": 39,
  "Signal Generator": 39,
  Siren: 39,
  "Smart LED": 39,
  "Smoke Detector": 39,
  "Smoke Sensor": 39,
  "Solar Panel": 39,
  "Sound Frequency Detector": 39,
  "Sound Sensor": 39,
  Speaker: 39,
  "Street Lamp": 39,
  "Temperature Monitor": 39,
  "Temperature Sensor": 39,
  Thermostat: 39,
  Thing: 39,
  "Toggle Push Button": 39,
  "Trip Sensor": 39,
  "Trip Wire": 39,
  "Water Detector": 39,
  "Water Drain": 39,
  "Water Level Monitor": 39,
  "Water Sensor": 39,
  Webcam: 39,
  "Wind Detector": 39,
  "Wind Sensor": 39,
  "Wind Turbine": 39,
  Window: 39,
  "Embedded-Server-PT": 40,
  "WLC-2504": 41,
  "WLC-3504": 41,
  "WLC-PT": 41,
  "3702i": 44,
  "LAP-PT": 44,
  "Power Distribution Device": 45,
  "Copper Patch Panel": 46,
  "Fiber Patch Panel": 46,
  "Copper Wall Mount": 47,
  "Fiber Wall Mount": 47,
  "Meraki-MX65W": 48,
  "Meraki-Server": 49,
  NetworkController: 50,
};

const TIPOS_IOS = new Set<number>([...TIPOS_CON_CONSOLA_IOS]);
const TIPOS_CATALOGO = new Set<number>([...TIPOS_CATALOGO_EXTENSION]);

export type ClaseEquipo = "ios" | "host" | "desconocido";

export interface ClasificacionEquipo {

  clase: ClaseEquipo;

  consolaIos: boolean;

  criterio: "tipo" | "modelo" | "nombre" | "ninguno";

  motivo: string;
}

function normalizarTipo(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return Math.trunc(valor);
  if (typeof valor === "string" && /^-?\d+$/.test(valor.trim())) {
    return Number(valor.trim());
  }
  return null;
}

export function clasificarEquipo(equipo: unknown): ClasificacionEquipo {
  const ficha = (equipo ?? {}) as Record<string, unknown>;

  const tipo = normalizarTipo(ficha.type);
  if (tipo !== null) {
    if (TIPOS_IOS.has(tipo)) {
      return {
        clase: "ios",
        consolaIos: true,
        criterio: "tipo",
        motivo: `el tipo ${tipo} del equipo está en {${TIPOS_CON_CONSOLA_IOS.join(", ")}} (criterio de __defaultMode de la extensión), así que tiene consola IOS`,
      };
    }
    if (TIPOS_CATALOGO.has(tipo)) {
      return {
        clase: "host",
        consolaIos: false,
        criterio: "tipo",
        motivo: `el tipo ${tipo} del equipo está catalogado en la extensión pero no está en {${TIPOS_CON_CONSOLA_IOS.join(", ")}}, así que no tiene consola IOS`,
      };
    }
    return {
      clase: "desconocido",
      consolaIos: false,
      criterio: "tipo",
      motivo: `el tipo ${tipo} no figura en allDeviceTypes de la extensión, así que no se puede afirmar si el equipo tiene consola IOS`,
    };
  }

  const modelo = textoONull(ficha.model);
  if (modelo) {
    const tipoDelModelo = CATALOGO_MODELOS_EXTENSION[modelo];
    if (tipoDelModelo !== undefined) {
      const ios = TIPOS_IOS.has(tipoDelModelo);
      return {
        clase: ios ? "ios" : "host",
        consolaIos: ios,
        criterio: "modelo",
        motivo: `el modelo '${modelo}' es de tipo ${tipoDelModelo} en la extensión${ios ? ", que sí tiene consola IOS" : ", que no tiene consola IOS"}`,
      };
    }
  }

  const nombre = textoONull(ficha.name);
  if (nombre) {
    if (/^(router|switch|sw)\d+$/i.test(nombre)) {
      return {
        clase: "ios",
        consolaIos: true,
        criterio: "nombre",
        motivo: `el nombre '${nombre}' solo se usa para routers y switches de Packet Tracer`,
      };
    }
    if (/^(pc|laptop|server|printer|tabletpc|tablet|smartphone)\d*$/i.test(nombre)) {
      return {
        clase: "host",
        consolaIos: false,
        criterio: "nombre",
        motivo: `el nombre '${nombre}' solo se usa para equipos finales de Packet Tracer`,
      };
    }
  }

  return {
    clase: "desconocido",
    consolaIos: false,
    criterio: "ninguno",
    motivo:
      `la ficha del equipo no trae 'type'${modelo ? ` y su modelo ('${modelo}') no está en el catálogo` : ""}` +
      `${nombre ? ` y su nombre ('${nombre}') no es inequívoco` : ""}, así que no se puede determinar si tiene consola IOS`,
  };
}

function esHost(dispositivo: unknown): boolean {
  return clasificarEquipo(dispositivo).clase === "host";
}

function revisarDireccionamiento(red: any): string[] {
  const dispositivos: any[] = Array.isArray(red?.devices) ? red.devices : [];
  const conDatos = dispositivos
    .map((dispositivo) => ({ dispositivo, dir: direccionamientoDe(dispositivo) }))
    .filter((entrada) => entrada.dir.ips.length > 0);

  if (conDatos.length === 0) {
    return [
      "El snapshot de getNetwork no incluye direcciones IP: se omitieron las comprobaciones de direccionamiento.",
    ];
  }

  const incidencias: string[] = [];

  const duenos = new Map<string, string[]>();
  for (const { dispositivo, dir } of conDatos) {
    for (const ip of dir.ips) {
      if (ip === "0.0.0.0") continue;
      const lista = duenos.get(ip) ?? [];
      lista.push(String(dispositivo?.name ?? "?"));
      duenos.set(ip, lista);
    }
  }
  for (const [ip, propietarios] of duenos) {
    if (propietarios.length > 1) {
      incidencias.push(
        `IP duplicada ${ip} en: ${propietarios.join(", ")}.`,
      );
    }
  }

  for (const { dispositivo, dir } of conDatos) {
    if (esHost(dispositivo) && !dir.gateway) {
      incidencias.push(
        `'${dispositivo.name}' tiene IP (${dir.ips.join(", ")}) pero sin gateway por defecto.`,
      );
    }
  }

  const enlaces: any[] = Array.isArray(red?.connections)
    ? red.connections
    : [];

  const hostPorNombre = new Set<string>();
  for (const dispositivo of dispositivos) {
    if (esHost(dispositivo)) hostPorNombre.add(String(dispositivo?.name ?? ""));
  }
  const esHostNombre = (nombre: unknown): boolean => {
    const clave = String(nombre ?? "");
    return (
      hostPorNombre.has(clave) ||
      /^(pc|laptop|server|printer)/i.test(clave)
    );
  };

  const porCapa = new Map<string, { dispositivo: any; mascara?: string }[]>();
  for (const { dispositivo, dir } of conDatos) {
    if (!esHost(dispositivo) || !dir.mascara) continue;
    const capa = enlaces
      .filter(
        (enlace) =>
          (enlace?.from === dispositivo.name && !esHostNombre(enlace?.to)) ||
          (enlace?.to === dispositivo.name && !esHostNombre(enlace?.from)),
      )
      .map((enlace) =>
        enlace?.from === dispositivo.name ? enlace?.to : enlace?.from,
      )
      .sort()
      .join("+");
    if (!capa) continue;
    const grupo = porCapa.get(capa) ?? [];
    grupo.push({ dispositivo, mascara: dir.mascara });
    porCapa.set(capa, grupo);
  }
  for (const [capa, miembros] of porCapa) {
    if (miembros.length < 2) continue;
    const mascaras = new Set(
      miembros.map((miembro) => String(miembro.mascara)),
    );
    if (mascaras.size > 1) {
      incidencias.push(
        `Máscaras distintas en la capa '${capa}': ${miembros
          .map((miembro) => `${miembro.dispositivo.name}=${miembro.mascara}`)
          .join(", ")}.`,
      );
    }
  }

  return incidencias;
}

function extraerConfiguracion(payload: any): string | null {
  const candidatos = [
    payload?.result?.runningConfig,
    payload?.runningConfig,
    payload?.result?.config,
    payload?.config,
    payload?.result?.startupConfig,
    payload?.startupConfig,
  ];

  const esBasura = (texto: string): boolean =>
    /initial configuration dialog/i.test(texto) ||
    /^\s*\^\s*$/m.test(texto);
  for (const candidato of candidatos) {
    if (
      typeof candidato === "string" &&
      candidato.length > 0 &&
      !esBasura(candidato)
    ) {
      return candidato;
    }
  }
  return null;
}

function construirInformeMarkdown(red: any): string {
  const dispositivos: any[] = Array.isArray(red?.devices) ? red.devices : [];
  const enlaces: any[] = Array.isArray(red?.connections) ? red.connections : [];

  const ids = new Map<string, string>();
  const usados = new Set<string>();
  const idDe = (nombre: unknown): string => {
    const clave = String(nombre ?? "");
    const existente = ids.get(clave);
    if (existente) return existente;
    let base = clave.replace(/[^A-Za-z0-9_]/g, "_") || "nodo";
    if (/^\d/.test(base)) base = `n_${base}`;
    let id = base;
    let sufijo = 1;
    while (usados.has(id)) id = `${base}_${sufijo++}`;
    usados.add(id);
    ids.set(clave, id);
    return id;
  };
  const celda = (valor: unknown): string =>
    String(valor ?? "—")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  const etiqueta = (valor: unknown): string =>
    String(valor ?? "").replace(/["|\r\n]/g, " ");

  const lineas: string[] = [
    "# Informe de red",
    "",
    `Generado: ${new Date().toISOString()}`,
    "",
    `> ${dispositivos.length} dispositivo(s) y ${enlaces.length} enlace(s).`,
    "",
    "## Diagrama",
    "",
    "```mermaid",
    "graph LR",
  ];

  for (const dispositivo of dispositivos) {
    lineas.push(
      `  ${idDe(dispositivo?.name)}["${etiqueta(dispositivo?.name)}<br/>${etiqueta(dispositivo?.model ?? "sin modelo")}"]`,
    );
  }
  for (const enlace of enlaces) {
    lineas.push(
      `  ${idDe(enlace?.from)} ---|${etiqueta(enlace?.type ?? "enlace")}| ${idDe(enlace?.to)}`,
    );
  }

  lineas.push(
    "```",
    "",
    "## Dispositivos",
    "",
    "| Nombre | Modelo | IPs | Puertos |",
    "| --- | --- | --- | --- |",
  );
  for (const dispositivo of dispositivos) {
    const ips = direccionamientoDe(dispositivo).ips.join(", ");
    const puertos = (Array.isArray(dispositivo?.interfaces)
      ? dispositivo.interfaces
      : []
    )
      .map((interfaz: any) =>
        interfaz?.in_use
          ? `${interfaz?.name} (en uso)`
          : String(interfaz?.name ?? ""),
      )
      .filter(Boolean)
      .join(", ");
    lineas.push(
      `| ${celda(dispositivo?.name)} | ${celda(dispositivo?.model)} | ${celda(ips)} | ${celda(puertos)} |`,
    );
  }

  lineas.push(
    "",
    "## Enlaces",
    "",
    "| Origen | Puerto origen | Destino | Puerto destino | Tipo |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const enlace of enlaces) {
    lineas.push(
      `| ${celda(enlace?.from)} | ${celda(enlace?.fromInterface)} | ${celda(enlace?.to)} | ${celda(enlace?.toInterface)} | ${celda(enlace?.type)} |`,
    );
  }
  lineas.push("");

  return lineas.join("\n");
}

function calcularSubnet(
  cidr: string,
  subnetCount?: number,
): { ok: true; datos: Record<string, unknown> } | { ok: false; error: string } {
  const coincidencia = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(
    String(cidr ?? "").trim(),
  );
  if (!coincidencia) {
    return {
      ok: false,
      error: `CIDR inválido: '${cidr}'. Formato esperado A.B.C.D/nn (ej. 192.168.1.0/24).`,
    };
  }

  const base = ipAEntero(
    `${coincidencia[1]}.${coincidencia[2]}.${coincidencia[3]}.${coincidencia[4]}`,
  );
  const prefijo = Number(coincidencia[5]);
  if (base === null) {
    return {
      ok: false,
      error: `Dirección IP inválida en '${cidr}': cada octeto debe estar entre 0 y 255.`,
    };
  }
  if (prefijo > 32) {
    return {
      ok: false,
      error: `Prefijo inválido en '${cidr}': debe estar entre 0 y 32.`,
    };
  }

  const mascara = prefijo === 0 ? 0 : (0xffffffff << (32 - prefijo)) >>> 0;
  const red = (base & mascara) >>> 0;
  const broadcast = (red | (~mascara >>> 0)) >>> 0;
  const totalHosts = Math.pow(2, 32 - prefijo);
  const usable = prefijo <= 30;

  const detalle = (
    redActual: number,
    prefijoActual: number,
    broadcastActual: number,
  ) => {
    const usableActual = prefijoActual <= 30;
    const primerHost = usableActual ? redActual + 1 : redActual;
    return {
      cidr: `${enteroAIp(redActual)}/${prefijoActual}`,
      network: enteroAIp(redActual),
      firstHost: enteroAIp(primerHost),
      lastHost: enteroAIp(
        usableActual ? broadcastActual - 1 : broadcastActual,
      ),
      broadcast: enteroAIp(broadcastActual),
      gateway: enteroAIp(primerHost),
    };
  };

  if (subnetCount === undefined || subnetCount === null) {
    return {
      ok: true,
      datos: {
        cidr: `${enteroAIp(red)}/${prefijo}`,
        network: enteroAIp(red),
        netmask: enteroAIp(mascara),
        prefix: prefijo,
        broadcast: enteroAIp(broadcast),
        firstHost: enteroAIp(usable ? red + 1 : red),
        lastHost: enteroAIp(usable ? broadcast - 1 : broadcast),
        hosts: usable ? totalHosts - 2 : totalHosts,
      },
    };
  }

  if (!Number.isInteger(subnetCount) || subnetCount < 1) {
    return {
      ok: false,
      error: `subnetCount debe ser un entero positivo (recibido: ${subnetCount}).`,
    };
  }
  if ((subnetCount & (subnetCount - 1)) !== 0) {
    return {
      ok: false,
      error: `subnetCount debe ser una potencia de 2 (recibido: ${subnetCount}).`,
    };
  }

  const prefijoNuevo = prefijo + Math.log2(subnetCount);
  if (prefijoNuevo > 30) {
    return {
      ok: false,
      error: `Con ${subnetCount} subredes el prefijo /${prefijoNuevo} no admite hosts útiles; reduce el número de subredes.`,
    };
  }

  const tamano = Math.pow(2, 32 - prefijoNuevo);
  const subredes: Record<string, string>[] = [];
  for (let i = 0; i < subnetCount; i++) {
    const redSub = (red + i * tamano) >>> 0;
    const broadcastSub = (redSub + tamano - 1) >>> 0;
    subredes.push(detalle(redSub, prefijoNuevo, broadcastSub));
  }

  return {
    ok: true,
    datos: {
      parentCidr: `${enteroAIp(red)}/${prefijo}`,
      subnetCount,
      prefix: prefijoNuevo,
      subnets: subredes,
    },
  };
}

function ipAEntero(ip: string): number | null {
  const partes = ip.split(".");
  if (partes.length !== 4) return null;
  let total = 0;
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const numero = Number(parte);
    if (numero > 255) return null;
    total = total * 256 + numero;
  }
  return total;
}

function enteroAIp(entero: number): string {
  return [24, 16, 8, 0]
    .map((desplazamiento) => (entero >>> desplazamiento) & 255)
    .join(".");
}

export function budgetDeRunDeviceCommand(numComandos: number): number {
  return numComandos > 3 ? 110_000 : 55_000;
}

export function payloadDeRunDeviceCommand(
  ciclo: ResultadoCiclo,
): Record<string, unknown> {
  const haySalida = ciclo.results.length > 0;

  const salidaReal = haySalida && ciclo.fuente !== "buffer";
  const exito = haySalida || (!ciclo.timedOut && !ciclo.fallo);

  const payload: Record<string, unknown> = {

    ...ciclo.diagnostico,
    success: exito,
    deviceName: ciclo.deviceName,
    deviceType: ciclo.deviceType,
    results: ciclo.results,
    summary: ciclo.resumen,

    fuente: ciclo.fuente,
    pendienteMs: ciclo.pendienteMs,
    intentos: ciclo.intentos,
    timedOut: ciclo.timedOut,

    reintentado: ciclo.reintentado,
    comandoConsumido: ciclo.comandoConsumido === true,
  };

  if (!exito) payload.error = ciclo.fallo ?? "Packet Tracer no devolvió salida.";
  if (ciclo.bloqueoAgotado) {
    payload.aviso =
      `La consola de '${ciclo.deviceName}' tiene un prompt pendiente que Packet ` +
      `Tracer no deja pagar (la extensión agotó sus acciones) y el comando NO se ` +
      `ejecutó ni se ha repetido: revisa la consola con readDeviceConsole y ` +
      `responde al prompt antes de volver a lanzar el comando.`;
  } else if (ciclo.comandoConsumido && (!ciclo.reintentado || !salidaReal)) {

    payload.aviso = ciclo.reintentado
      ? `El comando se consumió como respuesta a un prompt pendiente` +
        `${ciclo.bloqueoResuelto ? ` (${ciclo.bloqueoResuelto})` : ""} y el reintento ` +
        `volvió a caer en el mismo prompt: no se insiste más. El comando NO llegó a ` +
        `ejecutarse; lee la consola de '${ciclo.deviceName}' con readDeviceConsole, ` +
        `paga el prompt si hace falta y vuelve a lanzar los comandos.`
      : `El comando se consumió como respuesta a un prompt pendiente` +
        `${ciclo.bloqueoResuelto ? ` (${ciclo.bloqueoResuelto})` : ""} y NO se ha ` +
        `repetido desde runDeviceCommand: no llegó a ejecutarse. Lee la consola de ` +
        `'${ciclo.deviceName}' con readDeviceConsole, paga el prompt si hace falta y ` +
        `vuelve a lanzar los comandos.`;
  } else if (ciclo.timedOut) {
    payload.aviso =
      `El comando no terminó dentro del presupuesto (${ciclo.intentos} ` +
      `sondeo(s), ${Math.round(ciclo.pendienteMs / 100) / 10}s pendientes). ` +
      `En Packet Tracer puede seguir ejecutándose y la consola puede quedar ` +
      `ocupada: NO repitas el comando; espera unos segundos y vuelve a leer la ` +
      `consola del equipo.`;
  }
  if (ciclo.motivoReintento) payload.motivoReintento = ciclo.motivoReintento;
  if (ciclo.bloqueoResuelto) payload.bloqueoResuelto = ciclo.bloqueoResuelto;
  if (ciclo.bloqueoAgotado) payload.bloqueoAgotado = true;
  return payload;
}

const runDeviceCommandTool = tool(
  async ({ deviceName, command }) => {
    const validacion = parsearComandosSoloLectura(command);
    if (!validacion.ok) {
      return JSON.stringify({ success: false, error: validacion.error });
    }

    const ciclo = await ejecutarYEsperar(deviceName, validacion.comandos, {
      budgetMs: budgetDeRunDeviceCommand(validacion.comandos.length),

      fallbackTimeoutMs:
        validacion.comandos.length > 3 ? 120_000 : undefined,

      reintentable: true,

      nombreTool: "runDeviceCommand",
    });

    await createLog({
      level: "INFO",
      title: "Comandos de Solo Lectura",
      content:
        `'${deviceName}' ejecutó ${validacion.comandos.length} comando(s) de solo lectura [ ${validacion.comandos.join(" ; ")} ] ` +
        `| salida: ${ciclo.fuente}${ciclo.timedOut ? " (presupuesto agotado)" : ""}, ` +
        `${ciclo.intentos} sondeo(s), ${Math.round(ciclo.pendienteMs / 100) / 10}s.`,
    });

    return JSON.stringify(payloadDeRunDeviceCommand(ciclo));
  },
  {
    name: "runDeviceCommand",
    description:
      "Run read-only commands on a device (router, switch, PC or server) and return their output; one command per line. Allowed: show, ping, tracert, traceroute, arp, dir, date, whoami, help, ipconfig, nslookup, netstat. Use configureIosDevice for anything that changes the configuration.",
    schema: z.object({
      deviceName: z
        .string()
        .describe("Device that runs the commands, e.g. Router0 or PC1"),
      command: z
        .string()
        .describe("Read-only commands, one per line"),
    }),
  },
);

const validateTopologyTool = tool(
  async () => {
    const result = await ciscoClient.callTool("validateTopology", {});

    await createLog({
      level: "INFO",
      title: "Validación de Topología",
      content:
        "Batería de validación estructural ejecutada (enlaces, duplicados y dispositivos huérfanos).",
    });

    return JSON.stringify(result);
  },
  {
    name: "validateTopology",
    description:
      "Check the current topology for structural problems (duplicate links, overlapping ports, orphan devices) and return errors and warnings; run it first when diagnosing a design.",
    schema: z.object({}),
  },
);

const listDeviceModelsTool = tool(
  async () => {
    const result = await ciscoClient.callTool("listDeviceModels", {});

    await createLog({
      level: "INFO",
      title: "Catálogo de Modelos",
      content: "Listado de modelos de dispositivo disponibles en Packet Tracer.",
    });

    return JSON.stringify(result);
  },
  {
    name: "listDeviceModels",
    description:
      "List every device model THIS Packet Tracer engine can place (routers, switches, PCs, servers, IoT, ...) with its type. This is the real catalogue that addDevice validates against: call it whenever you need a model id you do not know, and use its ids verbatim (they are case sensitive). There is no fixed short list of models anywhere: any id returned here is accepted by addDevice.",
    schema: z.object({}),
  },
);

const listDeviceModulesTool = tool(
  async ({ deviceName }) => {
    const result = await ciscoClient.callTool("listDeviceModules", {
      deviceName,
    });

    await createLog({
      level: "MODULE",
      title: "Módulos Consultados",
      content: `Inventario de módulos instalados en '${deviceName}'.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "listDeviceModules",
    description:
      "List the hardware modules installed in a device (slots and models) to know which interfaces are available before wiring or adding a module.",
    schema: z.object({
      deviceName: z.string().describe("Name of an existing device"),
    }),
  },
);

const subnetCalcTool = tool(
  async ({ cidr, subnetCount }) => {
    const calculo = calcularSubnet(cidr, subnetCount);
    if (!calculo.ok) {
      return JSON.stringify({ success: false, error: calculo.error });
    }

    return JSON.stringify({ success: true, ...calculo.datos });
  },
  {
    name: "subnetCalc",
    description:
      "Calculate IPv4 subnet details locally (network, mask, broadcast, first/last host, host count) from a CIDR such as 192.168.1.0/24; optionally split the range into consecutive subnets.",
    schema: z.object({
      cidr: z
        .string()
        .describe("IPv4 CIDR to calculate, e.g. 192.168.1.0/24"),
      subnetCount: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Split into this many consecutive subnets (power of two)"),
    }),
  },
);

const getDeviceConfigTool = tool(
  async ({ deviceName }) => {
    const result = await ciscoClient.callTool("getDeviceConfigSnapshot", {
      deviceName,
    });

    await createLog({
      level: "INFO",
      title: "Configuración Consultada",
      content: `Snapshot de configuración de '${deviceName}' leído desde Packet Tracer (sin cambios).`,
    });

    return JSON.stringify(result);
  },
  {
    name: "getDeviceConfig",
    description:
      "Read the configuration snapshot (running/startup config) of a device without changing it; use it to review the current CLI state before proposing changes.",
    schema: z.object({
      deviceName: z.string().describe("Device name to inspect"),
    }),
  },
);

const generateNetworkReportTool = tool(
  async () => {
    const resultado = await ciscoClient.callTool("getNetwork", {});
    const red = payloadDe(resultado);

    const fallo = motivoDeFalloDeLectura(red, "getNetwork");
    const dispositivos = fallo ? [] : comoArray(red?.devices);
    const vacio = dispositivos.length === 0;

    await registrarOperacion("INFO", {
      resultado:
        fallo || vacio
          ? { success: false, error: fallo ?? "sin dispositivos" }
          : resultado,
      tituloOk: "Informe de Red",
      tituloFallo: "Informe de Red No Generado",
      exito:
        `Informe Markdown generado con diagrama Mermaid y tablas de dispositivos ` +
        `y enlaces (${dispositivos.length} dispositivo(s)).`,
      intento: "Se intentó generar el informe Markdown de la red a partir de getNetwork",
    });

    if (fallo || vacio) {
      return JSON.stringify({
        success: false,
        error:
          `No se generó el informe de red: ${fallo ?? "getNetwork no devolvió ningún dispositivo"}. ` +
          `Un informe con "0 dispositivo(s)" y sin tablas sería un documento falso sobre una ` +
          `red que no se ha podido leer: comprueba que Packet Tracer está abierto con el ` +
          `workspace cargado y vuelve a intentarlo.`,
      });
    }

    return construirInformeMarkdown(red);
  },
  {
    name: "generateNetworkReport",
    description:
      "Build a Markdown report of the whole topology: a Mermaid diagram plus device (name, model, IPs, ports) and link tables. Use it to deliver the final documentation of a design. It fails with success:false (and NO Markdown) when the snapshot cannot be read or comes back empty, because an empty report would be a document about a network nobody read.",
    schema: z.object({}),
  },
);

const readDeviceConsoleTool = tool(
  async ({ deviceName, lines }) => {
    const result = await ciscoClient.callTool("readDeviceConsole", {
      deviceName,
      lines,
    });

    await createLog({
      level: "INFO",
      title: "Consola del Dispositivo",
      content: `Últimas ${lines} línea(s) de la consola de '${deviceName}' leídas sin ejecutar ningún comando.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "readDeviceConsole",
    description:
      "Read the raw console tail of a device (its last lines, straight from the console buffer) without running any command; use it to see what the CLI is showing right now, for example after a command failed or when the console looks stuck.",
    schema: z.object({
      deviceName: z
        .string()
        .describe("Device whose console output is read"),
      lines: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .default(40)
        .describe("How many trailing lines to return (default 40, max 5000)"),
    }),
  },
);

const getRoutingTableTool = tool(
  async ({ deviceName }) => {
    const result = await ciscoClient.callTool("getRoutingTable", {
      deviceName,
    });

    await createLog({
      level: "INFO",
      title: "Tabla de Rutas",
      content: `Tabla de enrutamiento ('show ip route') leída en '${deviceName}' sin cambios.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "getRoutingTable",
    description:
      "Read the IPv4 routing table of a router or switch ('show ip route' in enable mode) in a single call; use it to see how traffic is forwarded when a ping fails or before you change the routing.",
    schema: z.object({
      deviceName: z
        .string()
        .describe("Router or switch whose routing table is read"),
    }),
  },
);

const getVlanConfigurationTool = tool(
  async ({ switchName }) => {
    const result = await ciscoClient.callTool("getVlanConfiguration", {
      switchName,
    });

    await createLog({
      level: "INFO",
      title: "Configuración de VLANs",
      content: `Base de VLANs ('show vlan brief') leída en el switch '${switchName}' sin cambios.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "getVlanConfiguration",
    description:
      "Read the VLAN database of a switch ('show vlan brief') and return the parsed VLAN lines plus the raw output; use it to verify VLAN membership and access/trunk ports. Fails when the device is not a switch.",
    schema: z.object({
      switchName: z
        .string()
        .describe("Switch device name (the device must be a switch)"),
    }),
  },
);

const getDeviceMetricsTool = tool(
  async ({ deviceName }) => {
    const result = await ciscoClient.callTool("getDeviceMetrics", {
      deviceName,
    });

    await createLog({
      level: "INFO",
      title: "Métricas del Dispositivo",
      content: `Métricas de '${deviceName}' (modelo, estado, interfaces y uso de CPU/memoria) consultadas sin cambios.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "getDeviceMetrics",
    description:
      "Read the health metrics of one device in a single call: model, type, power state, status of every interface and the output of 'show processes cpu' and 'show memory statistics'; use it for capacity or health checks.",
    schema: z.object({
      deviceName: z.string().describe("Device whose metrics are read"),
    }),
  },
);

const validateSecurityConfigTool = tool(
  async ({ deviceName }) => {
    const result = await ciscoClient.callTool("validateSecurityConfig", {
      deviceName,
    });

    await createLog({
      level: "INFO",
      title: "Auditoría de Seguridad",
      content: `Configuración de seguridad de '${deviceName}' auditada (enable secret, SSH y Telnet) sin cambios.`,
    });

    return JSON.stringify(result);
  },
  {
    name: "validateSecurityConfig",
    description:
      "Audit the security baseline of a device from its running-config (enable secret set, SSH enabled, Telnet disabled on the vty lines) and return the checks plus warnings; use it for a quick hardening review before and after changes.",
    schema: z.object({
      deviceName: z.string().describe("Device whose configuration is audited"),
    }),
  },
);

export const PING_NO_SOPORTADO = "unsupported_device";

export const PING_INTERFAZ_NO_LISTA = "interfaz_no_lista";

export const PING_SIN_RESPUESTA = "no_reply";

export const PING_ESTADOS_DE_ERROR: Record<string, string> = {
  no_ip: "el destino no tiene ninguna IP configurada",
  source_not_found: "no existe el dispositivo de origen",
  target_not_found: "no existe el dispositivo de destino",
  command_failed: "el equipo no ejecutó el comando ping",
  console_blocked:
    "la consola del equipo quedó bloqueada (un 'no' suelto se interpretó como " +
    "hostname y IOS se paró en un lookup DNS) y el ping no llegó a ejecutarse",
  [PING_INTERFAZ_NO_LISTA]:
    "el enlace/interfaz del equipo todavía no estaba operativo (el PDU ni siquiera llegó a " +
    "salir del origen, así que no se puede afirmar nada del destino). NO es un problema de la " +
    "topología, del direccionamiento ni de las rutas: no cambies la configuración por esto, " +
    "espera unos segundos a que levante el enlace y repite el ping",
};

export function payloadDe(respuesta: any): any {
  const CLAVES_ENVOLTORIO = ["code", "result", "success", "error", "message"];
  let v = respuesta;
  for (;;) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    if (!("result" in v)) return v;
    const claves = Object.keys(v);
    const esEnvoltorio =
      claves.length > 0 && claves.every((clave) => CLAVES_ENVOLTORIO.includes(clave));
    if (!esEnvoltorio) return v;
    v = v.result;
  }
}

function comoArray(valor: any): any[] {
  if (Array.isArray(valor)) return valor;
  if (valor && typeof valor === "object" && typeof valor.length === "number") {
    const out: any[] = [];
    for (let i = 0; i < valor.length; i++) if (i in valor) out.push(valor[i]);
    return out;
  }
  return [];
}

export interface PingInterpretado {

  fallo?: string;

  datos?: any;
}

export function interpretarPing(respuesta: any): PingInterpretado {
  const bruto = payloadDe(respuesta);

  if (bruto === null || bruto === undefined) {
    return { fallo: "Packet Tracer no devolvió resultados del ping." };
  }
  if (typeof bruto !== "object") {
    return {
      fallo: `Respuesta inesperada de pingDevices: ${String(bruto).slice(0, 200)}`,
    };
  }
  if (bruto.success === false || bruto.error) {
    return {
      fallo: String(bruto.error ?? "pingDevices falló en Packet Tracer."),
    };
  }

  const estado = String(bruto.status ?? "");
  const motivo = PING_ESTADOS_DE_ERROR[estado];
  if (motivo) {
    const detalle = String(bruto.output ?? "").slice(0, 200).trim();
    return {
      fallo:
        `pingDevices [${estado}] '${bruto.source ?? "?"}' → ` +
        `'${bruto.target ?? "?"}': ${motivo}${detalle ? ` — ${detalle}` : ""}`,
    };
  }

  const datos = { ...bruto };
  if (datos.status === PING_NO_SOPORTADO) {
    datos.message =
      `Ping por CLI no soportado: '${datos.source ?? "origen"}' no puede ejecutar 'ping' ` +
      `hacia '${datos.target ?? "destino"}' porque el equipo no tiene consola IOS ` +
      `(estado ${PING_NO_SOPORTADO}). No es un error de la topología ni un fallo de conectividad.`;
  } else if (datos.status === PING_SIN_RESPUESTA) {

    datos.message =
      `Sin respuesta de '${datos.target ?? "destino"}': ${datos.sent ?? "?"} paquete(s) ` +
      `enviado(s), ${datos.received ?? 0} recibido(s), ${datos.lossPercent ?? "?"}% de pérdida` +
      `${datos.descartadoEn ? ` (el PDU se descartó en '${datos.descartadoEn}')` : ""}. ` +
`Es un veredicto NEGATIVO de conectividad: el PDU salió del origen y nadie ` +
      `contestó, así que revisa el estado del enlace, el direccionamiento y las rutas ` +
      `del destino. El ping se ejecutó y su resultado medido es que a ese destino no ` +
      `se llega (${PING_SIN_RESPUESTA}): es un veredicto negativo, no un fallo de la medición.`;
  }
  return { datos };
}

export interface MatrizInterpretada {
  fallo?: string;
  datos?: any;
}

export const MAX_DESTINOS_POR_MATRIZ = 10;

export function interpretarMatrizAlcance(
  respuesta: any,
  destinos: string[],
): MatrizInterpretada {
  const bruto = payloadDe(respuesta);

  if (bruto === null || bruto === undefined || typeof bruto !== "object") {
    return {
      fallo: `Respuesta inesperada de reachabilityMatrix: ${String(bruto).slice(0, 200)}`,
    };
  }
  if (bruto.success === false || bruto.error) {
    return {
      fallo: String(bruto.error ?? "reachabilityMatrix falló en Packet Tracer."),
    };
  }

  const filas = comoArray(bruto.rows);
  if (filas.length === 0 && destinos.length > 0) {
    return {
      fallo: `reachabilityMatrix no devolvió filas para ${destinos.length} destino(s).`,
    };
  }

  const destinosPedidos = destinos.length;
  const destinosMedidos = Math.min(destinosPedidos, MAX_DESTINOS_POR_MATRIZ);
  const destinosOmitidos = destinos.slice(destinosMedidos);
  const truncado = destinosOmitidos.length > 0;
  const avisoTruncado = truncado
    ? `La extensión mide como máximo ${MAX_DESTINOS_POR_MATRIZ} destinos por llamada: ` +
      `NO se ha medido el alcance hacia ${destinosOmitidos.length} destino(s) ` +
      `(${destinosOmitidos.join(", ")}). Divide la lista en tandas de ${MAX_DESTINOS_POR_MATRIZ} ` +
      `o menos: estas filas solo dicen algo de los ${destinosMedidos} primeros.`
    : "";

  const filasConError = filas.filter((f: any) =>
    Boolean(PING_ESTADOS_DE_ERROR[String(f?.status ?? "")]),
  );

  const avisoSinInterfaz = (lasFilas: any[]): string =>
    ` El enlace de ${lasFilas.map((f: any) => `'${f?.target}'`).join(", ")} todavía no ` +
    `estaba operativo (estado ${PING_INTERFAZ_NO_LISTA}): el PDU ni salió del origen, así que ` +
    "esas filas NO miden alcance. No es un fallo de la topología ni de las rutas: NO cambies la " +
    "configuración por esto, espera unos segundos a que levante el enlace y repite la matriz.";
  if (filas.length > 0 && filasConError.length === filas.length) {
    const soloInterfaz = filasConError.filter((f: any) => f?.status === PING_INTERFAZ_NO_LISTA);
    return {
      fallo:
        "reachabilityMatrix: ningún destino pudo evaluarse (" +
        filasConError.map((f: any) => `${f?.target}: ${f?.status}`).join(", ") +
        ")." +
        (soloInterfaz.length > 0 ? avisoSinInterfaz(soloInterfaz) : "") +
        (avisoTruncado ? ` ${avisoTruncado}` : ""),
    };
  }

  const datos = { ...bruto, rows: filas };
  datos.truncado = truncado;
  datos.destinosPedidos = destinosPedidos;
  datos.destinosMedidos = destinosMedidos;

  if (truncado) datos.destinosOmitidos = destinosOmitidos;
  const sinCli = filas.filter((f: any) => f?.status === PING_NO_SOPORTADO);
  const sinInterfaz = filasConError.filter((f: any) => f?.status === PING_INTERFAZ_NO_LISTA);

  const otrasConError = filasConError.filter((f: any) => f?.status !== PING_INTERFAZ_NO_LISTA);
  const partes: string[] = [];

  if (avisoTruncado) partes.push(avisoTruncado);
  if (sinCli.length > 0) {
    partes.push(
      `${sinCli.length} de ${filas.length} destino(s) no tienen consola IOS ` +
        `(estado ${PING_NO_SOPORTADO}): ${sinCli.map((f: any) => f?.target).join(", ")}. ` +
        "No es un fallo; el resto de la matriz es válida.",
    );
  }
  if (sinInterfaz.length > 0) {
    partes.push(
      `${sinInterfaz.length} de ${filas.length} destino(s) no se pudieron medir.${avisoSinInterfaz(
        sinInterfaz,
      )}`,
    );
  }
  if (otrasConError.length > 0) {
    partes.push(
      `${otrasConError.length} de ${filas.length} destino(s) no pudieron evaluarse: ` +
        otrasConError
          .map((f: any) => `${f?.target} (${f?.status})`)
          .join(", ") +
        ".",
    );
  }
  if (partes.length > 0) datos.message = partes.join(" ");
  return { datos };
}

function motivoDeFalloDeLectura(bruto: any, herramienta: string): string | null {
  if (bruto === null || bruto === undefined) {
    return `${herramienta} no devolvió nada (¿está Packet Tracer abierto con el motor conectado?)`;
  }
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    return `${herramienta} devolvió una respuesta inesperada (${String(bruto).slice(0, 120)})`;
  }
  if (bruto.success === false) {
    return textoONull(bruto.error) ?? `${herramienta} devolvió success:false`;
  }
  if (bruto.error) return textoONull(bruto.error) ?? `${herramienta} devolvió un error`;
  return null;
}

export interface ValidacionTopologiaInterpretada {

  ejecutada: boolean;

  motivo: string;

  hallazgos: string[];
}

export function interpretarValidacionTopologia(
  validacion: any,
): ValidacionTopologiaInterpretada {
  const bruto = payloadDe(validacion);

  if (!bruto || typeof bruto !== "object") {
    return {
      ejecutada: false,
      motivo: `validateTopology no devolvió nada utilizable (${String(bruto).slice(0, 120)})`,
      hallazgos: [],
    };
  }

  if (Array.isArray(bruto)) {
    const hallazgos = bruto.map((item) =>
      typeof item === "string" ? item : JSON.stringify(item),
    );
    return {
      ejecutada: true,
      motivo: `validateTopology devolvió ${hallazgos.length} hallazgo(s).`,
      hallazgos,
    };
  }

  if (bruto.success === false || bruto.error) {
    return {
      ejecutada: false,
      motivo: `validateTopology falló en Packet Tracer (${textoONull(bruto.error) ?? "sin motivo informado"})`,
      hallazgos: [],
    };
  }

  const texto = (valor: unknown): string =>
    typeof valor === "string" ? valor : JSON.stringify(valor);
  const listas = Object.entries(bruto).filter(([, valor]) => Array.isArray(valor));
  if (listas.length === 0) {
    return {
      ejecutada: false,
      motivo:
        "validateTopology respondió sin estructura de resultados (errors/warnings/" +
        "orphans): no hay nada que interpretar",
      hallazgos: [],
    };
  }

  const hallazgos: string[] = [];
  for (const [clave, valor] of listas) {
    for (const item of valor as unknown[]) hallazgos.push(`${clave}: ${texto(item)}`);
  }
  return {
    ejecutada: true,
    motivo: `validateTopology devolvió ${listas
      .map(([clave, valor]) => `${clave}: ${(valor as unknown[]).length}`)
      .join(", ")}.`,
    hallazgos,
  };
}

const qaTopologySuiteTool = tool(
  async ({ sourceName, targetName }) => {
    const validacion = interpretarValidacionTopologia(
      await ciscoClient.callTool("validateTopology", {}),
    );
    const red = payloadDe(await ciscoClient.callTool("getNetwork", {}));
    const falloRed = motivoDeFalloDeLectura(red, "getNetwork");
    const addressing = falloRed
      ? [
          `no se pudo comprobar el direccionamiento: ${falloRed}`,
        ]
      : revisarDireccionamiento(red);

    const fallos: string[] = [];
    if (!validacion.ejecutada) {
      fallos.push(`validación estructural NO ejecutada: ${validacion.motivo}`);
    }
    if (falloRed) fallos.push(`inventario NO leído: ${falloRed}`);

    const alcance =
      sourceName && targetName ? ` (alcance ${sourceName} → ${targetName})` : "";
    const respuesta: Record<string, unknown> = {
      success: fallos.length === 0,

      validacionEjecutada: validacion.ejecutada,
      validacionMotivo: validacion.motivo,
      topology: validacion.hallazgos,
      incidencias: validacion.hallazgos.length,
      direccionamientoComprobado: !falloRed,
      addressing,
      aviso: validacion.ejecutada
        ? validacion.hallazgos.length === 0
          ? "La validación estructural se EJECUTÓ y no encontró errores, avisos ni huérfanos: eso no dice nada sobre conectividad, que es lo que comprueba el ping opcional."
          : `La validación estructural se ejecutó y encontró ${validacion.hallazgos.length} incidencia(s) en 'topology'.`
        : `ATENCIÓN: 'topology' viene vacío porque la validación NO SE PUDO COMPROBAR, no porque la topología esté sin incidencias (${validacion.motivo}). No afirmes que la topología está bien.`,
    };
    if (fallos.length > 0) respuesta.error = fallos.join(" | ");

    if (sourceName && targetName) {
      const ping = await ciscoClient.callTool("pingDevices", {
        sourceName,
        targetName,
        options: {},
      });
      const interpretado = interpretarPing(ping);
      if (interpretado.fallo) {

        const falloDePing = `Ping ${sourceName} → ${targetName}: ${interpretado.fallo}`;
        respuesta.success = false;
        respuesta.error = respuesta.error
          ? `${respuesta.error} | ${falloDePing}`
          : falloDePing;
      } else {

        respuesta.connectivity = {
          sourceName,
          targetName,
          result: interpretado.datos,
        };
      }
    }

    await registrarOperacion("INFO", {
      resultado:
        respuesta.success
          ? { success: true }
          : { success: false, error: respuesta.error },
      tituloOk: "QA de Topología",
      tituloFallo: "QA de Topología No Completada",
      exito:
        `Batería QA ejecutada${alcance}: validación estructural ` +
        `${validacion.ejecutada ? `con ${validacion.hallazgos.length} incidencia(s)` : "NO ejecutada"}, ` +
        `direccionamiento ${falloRed ? "NO comprobado" : `${addressing.length} incidencia(s)`}.`,
      intento: `Se intentó ejecutar la batería QA${alcance}`,
      detalle: validacion.hallazgos.length > 0
        ? `Hallazgos: ${validacion.hallazgos.slice(0, 5).join(" ; ")}`
        : validacion.ejecutada
          ? null
          : validacion.motivo,
    });

    return JSON.stringify(respuesta);
  },
  {
    name: "qaTopologySuite",
    description:
      "Run the QA battery in one call: topology validation, addressing checks (duplicate IPs, hosts without gateway, mismatched masks on the same layer) and, if you pass source and target, an end-to-end ping. Check 'success' AND 'validacionEjecutada' before claiming the topology is fine: with Packet Tracer closed the battery returns success:false and an empty 'topology' because it could NOT check anything (read 'validacionMotivo' and 'aviso'), which is not the same as 'no incidencias'. A ping row with status 'no_reply' is a negative reachability verdict, not a battery failure.",
    schema: z.object({
      sourceName: z
        .string()
        .optional()
        .describe("Source device for the optional connectivity test"),
      targetName: z
        .string()
        .optional()
        .describe("Target device for the optional connectivity test"),
    }),
  },
);

const pingTopologyTool = tool(
  async ({ sourceName, targetName }) => {
    const respuesta = await ciscoClient.callTool("pingDevices", {
      sourceName,
      targetName,
      options: {},
    });

    const ping = interpretarPing(respuesta);
    if (ping.fallo) {
      return JSON.stringify({ success: false, error: ping.fallo });
    }

    const datos = ping.datos;
    await registrarOperacion("INFO", {

      resultado: { success: true },
      tituloOk: "Ping de Topología",
      tituloFallo: "Ping de Topología No Ejecutado",
      exito:
        `Ping ICMP por CLI [${sourceName}] ===> [${targetName}]: estado '${datos?.status}' ` +
        `(${datos?.received ?? "?"}/${datos?.sent ?? "?"} recibidos, ${datos?.lossPercent ?? "?"}% de pérdida).`,
      intento: `Se ejecutó el ping ICMP por CLI [${sourceName}] ===> [${targetName}]`,
      detalle:
        datos?.status === PING_SIN_RESPUESTA
          ? `Sin respuesta de '${targetName}': veredicto NEGATIVO de conectividad, no un fallo de la medición`
          : null,
    });

    return JSON.stringify(datos);
  },
  {
    name: "pingTopology",
    description:
      "Ping a target device from a source device and read ok, status, packet loss, RTT and the raw output. Status 'unsupported_device' = no IOS CLI on the device (not an error). Status 'no_reply' = the PDU left the source and the target did NOT answer: it is a NEGATIVE reachability verdict, NOT a failure of this tool (success stays true because the ping really ran), so read it as 'that destination is unreachable' and check link state, addressing and routes there. Status 'interfaz_no_lista' = the link was not up yet and the PDU never left the source: it is transient, say nothing about the target, so do NOT change the config, wait and retry.",
    schema: z.object({
      sourceName: z.string().describe("Device that sends the ping"),
      targetName: z.string().describe("Device that should answer"),
    }),
  },
);

const reachMatrixTool = tool(
  async ({ sourceName, targetNames }) => {
    const respuesta = await ciscoClient.callTool("reachabilityMatrix", {
      sourceName,
      targetNames,
    });

    const matriz = interpretarMatrizAlcance(respuesta, targetNames);
    if (matriz.fallo) {
      return JSON.stringify({ success: false, error: matriz.fallo });
    }

    const filas = matriz.datos?.rows ?? [];
    await registrarOperacion("INFO", {
      resultado:
        filas.length > 0
          ? { success: true }
          : { success: false, error: matriz.fallo ?? "sin filas" },
      tituloOk: "Matriz de Alcance",
      tituloFallo: "Matriz de Alcance Incompleta",
      exito:
        `Alcance extremo a extremo desde '${sourceName}' hacia ${filas.length} destino(s) ` +
        `medido(s): ${filas.length} fila(s) devueltas.`,
      intento: `Se intentó medir el alcance desde '${sourceName}' hacia ${targetNames.length} destino(s)`,
      detalle: matriz.datos?.truncado
        ? `Solo se midieron ${matriz.datos?.destinosMedidos} de ${matriz.datos?.destinosPedidos} destinos (omitidos: ${(matriz.datos?.destinosOmitidos ?? []).join(", ")})`
        : null,
    });

    return JSON.stringify(matriz.datos);
  },
  {
    name: "reachMatrix",
    description:
      "Check reachability from one source device to a list of targets at once and get a result matrix; cheaper than pinging every pair one by one. The engine measures at most 10 targets per call, so send 10 or fewer and split bigger lists into batches: if 'truncado' is true, 'destinosOmitidos' lists who was NOT measured and those rows say nothing about them. A row with status 'interfaz_no_lista' means the link was not up yet: transient, measure nothing, do NOT change the config and retry. A row with status 'no_reply' is a NEGATIVE reachability verdict (the PDU left the source and nobody answered), not a tool failure.",
    schema: z.object({
      sourceName: z.string().describe("Source device name"),
      targetNames: z
        .array(z.string())
        .max(MAX_DESTINOS_POR_MATRIZ)
        .describe(
          `Target device names to test from the source; at most ${MAX_DESTINOS_POR_MATRIZ}, because the engine only measures that many per call (send more in several calls)`,
        ),
    }),
  },
);

const saveDeviceConfigTool = tool(
  async ({ deviceName, snapshotName }) => {
    if (!REGEX_NOMBRE.test(snapshotName)) {
      return JSON.stringify({
        success: false,
        error: `Nombre de snapshot inválido: '${snapshotName}'. Usa solo letras, números, guiones y guiones bajos (1-60 caracteres).`,
      });
    }

    const result = await ciscoClient.callTool("getDeviceConfigSnapshot", {
      deviceName,
    });
    if (result && result.success === false) {
      return JSON.stringify({
        success: false,
        error: result.error ?? `No se pudo leer la configuración de '${deviceName}'.`,
      });
    }

    const configuracion = extraerConfiguracion(result);
    if (!configuracion) {
      return JSON.stringify({
        success: false,
        error: `Packet Tracer no devolvió la configuración de '${deviceName}': snapshot no guardado.`,
      });
    }

    fs.mkdirSync(TOPOLOGIES_DIR, { recursive: true });
    const ruta = path.join(TOPOLOGIES_DIR, `${snapshotName}.cfg`);
    fs.writeFileSync(ruta, configuracion, "utf8");
    const lineas = configuracion.split(/\r?\n/).length;

    await createLog({
      level: "CONFIGURE",
      title: "Snapshot Guardado",
      content: `Configuración de '${deviceName}' guardada en el servidor como '${snapshotName}.cfg' (${lineas} línea(s)).`,
    });

    return JSON.stringify({
      success: true,
      snapshotName,
      path: ruta,
      lines: lineas,
    });
  },
  {
    name: "saveDeviceConfig",
    description:
      "Save the current configuration of a device as a named snapshot on the server (uploads/topologies/<name>.cfg); keep the name short and reusable to be able to roll back later.",
    schema: z.object({
      deviceName: z.string().describe("Device whose configuration is saved"),
      snapshotName: z
        .string()
        .describe("Snapshot name: letters, numbers, '-' and '_' only (1-60)"),
    }),
  },
);

export const AVISO_NO_REPETIR_RESTAURACION =
  `puede que el snapshot se haya aplicado a medias: NO repitas la restauración; ` +
  `lee la configuración con getDeviceConfig y continúa desde ahí`;

export const AVISO_SNAPSHOT_PARCIAL =
  `la configuración leída NO contiene todo el snapshot: NO repitas la restauración ` +
  `completa (aplicaría dos veces lo que ya está); aplica SÓLO las líneas que falten ` +
  `con configureIosDevice, guiándote por 'verificado'`;

export const AVISO_APLICACION_SIN_CONFIRMAR =
  `NO se sabe si llegó a aplicarse: la llamada a Packet Tracer se cortó por tiempo ` +
  `y el snapshot puede haber entrado entero, a medias o nada. La acción correcta ` +
  `es leer la configuración actual con getDeviceConfig ANTES de reintentar; ` +
  `reenviarlo a ciegas puede aplicar el snapshot dos veces o dejar un ` +
  `'configure terminal' a medias`;

export interface ValidacionRestauracion {
  ok: boolean;

  error?: string;

  lineas: string[];
}

export function validarTextoDeRestauracion(configText: unknown): ValidacionRestauracion {
  const lote = parsearLoteConfiguracion(String(configText ?? ""));
  if (lote.ok) {
    return { ok: true, lineas: lote.lineas };
  }

  const utiles = String(configText ?? "")
    .split(/\r?\n/)
    .filter((linea) => linea.trim().length > 0);
  const demasiadas = utiles.length > MAX_LINEAS_LOTE;

  return {
    ok: false,
    lineas: [],
    error:
      `${lote.error} ` +
      (demasiadas
        ? `Un snapshot no cabe en una sola restauración: la extensión teclea el ` +
          `config línea a línea (~250 ms por línea) con un techo de 120 s, así que a ` +
          `partir de ${MAX_LINEAS_LOTE} líneas la llamada se corta por tiempo y el ` +
          `snapshot se quedaría a medias. NO lo reintentes ni lo recortes a mano: ` +
          `aplica el snapshot POR PARTES con configureIosDevice (hasta ` +
          `${MAX_LINEAS_LOTE} líneas por llamada), que verifica cada parte leyendo ` +
          `la configuración.`
        : `Aplica el snapshot por partes con configureIosDevice (hasta ` +
          `${MAX_LINEAS_LOTE} líneas por llamada, con verificación al final).`),
  };
}

export interface PayloadRestauracionArgs {
  deviceName: string;
  snapshotName: string;
  lineas: string[];

  aplicacion: unknown;
  verificacion: Verificacion;
  equipo?: EquipoRevisado;
}

export function payloadDeRestoreDeviceConfig(
  args: PayloadRestauracionArgs,
): Record<string, unknown> {
  const bruto = payloadDe(args.aplicacion);
  const aplicado = operacionOk(bruto);
  const exito = aplicado && args.verificacion.ok;
  const faltantes = faltantesDe(args.verificacion);
  const informativo =
    bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};

  const payload: Record<string, unknown> = {

    ...informativo,
    success: exito,
    deviceName: args.deviceName,
    snapshotName: args.snapshotName,
    lineas: args.lineas.length,
    aplicado,
    verificacionOk: args.verificacion.ok,
    verificacionRealizada: args.verificacion.realizada,
    verificado: args.verificacion.datos,
    nvr: args.verificacion.nvr,
  };

  if (args.verificacion.motivo) payload.verificacionMotivo = args.verificacion.motivo;
  if (args.equipo) payload.equipo = args.equipo;

  if (!exito) {
    const partes: string[] = [];

    let aviso: string = AVISO_NO_REPETIR_RESTAURACION;

    if (!aplicado) {
      partes.push(
        textoONull(bruto?.error) ??
          "Packet Tracer no confirmó la aplicación del snapshot (posible estado 'unknown').",
      );
    }
    if (!args.verificacion.realizada) {
      partes.push(`no se pudo verificar: ${args.verificacion.motivo ?? "sin motivo"}`);
    } else if (faltantes.length > 0) {
      partes.push(`la configuración leída NO contiene: ${faltantes.join(" ; ")}`);
      aviso = AVISO_SNAPSHOT_PARCIAL;
    } else if (!aplicado) {

      partes.push(
        "la configuración leída contiene lo que trae el snapshot, pero la extensión no confirmó la escritura",
      );
    } else {
      partes.push(
        "el snapshot se verificó leyendo la configuración, pero el envío no fue limpio",
      );
      aviso = AVISO_SNAPSHOT_PARCIAL;
    }

    payload.error =
      partes.join(" | ") ||
      `Packet Tracer no confirmó qué se aplicó de '${args.snapshotName}.cfg'.`;
    payload.aviso = aviso;
  }

  return payload;
}

export function payloadDeRestoreSinConfirmacion(args: {
  deviceName: string;
  snapshotName: string;
  lineas: number;
  motivo: string;
  equipo?: EquipoRevisado;
}): Record<string, unknown> {
  return {
    success: false,
    deviceName: args.deviceName,
    snapshotName: args.snapshotName,
    lineas: args.lineas,

    aplicado: null,
    verificacionOk: false,
    verificacionRealizada: false,
    verificado: [],
    nvr: null,
    verificacionMotivo:
      "no se verificó: la llamada se cortó por tiempo, así que no hay lectura que contrastar",
    error: args.motivo,
    aviso: AVISO_APLICACION_SIN_CONFIRMAR,
    ...(args.equipo ? { equipo: args.equipo } : {}),
  };
}

export function detalleDeVerificacionRestauracion(verificacion: Verificacion): string {
  if (!verificacion.realizada) {
    return `verificación NO realizada (${verificacion.motivo ?? "sin motivo"}); el guardado en NVRAM no se puede afirmar`;
  }
  if (verificacion.datos.length === 0) {
    return "verificación sin datos contrastables (el snapshot no traía hostname ni ip address); el guardado en NVRAM no se puede afirmar";
  }
  const faltan = faltantesDe(verificacion);
  return (
    `verificación leyendo la configuración: ${verificacion.datos.length - faltan.length}` +
    `/${verificacion.datos.length} comprobación(es) coinciden` +
    (faltan.length > 0 ? ` | falta: ${faltan.join(" ; ")}` : "")
  );
}

function mensajeDeExcepcion(error: unknown, porDefecto: string): string {
  return textoONull((error as { message?: unknown } | null)?.message) ?? porDefecto;
}

const restoreDeviceConfigTool = tool(
  async ({ deviceName, snapshotName }) => {

    if (!REGEX_NOMBRE.test(snapshotName)) {
      return JSON.stringify({
        success: false,
        error: `Nombre de snapshot inválido: '${snapshotName}'. Usa solo letras, números, guiones y guiones bajos (1-60 caracteres).`,
      });
    }

    const ruta = path.join(TOPOLOGIES_DIR, `${snapshotName}.cfg`);
    if (!fs.existsSync(ruta)) {
      return JSON.stringify({
        success: false,
        error: `No existe el snapshot '${snapshotName}.cfg' en uploads/topologies/. Guarda uno antes con saveDeviceConfig.`,
      });
    }

    const configuracion = fs.readFileSync(ruta, "utf8");
    const validacion = validarTextoDeRestauracion(configuracion);
    if (!validacion.ok) {

      return JSON.stringify({
        success: false,
        error: validacion.error,
        deviceName,
        snapshotName,
        lineas: 0,
        aplicado: false,
        verificacionOk: false,
        verificado: [],
      });
    }

    let info: any;
    try {
      info = payloadDe(await ciscoClient.callTool("getDeviceInfo", { deviceName }));
    } catch (error) {

      return JSON.stringify({
        success: false,
        error: `No se pudo leer la ficha de '${deviceName}' (${mensajeDeExcepcion(error, "sin detalle")}): no se envió nada, reintentar es seguro. Revisa que el workspace esté abierto.`,
        deviceName,
        snapshotName,
        lineas: validacion.lineas.length,
        aplicado: false,
        verificacionOk: false,
        verificado: [],
      });
    }

    const preflight = revisarEquipoParaConfig(info, deviceName, validacion.lineas);
    if (!preflight.ok) {

      return JSON.stringify({
        success: false,
        error: preflight.error,
        deviceName,
        snapshotName,
        lineas: validacion.lineas.length,
        aplicado: false,
        verificacionOk: false,
        verificado: [],
        equipo: preflight.equipo,
      });
    }

    let aplicacion: any;
    try {
      aplicacion = payloadDe(
        await ciscoClient.callTool("applyDeviceConfig", {
          deviceName,
          configText: configuracion,
        }),
      );
    } catch (error) {

      const corte = payloadDeRestoreSinConfirmacion({
        deviceName,
        snapshotName,
        lineas: validacion.lineas.length,
        motivo: `La aplicación del snapshot '${snapshotName}.cfg' en '${deviceName}' se cortó (${mensajeDeExcepcion(error, "sin detalle")}); no se pudo leer la configuración para confirmar nada.`,
        equipo: preflight.equipo,
      });
      await registrarOperacion("CONFIGURE", {
        resultado: corte,
        tituloOk: "Snapshot Restaurado",
        tituloFallo: "Snapshot Restaurado Sin Confirmar",
        exito: `Snapshot '${snapshotName}.cfg' aplicado a '${deviceName}' y confirmado leyendo la configuración.`,
        intento: `Se envió el snapshot '${snapshotName}.cfg' (${validacion.lineas.length} línea(s)) a '${deviceName}', pero la llamada se cortó y no se pudo confirmar`,
        detalle: AVISO_APLICACION_SIN_CONFIRMAR,
      });
      return JSON.stringify(corte);
    }

    let verificacion: Verificacion;
    try {
      verificacion = verificarLoteContraConfig(
        extraerExpectativas(validacion.lineas),
        payloadDe(await ciscoClient.callTool("getDeviceConfigSnapshot", { deviceName })),
        deviceName,
      );
    } catch (error) {

      verificacion = verificacionNoRealizada(
        `la lectura de verificación (getDeviceConfigSnapshot) falló: ${mensajeDeExcepcion(error, "sin detalle")}. El snapshot ya se había enviado, así que su estado es desconocido`,
      );
    }

    const payload = payloadDeRestoreDeviceConfig({
      deviceName,
      snapshotName,
      lineas: validacion.lineas,
      aplicacion,
      verificacion,
      equipo: preflight.equipo,
    });

    await registrarOperacion("CONFIGURE", {
      resultado: payload,
      tituloOk: "Snapshot Restaurado",
      tituloFallo: "Snapshot No Restaurado",
      exito: `Snapshot '${snapshotName}.cfg' (${validacion.lineas.length} línea(s)) aplicado a '${deviceName}' y confirmado leyendo la configuración.`,
      intento: `Se aplicó el snapshot '${snapshotName}.cfg' (${validacion.lineas.length} línea(s)) a '${deviceName}'`,
      detalle: detalleDeVerificacionRestauracion(verificacion),
    });

    return JSON.stringify(payload);
  },
  {
    name: "restoreDeviceConfig",
    description:
      "Apply a previously saved configuration snapshot (uploads/topologies/<name>.cfg) back to a device; ask the user for approval before rolling a device back. It only accepts snapshots of up to 120 lines, because a full running-config does NOT fit in one call: if it is longer it refuses before touching Packet Tracer and you must apply it in parts with configureIosDevice. It first checks the device exists, has an IOS console and is addressed, and it then READS the configuration back, so 'success' is true only when that read confirms it. When 'success' is false read 'verificado' and 'aviso' and NEVER resend the whole snapshot: read the current configuration with getDeviceConfig first.",
    schema: z.object({
      deviceName: z.string().describe("Device that receives the configuration"),
      snapshotName: z
        .string()
        .describe(
          "Snapshot name saved earlier with saveDeviceConfig (max 120 lines of config)",
        ),
    }),
  },
);

const exportTopologyFileTool = tool(
  async ({ filename }) => {
    const nombreBase = (filename ?? `topologia-${Date.now()}`)
      .trim()
      .replace(/\.pkt$/i, "");
    if (!REGEX_NOMBRE.test(nombreBase)) {
      return JSON.stringify({
        success: false,
        error: `Nombre de archivo inválido: '${filename}'. Usa solo letras, números, guiones y guiones bajos (1-60 caracteres); el sufijo .pkt se añade solo.`,
      });
    }

    fs.mkdirSync(TOPOLOGIES_DIR, { recursive: true });
    const nombreArchivo = `${nombreBase}.pkt`;
    const destino = path.join(TOPOLOGIES_DIR, nombreArchivo);

    const result = await ciscoClient.callTool("exportWorkspace", {
      filename: nombreArchivo,
      targetDir: TOPOLOGIES_DIR,
    });
    if (result && result.success === false) {
      return JSON.stringify({
        success: false,
        error: result.error ?? "Packet Tracer no pudo exportar la topología.",
      });
    }

    const guardado = result?.saved ?? result?.result?.saved;
    if (guardado === "base64") {

      const base64 =
        result?.base64 ?? result?.result?.base64 ?? result?.data ?? result?.result?.data;
      if (typeof base64 !== "string" || base64.length === 0) {
        return JSON.stringify({
          success: false,
          error:
            "Packet Tracer devolvió el workspace en base64 pero sin contenido: no se guardó el archivo.",
        });
      }
      fs.writeFileSync(destino, Buffer.from(base64, "base64"));
    }

    let bytes: number;
    try {
      bytes = fs.statSync(destino).size;
    } catch {
      return JSON.stringify({
        success: false,
        error: `Packet Tracer reportó la exportación pero no se encontró el archivo en '${destino}'.`,
      });
    }

    await createLog({
      level: "CREATE",
      title: "Topología Exportada",
      content: `Workspace exportado a '${nombreArchivo}' (${bytes} bytes).`,
    });

    return JSON.stringify({ success: true, path: destino, bytes });
  },
  {
    name: "exportTopologyFile",
    description:
      "Export the whole Packet Tracer workspace to a .pkt file on the server (uploads/topologies/); the name is sanitized and the .pkt suffix is forced. Use it to hand the file over or to keep a checkpoint.",
    schema: z.object({
      filename: z
        .string()
        .optional()
        .describe("File name without path and without .pkt (auto-generated if omitted)"),
    }),
  },
);

const importTopologyFileTool = tool(
  async ({ filename }) => {
    const nombre = String(filename ?? "").trim();
    if (
      !nombre ||
      nombre.includes("..") ||
      nombre.includes("/") ||
      nombre.includes("\\") ||
      path.isAbsolute(nombre)
    ) {
      return JSON.stringify({
        success: false,
        error: `Nombre de archivo inválido: '${filename}'. Indica solo el nombre de un archivo dentro de uploads/topologies/ (sin rutas ni '..').`,
      });
    }

    const destino = path.resolve(TOPOLOGIES_DIR, nombre);
    if (!destino.startsWith(TOPOLOGIES_DIR + path.sep)) {
      return JSON.stringify({
        success: false,
        error: `Ruta fuera de uploads/topologies/: '${filename}'.`,
      });
    }
    if (!fs.existsSync(destino)) {
      return JSON.stringify({
        success: false,
        error: `No existe '${nombre}' en uploads/topologies/. Exporta la topología antes con exportTopologyFile.`,
      });
    }

    const buffer = fs.readFileSync(destino);
    const result = await ciscoClient.callTool("importWorkspace", {
      filename: nombre,
      sourcePath: destino,
      base64: buffer.toString("base64"),
    });

    await registrarOperacion("CREATE", {
      resultado: result,
      tituloOk: "Topología Importada",
      tituloFallo: "Topología No Importada",
      exito: `Workspace importado desde '${nombre}' (${buffer.length} bytes).`,
      intento: `Se importó el workspace de '${nombre}' (${buffer.length} bytes)`,
    });

    return JSON.stringify(result);
  },
  {
    name: "importTopologyFile",
    description:
      "Load a .pkt file stored in uploads/topologies/ back into the Packet Tracer workspace, replacing its current contents; pass only the file name, never a path.",
    schema: z.object({
      filename: z
        .string()
        .describe("File name inside uploads/topologies/, e.g. topologia-123.pkt"),
    }),
  },
);

const clearWorkspaceTool = tool(
  async () => {
    const result = await ciscoClient.callTool("clearWorkspace", {});

    await registrarOperacion("DELETE", {
      resultado: result,
      tituloOk: "Espacio de Trabajo Limpiado",
      tituloFallo: "Limpieza No Realizada",
      exito:
        "Todos los dispositivos y enlaces del workspace de Packet Tracer fueron eliminados.",
      intento: "Se intentó vaciar el workspace de Packet Tracer (eliminar dispositivos y enlaces)",
      detalle: detalleDeFallosParciales(result),
    });

    return JSON.stringify(result);
  },
  {
    name: "clearWorkspace",
    description:
      "Remove every device and link from the Packet Tracer workspace, leaving it empty; irreversible, so confirm with the user first.",
    schema: z.object({}),
  },
);

const simulateLinkFailureTool = tool(
  async ({ deviceName, interfaceName, durationSeconds }) => {
    const result = await ciscoClient.callTool("simulateLinkFailure", {
      deviceName,
      interfaceName,
      durationSeconds,
    });

    await registrarOperacion("CONFIGURE", {
      resultado: result,
      tituloOk: "Caída de Enlace Simulada",
      tituloFallo: "Caída de Enlace No Simulada",
      exito: `Interfaz '${interfaceName}' de '${deviceName}' apagada (shutdown) para simular la caída de un enlace.`,
      intento: `Se apagó (shutdown) la interfaz '${interfaceName}' de '${deviceName}' para simular la caída de un enlace`,
    });

    return JSON.stringify(result);
  },
  {
    name: "simulateLinkFailure",
    description:
      "Shut down one interface of a device to simulate a link failure ('interface <if>' + 'shutdown'); requires user approval. The link stays down until restoreLink is called, so always bring it back up afterwards. durationSeconds is accepted for compatibility but no timer is started.",
    schema: z.object({
      deviceName: z
        .string()
        .describe("Device that owns the interface to take down"),
      interfaceName: z
        .string()
        .describe("Interface to shut down, e.g. GigabitEthernet0/0"),
      durationSeconds: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Accepted for compatibility only: ignored, no automatic restore is scheduled",
        ),
    }),
  },
);

const restoreLinkTool = tool(
  async ({ deviceName, interfaceName }) => {
    const result = await ciscoClient.callTool("restoreLink", {
      deviceName,
      interfaceName,
    });

    await registrarOperacion("CONFIGURE", {
      resultado: result,
      tituloOk: "Enlace Restaurado",
      tituloFallo: "Enlace No Restaurado",
      exito: `Interfaz '${interfaceName}' de '${deviceName}' encendida de nuevo (no shutdown).`,
      intento: `Se encendió de nuevo (no shutdown) la interfaz '${interfaceName}' de '${deviceName}'`,
    });

    return JSON.stringify(result);
  },
  {
    name: "restoreLink",
    description:
      "Bring a shut interface back up ('interface <if>' + 'no shutdown'), the counterpart of simulateLinkFailure; requires user approval. Use it to finish any failure drill so the topology is left connected.",
    schema: z.object({
      deviceName: z
        .string()
        .describe("Device that owns the interface to bring back up"),
      interfaceName: z
        .string()
        .describe("Interface to enable again, e.g. GigabitEthernet0/0"),
    }),
  },
);

export const CISCO_PACKET_TRACER_TOOLS_ADMIN = [
  createTopologyTool,
  addDeviceTool,
  addModuleTool,
  addLinkTool,
  removeDeviceTool,
  removeLinkTool,
  configurePcIpTool,
  configureIosDeviceTool,
  getNetworkTool,
  getDeviceInfoTool,
  setSimulationModeTool,
  getSimulationStatusTool,
  stepSimulationTool,
  sendPduTool,
  renameDeviceTool,
  moveDeviceTool,
  setPowerTool,
  getPduResultsTool,
  getCommandLogTool,

  runDeviceCommandTool,
  validateTopologyTool,
  listDeviceModelsTool,
  listDeviceModulesTool,
  subnetCalcTool,
  getDeviceConfigTool,
  generateNetworkReportTool,
  qaTopologySuiteTool,
  pingTopologyTool,
  reachMatrixTool,

  readDeviceConsoleTool,
  getRoutingTableTool,
  getVlanConfigurationTool,
  getDeviceMetricsTool,
  validateSecurityConfigTool,

  saveDeviceConfigTool,
  restoreDeviceConfigTool,
  exportTopologyFileTool,
  importTopologyFileTool,
  clearWorkspaceTool,
  simulateLinkFailureTool,
  restoreLinkTool,
  ...CONNECTION_TOOLS,
  searchKnowledgeBaseTool,
];

export const CISCO_TOOLS_USER = [
  getNetworkTool,
  getDeviceInfoTool,
  getSimulationStatusTool,
  getPduResultsTool,
  getCommandLogTool,
  runDeviceCommandTool,
  validateTopologyTool,
  listDeviceModelsTool,
  listDeviceModulesTool,
  subnetCalcTool,
  getDeviceConfigTool,
  generateNetworkReportTool,
];
