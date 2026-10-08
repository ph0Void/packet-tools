import { SshClient } from "@/client/SshClient";
import { TelnetClient } from "@/client/TelnetClient";
import { SerialPortClient } from "@/client/SerialPortClient";
import { ejecutarYEsperar } from "@/client/PacketTracerConsola";
import { Logger } from "@/utils/Logger";

export const MAX_COMANDOS_STANDARD = 30;

export const MAX_SALIDA_STANDARD = 8000;

export interface ProveedorDeJob {
  id: string;
  name: string;
  protocol: string | null;
  typeDevice: string | null;
}

export interface JobStandard {
  id: string;
  name: string;
  payload: string | null;
  deviceProviderId: string | null;
  deviceProvider: ProveedorDeJob | null;
}

export interface ResultadoComandos {
  ok: boolean;
  salida: string;
  error?: string;
}

function recortar(texto: string, tope: number = MAX_SALIDA_STANDARD): string {
  const limpio = String(texto ?? "");
  if (limpio.length <= tope) return limpio;
  return `${limpio.slice(0, tope)}… [salida recortada: ${limpio.length} caracteres]`;
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "error desconocido");
}

export function extraerComandos(payload: string | null): string[] {
  const bruto = String(payload ?? "").trim();
  if (!bruto) return [];

  if (bruto.startsWith("{") || bruto.startsWith("[")) {
    try {
      const dato = JSON.parse(bruto);
      if (Array.isArray(dato)) {
        return dato.map((item) => String(item).trim()).filter(Boolean);
      }
      if (dato && typeof dato === "object") {
        const contenedor = dato as Record<string, unknown>;
        const fuente = contenedor.commands ?? contenedor.comandos ?? contenedor.command;
        if (Array.isArray(fuente)) {
          return fuente.map((item) => String(item).trim()).filter(Boolean);
        }
        if (typeof fuente === "string") {
          return fuente.split("\n").map((linea) => linea.trim()).filter(Boolean);
        }
      }
    } catch {

    }
  }

  return bruto.split("\n").map((linea) => linea.trim()).filter(Boolean);
}

async function ejecutarSsh(
  deviceProviderId: string,
  comandos: string[],
): Promise<string> {
  const cliente = await SshClient.fromProviderId(deviceProviderId);
  try {

    await cliente.connect();
    return await cliente.executeCommands(comandos);
  } finally {
    await cliente.disconnect().catch(() => undefined);
  }
}

async function ejecutarTelnet(
  deviceProviderId: string,
  comandos: string[],
): Promise<string> {
  const cliente = await TelnetClient.fromProviderId(deviceProviderId);
  try {
    return await cliente.executeCommands(comandos);
  } finally {
    await cliente.disconnect().catch(() => undefined);
  }
}

async function ejecutarSerie(
  deviceProviderId: string,
  comandos: string[],
): Promise<string> {
  const cliente = await SerialPortClient.fromProviderId(deviceProviderId);
  try {
    const partes: string[] = [];
    for (const comando of comandos) {
      partes.push(await cliente.executeCommand(comando));
    }
    return partes.join("\n");
  } finally {
    await cliente.disconnect().catch(() => undefined);
  }
}

async function ejecutarPacketTracer(
  nombreDispositivo: string,
  comandos: string[],
): Promise<{ ok: boolean; salida: string }> {
  const ciclo = await ejecutarYEsperar(nombreDispositivo, comandos, {});
  const detalle = ciclo.results
    .map((fila) => `> ${fila.command}\n${fila.output ?? ""}`)
    .join("\n");
  const resumen = `Resumen: ${ciclo.resumen.ok}/${ciclo.resumen.total} correctos, ${ciclo.resumen.errors} con error.`;
  const salida = [detalle, resumen].filter(Boolean).join("\n");

  const ok = !ciclo.fallo && !ciclo.timedOut && ciclo.resumen.errors === 0;
  return { ok, salida: ciclo.fallo ? `${salida}\n${ciclo.fallo}` : salida };
}

export async function ejecutarComandosDeJob(
  job: JobStandard,
): Promise<ResultadoComandos> {
  const comandos = extraerComandos(job.payload);
  if (comandos.length === 0) {
    return {
      ok: false,
      salida: "",
      error:
        "STANDARD sin comandos en payload: el payload debe traer los comandos " +
        '(un array, un JSON {"commands":[…]} o texto plano con saltos de línea).',
    };
  }
  if (comandos.length > MAX_COMANDOS_STANDARD) {
    return {
      ok: false,
      salida: "",
      error: `El payload trae ${comandos.length} comandos y el máximo por ejecución es ${MAX_COMANDOS_STANDARD}.`,
    };
  }

  if (!job.deviceProviderId) {
    return {
      ok: false,
      salida: "",
      error:
        "La automatización no indica QUÉ equipo comandar (deviceProviderId). " +
        "Una topología no sirve: tiene muchos dispositivos, así que no se puede " +
        "elegir uno por defecto. Asigna un dispositivo a la automatización.",
    };
  }

  const proveedor = job.deviceProvider;
  if (!proveedor) {
    return {
      ok: false,
      salida: "",
      error: `El dispositivo asignado a la automatización ya no existe (deviceProviderId=${job.deviceProviderId}).`,
    };
  }

  Logger.info({
    message: `[CRON_COMMAND_RUNNER] '${job.name}' (${job.id}) ejecuta ${comandos.length} comando(s) sobre '${proveedor.name}' (${proveedor.protocol}/${proveedor.typeDevice}).`,
  });

  try {
    const resultado = await despachar(proveedor, comandos);
    const salida = recortar(resultado.salida);

    return { ok: resultado.ok ?? salida.trim().length > 0, salida };
  } catch (error) {

    return { ok: false, salida: "", error: mensajeDe(error) };
  }
}

async function despachar(
  proveedor: ProveedorDeJob,
  comandos: string[],
): Promise<{ ok?: boolean; salida: string }> {
  switch (proveedor.protocol) {
    case "SSH":
      return { salida: await ejecutarSsh(proveedor.id, comandos) };
    case "TELNET":
      return { salida: await ejecutarTelnet(proveedor.id, comandos) };
    case "SERIAL":
      return { salida: await ejecutarSerie(proveedor.id, comandos) };
    case "SIMULATION":
      if (proveedor.typeDevice === "PACKET_TRACER") {
        return await ejecutarPacketTracer(proveedor.name, comandos);
      }
      if (proveedor.typeDevice === "GNS3") {

        throw new Error(
          "Las automatizaciones STANDARD sobre nodos GNS3 todavía no ejecutan comandos: " +
            "no hay forma de abrir una sesión de consola contra un nodo de GNS3 desde el backend. " +
            "Usa una automatización INTELLIGENT (el agente sí sabe operar la topología) " +
            "o un dispositivo con SSH/Telnet/serie.",
        );
      }
      throw new Error(
        `Protocolo SIMULATION con tipo de dispositivo '${String(proveedor.typeDevice)}' sin ejecución de comandos automática.`,
      );
    default:
      throw new Error(
        `Protocolo '${String(proveedor.protocol)}' no soportado por las automatizaciones STANDARD.`,
      );
  }
}
