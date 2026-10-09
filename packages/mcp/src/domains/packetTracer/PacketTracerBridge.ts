/**
 * Cliente del bridge de Packet Tracer para el servidor MCP.
 *
 * DÓNDE VIVE EL PUENTE AHORA
 * --------------------------
 * Este fichero YA NO es un cliente `socket.io-client`: el MCP aloja su propio
 * puente Socket.IO en `PacketTracerBridgeServer.ts` (puerto `MCP_BRIDGE_PORT`,
 * 7532 por defecto) y la extensión de Packet Tracer se conecta AL MCP. Antes el
 * puente vivía en el backend (`SERVER_PORT`, 7531) y este fichero era un cliente
 * que se dializaba a `http://localhost:7531`, con lo cual el MCP no podía hablar
 * con Packet Tracer sin el backend arrancado.
 *
 * Ahora la petición y la respuesta viajan en el MISMO proceso: `solicitarTool`
 * emite `tool_call` al socket de la extensión y `esperarResultado` resuelve la
 * promise cuando llega su `tool_result`. El único requisito es que la extensión
 * haya conectado al puente del MCP; el backend es irrelevante para todo el
 * paquete (GNS3, serie, SSH, telnet, planes y skills nunca lo necesitaron).
 *
 * POR QUÉ SE REIMPLEMENTA EN VEZ DE IMPORTARSE
 * El servidor tiene `packages/server/src/client/PacketTracerClient.ts`, que hace
 * exactamente esto (socket.io → `tool_call` → esperar `tool_result`), pero vive
 * dentro de otro paquete CommonJS con alias `@/` propios y arrastra imports del
 * backend (Prisma, su EnvConfig). Importarlo desde aquí obligaría a compilar el
 * server entero y a compartir su configuración.
 *
 * Lo que se replica es SOLO el protocolo del bridge, que es pequeño y estable:
 *   - se emite `tool_call` con `{tool_call_id, tool_name, tool_input}`;
 *   - la extensión responde `tool_result` con `{tool_call_id, result}`;
 *   - el id es `tool-<nombre>-<uuid>` y correlaciona la respuesta.
 * Las constantes del protocolo (nombres de evento y forma del id) se copian
 * literales para no divergir del lado de la extensión.
 */
import {
  esperarResultado,
  olvidarLlamada,
  solicitarTool,
} from "./PacketTracerBridgeServer";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import {
  McpToolError,
  errorNoDisponible,
  normalizarError,
} from "@/core/errors";

/**
 * Tabla de timeouts por herramienta del bridge.
 *
 * Se copia de `PacketTracerClient.ts` porque cada operación de Packet Tracer
 * tiene un coste real muy distinto (colocar un equipo no tarda lo mismo que
 * exportar el workspace entero). Usar un timeout único obligaría a poner el
 * máximo a todo, y entonces un cuelgue de una lectura corta tardaría minutos en
 * reportarse.
 *
 * OJO: `addModule` NO está en la tabla del servidor (cae al default de 60 s);
 * aquí se conserva igual, con su default, para no cambiar el comportamiento.
 */
const TIMEOUT_POR_HERRAMIENTA: Record<string, number> = {
  listDeviceModels: 15_000,
  getDeviceInfo: 15_000,
  readDeviceConsole: 15_000,
  listDeviceModules: 15_000,
  getCommandLog: 15_000,

  getRoutingTable: 30_000,
  getVlanConfiguration: 30_000,
  getDeviceConfigSnapshot: 45_000,
  getDeviceMetrics: 45_000,
  validateSecurityConfig: 45_000,
  runDeviceCommands: 60_000,

  runCommandAsync: 30_000,
  pollCommandResult: 25_000,

  getNetwork: 45_000,
  validateTopology: 45_000,

  getSimulationStatus: 10_000,
  setSimulationMode: 30_000,
  stepSimulation: 30_000,
  getPduResults: 30_000,
  sendPdu: 45_000,

  moveDevice: 15_000,
  addDevice: 20_000,
  removeDevice: 20_000,
  addLink: 20_000,
  removeLink: 20_000,
  renameDevice: 20_000,
  configurePcIp: 30_000,
  setPower: 30_000,
  clearWorkspace: 30_000,

  applyDeviceConfig: 120_000,
  simulateLinkFailure: 30_000,
  restoreLink: 30_000,

  pingDevices: 60_000,
  reachabilityMatrix: 90_000,
  exportWorkspace: 90_000,
  importWorkspace: 90_000,
};

/** Timeout de respaldo cuando la herramienta no está en la tabla. */
const TIMEOUT_POR_DEFECTO = 60_000;

/** Devuelve el timeout de una herramienta del bridge. */
export function timeoutDeHerramienta(nombre: string): number {
  return TIMEOUT_POR_HERRAMIENTA[nombre] ?? TIMEOUT_POR_DEFECTO;
}

/**
 * Cliente del bridge.
 *
 * Es un singleton porque el bridge es un recurso GLOBAL: solo hay un socket de
 * extensión conectado a la vez (`PacketTracerBridgeServer` guarda uno), así que
 * abrir varias "conexiones" no daría acceso a más equipos, solo duplicaría
 * trabajo. Al no haber socket propio, lo único que guarda estado son los
 * temporizadores de timeout por `tool_call_id`: son los que permiten `cerrar()`
 * y el apagado orderly sin dejar promesas vivas.
 */
class PacketTracerBridge {
  /** `tool_call_id` → temporizador de timeout de esa llamada. */
  private readonly temporizadores = new Map<string, NodeJS.Timeout>();

