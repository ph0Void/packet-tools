import { envConfig } from "@/config/EnvConfig";
import { io, Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { SerializadorPorClave } from "@/client/SerializadorPorClave";

interface ToolCallData {
  tool_call_id: string;
  tool_name: string;
  tool_input: Record<string, any>;
}

interface ToolResultData {
  tool_call_id: string;
  result: any;
}

export interface OpcionesCallTool {

  timeoutMs?: number;
}

export const CLAVE_GLOBAL = "__global__";

const HERRAMIENTAS_GLOBALES = new Set<string>([

  "getNetwork", // snapshot de dispositivos, puertos y enlaces
  "validateTopology", // batería estructural sobre todo el lienzo
  "listDeviceModels", // catálogo de PT (no toca equipos, pero es del motor)
  "clearWorkspace", // borra dispositivos y enlaces
  "exportWorkspace", // vuelca el workspace entero a un .pkt
  "importWorkspace", // reemplaza el workspace entero

  "addDevice", // crea el equipo y lo coloca en el lienzo
  "addLink", // une dos equipos (ambos puertos)
  "removeDevice", // array de equipos
  "removeLink", // array de enlaces

  "setSimulationMode", // conmuta el modo del workspace
  "getSimulationStatus", // contadores globales de la simulación
  "stepSimulation", // avanza el reloj de la simulación
  "sendPdu", // PDU nativa entre origen y destino
  "getPduResults", // historial de PDUs del escenario

  "pingDevices", // ping CLI origen → destino (consola de origen)
  "reachabilityMatrix", // un origen contra N destinos
]);

const CAMPOS_DE_DISPOSITIVO = [
  "deviceName",
  "switchName",
  "sourceName",
  "targetName",
  "device",
  "pendienteId",
];

export function dispositivoDe(toolName: string, input: any): string {
  if (HERRAMIENTAS_GLOBALES.has(toolName)) return CLAVE_GLOBAL;

  if (input && typeof input === "object") {
    for (const campo of CAMPOS_DE_DISPOSITIVO) {
      const valor = (input as Record<string, unknown>)[campo];

      if (valor === null || valor === undefined) continue;
      if (typeof valor === "object") continue;
      const nombre = String(valor).trim();
      if (nombre.length > 0) return `dispositivo:${nombre.toLowerCase()}`;
    }
  }

  return CLAVE_GLOBAL;
}

export const TIMEOUT_POR_HERRAMIENTA: Record<string, number> = {

  listDeviceModels: 15_000, // inventario del motor: rápido si PT responde

  getDeviceInfo: 15_000, // inventario de puertos, sin ejecutar comandos
  readDeviceConsole: 15_000, // lee el buffer de la consola, no ejecuta nada
  listDeviceModules: 15_000, // slots instalados, sin reiniciar el equipo
  getCommandLog: 15_000, // historial ya registrado por PT

  getRoutingTable: 30_000, // un `show ip route`
  getVlanConfiguration: 30_000, // un `show vlan brief`
  getDeviceConfigSnapshot: 45_000, // running + startup config (+ xml de PT):

  getDeviceMetrics: 45_000, // varios `show` (procesos, memoria) encadenados
  validateSecurityConfig: 45_000, // `show run` + análisis de las líneas vty
  runDeviceCommands: 60_000, // lote de comandos de solo lectura: misma clase

  runCommandAsync: 30_000,
  pollCommandResult: 25_000,

  getNetwork: 45_000, // snapshot grande = 20-30 s medidos, con margen
  validateTopology: 45_000, // recorre todo el lienzo

  getSimulationStatus: 10_000, // lectura de contadores
  setSimulationMode: 30_000, // conmutar de modo puede tardar
  stepSimulation: 30_000, // hasta 100 pasos
  getPduResults: 30_000, // historial de PDUs
  sendPdu: 45_000, // crear y enviar la PDU nativa (habilita simulación)

  moveDevice: 15_000, // solo coordenadas del lienzo
  addDevice: 20_000, // colocar el equipo
  removeDevice: 20_000, // borrar del lienzo
  addLink: 20_000, // comprobar dos puertos y cablear
  removeLink: 20_000, // quitar cables
  renameDevice: 20_000, // renombrar
  configurePcIp: 30_000, // estática o DHCP (puede tardar en negociar)
  setPower: 30_000, // apagar/encender: espera al arranque
  clearWorkspace: 30_000, // borrar todo el lienzo

  applyDeviceConfig: 120_000, // restaura un running-config completo línea a

  simulateLinkFailure: 30_000, // `interface` + `shutdown`
  restoreLink: 30_000, // `interface` + `no shutdown`

  pingDevices: 60_000, // ping CLI de 25 s medidos + reintentos y salida
  reachabilityMatrix: 90_000, // un origen contra N destinos: los pings se

  exportWorkspace: 90_000, // volcar el workspace entero (tamaño del .pkt)
  importWorkspace: 90_000, // reemplazar el workspace entero
};

export const TIMEOUT_POR_DEFECTO = 60_000;

export function timeoutDe(toolName: string, opciones?: OpcionesCallTool): number {
  const propio = opciones?.timeoutMs;
  if (typeof propio === "number" && Number.isFinite(propio) && propio > 0) {
    return Math.floor(propio);
  }
  return TIMEOUT_POR_HERRAMIENTA[toolName] ?? TIMEOUT_POR_DEFECTO;
}

export function mensajeDeTimeout(
  toolName: string,
  clave: string,
  timeoutMs: number,
): string {
  const segundos = Math.round(timeoutMs / 100) / 10;
  const equipo =
    clave === CLAVE_GLOBAL
      ? " (operación global del workspace)"
      : ` en el dispositivo '${clave.replace(/^dispositivo:/, "")}'`;
  return (
    `Timeout de ${segundos}s esperando la respuesta de Packet Tracer a la ` +
    `herramienta '${toolName}'${equipo}. El comando ya estaba encolado en la ` +
    `extensión: puede ejecutarse más tarde aunque aquí figure como fallo, así ` +
    `que verifica el estado del equipo antes de repetirlo. Si la consola quedó ` +
    `bloqueada (p. ej. un diálogo de configuración inicial), reinicia Packet ` +
    `Tracer; comprueba también que la extensión está conectada al backend ` +
    `(${envConfig.SERVER_PORT || 7531}).`
  );
}

function desenvolverEnvoltorio(valor: any): any {
  let v = valor;
  while (
    v &&
    typeof v === "object" &&
    typeof v.code === "string" &&
    "result" in v
  ) {
    v = v.result;
  }
  return v;
}

class CiscoClient {
  private socket: Socket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private bridgeUrl: string;

  private readonly serializador = new SerializadorPorClave();

  constructor(bridgeUrl?: string) {
    const PORT = envConfig.SERVER_PORT || 7531;
    this.bridgeUrl = bridgeUrl || `http://localhost:${PORT}`;
  }

  private initSocket() {
    if (this.socket) return;
    this.socket = io(this.bridgeUrl, {
      transports: ["websocket"],
      reconnection: true,
      query: { clientType: "backend-agent" },
      auth: process.env.PT_EXTENSION_SECRET ? { secret: process.env.PT_EXTENSION_SECRET } : undefined,
    });

    this.socket.on("connect", () => {
      Logger.info({
        message: `CiscoClient conectado al servidor puente en ${this.bridgeUrl}`,
      });
    });

    this.socket.on("tool_result", (data: ToolResultData) => {
      if (
        data &&
        data.tool_call_id &&
        this.pendingRequests.has(data.tool_call_id)
      ) {
          const pending = this.pendingRequests.get(data.tool_call_id);
          if (pending) {
            pending.resolve(desenvolverEnvoltorio(data.result));
            this.pendingRequests.delete(data.tool_call_id);
          }
      }
    });

    this.socket.on("disconnect", () => {
      Logger.info({
        message: `CiscoClient desconectado del servidor puente en ${this.bridgeUrl}`,
      });
    });
  }

  public static async fromDatabase(providerId?: string): Promise<CiscoClient> {
    try {
      const provider = providerId
        ? await prismaClient.deviceProviders.findUnique({
            where: { id: providerId },
          })
        : await prismaClient.deviceProviders.findFirst({
            where: { typeDevice: "PACKET_TRACER" },
          });

      if (provider && provider.host) {
        return new CiscoClient(provider.host);
      }
    } catch (e) {
      Logger.error({
        message:
          "[CiscoClient] Error al cargar la configuración desde la base de datos.",
        data: e,
      });
    }
    return new CiscoClient();
  }

  public callTool(
    toolName: string,
    input: any,
    opciones?: OpcionesCallTool,
  ): Promise<any> {
    this.initSocket();
    const timeoutMs = timeoutDe(toolName, opciones);
    const clave = dispositivoDe(toolName, input);

    return clave === CLAVE_GLOBAL
      ? this.serializador.encolarExclusivo(clave, () =>
          this.enviarYEsperar(toolName, input, timeoutMs, clave),
        )
      : this.serializador.encolar(clave, () =>
          this.enviarYEsperar(toolName, input, timeoutMs, clave),
        );
  }

  private enviarYEsperar(
    toolName: string,
    input: any,
    timeoutMs: number,
    clave: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const uuidCall = uuidv4();
      const toolCallID = `tool-${toolName}-${uuidCall}`;
      const mensaje = mensajeDeTimeout(toolName, clave, timeoutMs);

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(toolCallID)) {
          this.pendingRequests.delete(toolCallID);
          Logger.warning({
            message: `[CiscoClient] ${mensaje}`,
            data: { toolName, clave, timeoutMs },
          });
          reject(new Error(mensaje));
        }
      }, timeoutMs);

      this.pendingRequests.set(toolCallID, {
        resolve: (val: any) => {
          clearTimeout(timeout);
          resolve(val);
        },
        reject: (err: any) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.socket!.emit("tool_call", {
        tool_call_id: toolCallID,
        tool_name: toolName,
        tool_input: input,
      } as ToolCallData);
    });
  }
}

export const ciscoClient = new CiscoClient();