  /** URL del puente del MCP (solo para los mensajes de diagnóstico). */
  private get url(): string {
    return `http://${envConfig.MCP_BRIDGE_HOST}:${envConfig.MCP_BRIDGE_PORT}`;
  }

  /**
   * Llama a una herramienta de la extensión de Packet Tracer.
   *
   * Devuelve el payload ya desenvuelto. NO lanza por errores del motor: si
   * Packet Tracer responde `{success:false, error}`, eso se devuelve tal cual
   * para que el modelo vea el motivo real. Solo lanza si el bridge no responde.
   *
   * El camino es en proceso: `solicitarTool` entrega el `tool_call` a la extensión
   * a través del socket del puente y `esperarResultado` engancha la promise al
   * `tool_call_id`. El timeout de la tabla sigue siendo el de esta capa (y no el
   * del puente) porque el coste por herramienta es muy distinto.
   */
  async callTool(
    nombre: string,
    input: Record<string, unknown>,
    opciones: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const timeoutMs =
      opciones.timeoutMs && opciones.timeoutMs > 0
        ? opciones.timeoutMs
        : timeoutDeHerramienta(nombre);

    return new Promise<unknown>((resolver, rechazar) => {
      let toolCallId: string;
      try {
        toolCallId = solicitarTool(nombre, input).toolCallId;
      } catch (error) {
        // Sin puente o sin extensión: se propaga el error accionable tal cual
        // (es un `McpToolError` con sugerencia, y el modelo lo necesita ya).
        Logger.debug(`Llamada a '${nombre}' descartada antes de emitirse: ${String(error)}`);
        rechazar(error);
        return;
      }

      const temporizador = setTimeout(() => {
        this.temporizadores.delete(toolCallId);
        // Se olvida la llamada del registro del puente: si su resultado llegara
        // más tarde no debe quedarse despierto ningún temporizador.
        olvidarLlamada(toolCallId);
        rechazar(
          errorNoDisponible(
            `Packet Tracer no respondió a '${nombre}' en ${Math.round(timeoutMs / 1000)} s.`,
            "El comando pudo haberse encolado igualmente en la extensión, así que NO lo repitas a ciegas: " +
              "comprueba el estado con una lectura (packet_tracer_get_network o packet_tracer_read_console). " +
              "Si la consola quedó bloqueada por un diálogo, reinicia Packet Tracer. " +
              `Verifica también que la extensión está conectada al bridge del MCP (${this.url}) ` +
              `y que MCP_BRIDGE_PORT=${envConfig.MCP_BRIDGE_PORT} es el puerto al que se conecta.`,
          ),
        );
      }, timeoutMs);
      this.temporizadores.set(toolCallId, temporizador);

      esperarResultado(toolCallId).then(
        (valor) => {
          clearTimeout(temporizador);
          this.temporizadores.delete(toolCallId);
          resolver(desenvolverEnvoltorio(valor));
        },
        (error) => {
          clearTimeout(temporizador);
          this.temporizadores.delete(toolCallId);
          rechazar(error);
        },
      );
    });
  }

  /**
   * Corta lo pendiente y rechaza las llamadas en vuelo.
   *
   * El puente en sí lo cierra `detenerBridge()` (McpServer lo llama al apagarse);
   * esto solo suelta los temporizadores propios para que un cierre no deje timers
   * vivos manteniendo el proceso.
   */
  async cerrar(): Promise<void> {
    for (const [id, temporizador] of this.temporizadores) {
      clearTimeout(temporizador);
      olvidarLlamada(id);
    }
    this.temporizadores.clear();
  }
}

/**
 * Deshace el envoltorio `{code, result}` que Packet Tracer añade alrededor de
 * `runCode`. Es idempotente: la extensión ya lo quita a veces y el servidor lo
 * vuelve a intentar, así que se aplica en bucle hasta que deja de aplicar.
 */
function desenvolverEnvoltorio(valor: unknown): unknown {
  let actual = valor;
  let vueltas = 0;
  while (
    vueltas < 5 &&
    actual &&
    typeof actual === "object" &&
    typeof (actual as { code?: unknown }).code === "string" &&
    "result" in (actual as object)
  ) {
    actual = (actual as { result: unknown }).result;
    vueltas++;
  }
  return actual;
}

export const packetTracerBridge = new PacketTracerBridge();

/**
 * ¿Confirmó la extensión que la operación se hizo?
 *
 * Mismo criterio que el servidor: cualquier marca de fallo (`success:false`,
 * `error`) la hunde; un payload sin marcas de fallo se da por bueno, porque
 * varias funciones solo devuelven `message`.
 */
export function operacionOk(resultado: unknown): boolean {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) {
    return false;
  }
  const bruto = resultado as Record<string, unknown>;
  if (bruto.success === false) return false;
  if (bruto.succes === false) return false; // errata histórica del plugin
  if (bruto.error) return false;
  return true;
}

/**
 * Envuelve una llamada al bridge y traduce los fallos a errores accionables.
 *
 * Los errores del motor (`success:false`) NO se convierten en excepción: se
 * devuelven como payload para que el modelo lea el motivo exacto que dio Packet
 * Tracer (por ejemplo, que un modelo de dispositivo no existe).
 */
export async function llamarPacketTracer(
  nombre: string,
  input: Record<string, unknown>,
  opciones: { timeoutMs?: number } = {},
): Promise<unknown> {
  try {
    return await packetTracerBridge.callTool(nombre, input, opciones);
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    throw normalizarError(error);
  }
}
