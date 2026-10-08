import { ciscoClient } from "@/client/PacketTracerClient";
import { Logger } from "@/utils/Logger";

export type FuenteSalida = "commandEnded" | "buffer" | "sincrono";

export interface FilaComando {
  command: string;
  status: string;
  output: string;

  corte?: string;
}

export interface ResumenComandos {
  total: number;
  ok: number;
  errors: number;
}

const DIAGNOSTICOS = [
  "warning",
  "despertar",
  "modo",
  "preambulo",
  "arranque_pendiente",
  "corte",
  "salida_recortada",
  "consola_ocupada",
] as const;

export interface OpcionesCiclo {

  mode?: string;

  budgetMs?: number;

  pollMs?: number;

  timeoutMs?: number;

  pollTimeoutMs?: number;

  fallbackTimeoutMs?: number;

  lineasConsola?: number;

  reintentable?: boolean;

  nombreTool?: string;
}

export interface ResultadoCiclo {

  results: FilaComando[];

  fuente: FuenteSalida;

  pendienteMs: number;

  intentos: number;

  timedOut: boolean;
  deviceName: string;

  deviceType: string | number | null;
  resumen: ResumenComandos;

  fallo?: string;

  respaldo?: string;

  reintentado: boolean;

  motivoReintento?: string;

  comandoConsumido?: boolean;

  bloqueoResuelto?: string;

  bloqueoAgotado?: boolean;

  diagnostico: Record<string, unknown>;
}

export const POLL_MS_POR_DEFECTO = 250;

export const POLL_MS_TECHO = 1_000;

export const RONDAS_POR_PULSO = 8;

export const ESPERAR_MS_TECHO = 500;

export const ESPERAR_SIN_EVENTO_MS = 300;

export const BUDGET_MS_POR_DEFECTO = 25_000;

export const ESTADO_REINTENTAR = "reintentar";

export const MAX_LANZAMIENTOS = 2;

export function presupuestoPorIntento(
  budgetMs: number,
  intentosPosibles: number = 1,
): number {
  const total = positivo(budgetMs, BUDGET_MS_POR_DEFECTO);
  const intentos = Math.max(1, Math.floor(Number(intentosPosibles) || 1));
  return Math.max(1, Math.floor(total / intentos));
}

export interface BloqueoConsola {

  consumido: boolean;

  resuelto?: string;

  agotado: boolean;
}

export function bloqueoDe(payload: any): BloqueoConsola {
  return {
    consumido:
      payload?.estado === ESTADO_REINTENTAR || payload?.comandoConsumido === true,
    resuelto: textoDe(payload?.bloqueoResuelto),
    agotado: payload?.bloqueoAgotado === true,
  };
}

export const LINEAS_CONSOLA_RESPALDO = 80;

const SIN_SOPORTE = /no compatible|no soportad|unknown tool|herramienta (no|desconocid)/i;

export function desenvolver(valor: any): any {
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

function comoArray(valor: any): any[] {
  if (Array.isArray(valor)) return valor;
  if (valor && typeof valor === "object" && typeof valor.length === "number") {
    const out: any[] = [];
    for (let i = 0; i < valor.length; i++) if (i in valor) out.push(valor[i]);
    return out;
  }
  return [];
}

function filaDe(bruta: any): FilaComando {
  const fila: FilaComando = {
    command: String(bruta?.command ?? ""),
    status: String(bruta?.status ?? "unknown"),
    output: typeof bruta?.output === "string" ? bruta.output : "",
  };

  if (bruta?.corte !== undefined && bruta?.corte !== null) {
    fila.corte = String(bruta.corte);
  }
  return fila;
}

export function filasDe(payload: any): FilaComando[] {
  return comoArray(payload?.results).map(filaDe);
}

export function resumenDe(filas: FilaComando[]): ResumenComandos {
  let ok = 0;
  for (const fila of filas) if (fila.status === "ok") ok += 1;
  return { total: filas.length, ok, errors: filas.length - ok };
}

function resumenDePayload(payload: any, filas: FilaComando[]): ResumenComandos {
  const bruto = payload?.summary;
  if (bruto && typeof bruto === "object" && typeof bruto.total === "number") {
    return {
      total: bruto.total,
      ok: typeof bruto.ok === "number" ? bruto.ok : 0,
      errors: typeof bruto.errors === "number" ? bruto.errors : 0,
    };
  }
  return resumenDe(filas);
}

function diagnosticosDe(...payloads: any[]): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    for (const clave of DIAGNOSTICOS) {
      if (salida[clave] === undefined && payload[clave] !== undefined) {
        salida[clave] = payload[clave];
      }
    }
  }
  return salida;
}

function positivo(valor: unknown, porDefecto: number): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? Math.floor(valor)
    : porDefecto;
}

function textoDe(valor: unknown): string | undefined {
  if (typeof valor === "string" && valor.trim().length > 0) return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return undefined;
}

function tipoDeDispositivo(bruto: any): string | number | null {
  const valor = bruto?.deviceType ?? bruto?.result?.deviceType;
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim().length > 0) return valor;
  return null;
}

function numeroDe(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

export function intervaloDe(intento: number, pollMs = POLL_MS_POR_DEFECTO): number {
  const base = positivo(pollMs, POLL_MS_POR_DEFECTO);
  const pulso = Math.floor(Math.max(0, intento - 1) / RONDAS_POR_PULSO);
  const factor = Math.pow(2, pulso);
  return Math.min(base * factor, POLL_MS_TECHO);
}

function esperar(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mensajeDe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "error desconocido");
}

interface RondaSondeo {

  done: boolean;

  cerrado: boolean;

  sinSoporte: boolean;
  payload: any;
}

async function sondear(
  pendienteId: string,
  deviceName: string,
  esperarMs: number,
  opciones: OpcionesCiclo,
): Promise<RondaSondeo> {
  try {
    const bruto = desenvolver(
      await ciscoClient.callTool(
        "pollCommandResult",
        {
          pendienteId,

          deviceName,
          options: { esperarMs },
        },
        opciones.pollTimeoutMs
          ? { timeoutMs: opciones.pollTimeoutMs }
          : undefined,
      ),
    );

    if (!bruto || typeof bruto !== "object") {
      return { done: false, cerrado: false, sinSoporte: false, payload: bruto };
    }
    if (bruto.success === false || bruto.error) {
      return {
        done: false,
        cerrado: true,
        sinSoporte: SIN_SOPORTE.test(String(bruto.error ?? "")),
        payload: bruto,
      };
    }
    return {
      done: bruto.done === true,
      cerrado: false,
      sinSoporte: false,
      payload: bruto,
    };
  } catch (error) {
    Logger.warning({
      message:
        `[Consola] pollCommandResult('${pendienteId}') falló en '${deviceName}': ` +
        `${mensajeDe(error)}. El comando puede seguir ejecutándose en Packet ` +
        `Tracer; se sigue sondeando hasta agotar el presupuesto.`,
      data: { deviceName, pendienteId, esperarMs },
    });
    return { done: false, cerrado: false, sinSoporte: false, payload: null };
  }
}

function vacio(deviceName: string): ResultadoCiclo {
  return {
    results: [],
    fuente: "sincrono",
    pendienteMs: 0,
    intentos: 0,
    timedOut: false,
    deviceName,
    deviceType: null,
    resumen: { total: 0, ok: 0, errors: 0 },
    reintentado: false,
    diagnostico: {},
  };
}

interface EstadoReintento {
  reintentado: boolean;
  motivoReintento?: string;
  comandoConsumido?: boolean;
  bloqueoResuelto?: string;
  bloqueoAgotado?: boolean;
}

function estadoReintentoDe(estado: EstadoReintento): Partial<ResultadoCiclo> {
  const salida: Partial<ResultadoCiclo> = { reintentado: estado.reintentado };
  if (estado.motivoReintento) salida.motivoReintento = estado.motivoReintento;
  if (estado.comandoConsumido) salida.comandoConsumido = true;
  if (estado.bloqueoResuelto) salida.bloqueoResuelto = estado.bloqueoResuelto;
  if (estado.bloqueoAgotado) salida.bloqueoAgotado = true;
  return salida;
}

function resultadoDeSalida(
  deviceName: string,
  payload: any,
  intentos: number,
  pendienteMs: number,
  deviceType: string | number | null,
  respaldo: string | undefined,
  estado: EstadoReintento,
): ResultadoCiclo {
  const filas = filasDe(payload);
  const bloqueo = bloqueoDe(payload);
  return {
    ...vacio(deviceName),
    results: filas,
    fuente: payload?.fuente === "commandEnded" ? "commandEnded" : "buffer",
    pendienteMs: numeroDe(payload?.pendienteMs) ?? pendienteMs,
    intentos,
    resumen: resumenDe(filas),
    deviceType,
    respaldo,

    diagnostico: diagnosticosDe(payload),
    ...estadoReintentoDe({
      ...estado,
      comandoConsumido: estado.comandoConsumido || bloqueo.consumido,
      bloqueoResuelto: estado.bloqueoResuelto ?? bloqueo.resuelto,
    }),
  };
}

async function respaldoSincrono(
  deviceName: string,
  commands: string[],
  options: Record<string, unknown>,
  opciones: OpcionesCiclo,
  motivo: string,
): Promise<ResultadoCiclo> {
  const bruto = desenvolver(
    await ciscoClient.callTool(
      "runDeviceCommands",
      { deviceName, commands, options },
      opciones.fallbackTimeoutMs
        ? { timeoutMs: opciones.fallbackTimeoutMs }
        : undefined,
    ),
  );

  const filas = filasDe(bruto);
  const salida: ResultadoCiclo = {
    ...vacio(deviceName),
    results: filas,
    fuente: "sincrono",
    resumen: resumenDePayload(bruto, filas),
    deviceType: tipoDeDispositivo(bruto),
    respaldo: motivo,
    diagnostico: diagnosticosDe(bruto),
  };

  if (bruto?.success === false || bruto?.error) {
    salida.fallo = String(bruto?.error ?? "runDeviceCommands falló en Packet Tracer.");
  }
  return salida;
}

async function respaldoConsola(
  deviceName: string,
  commands: string[],
  opciones: OpcionesCiclo,
  motivo: string,
  acumulado: Partial<ResultadoCiclo> = {},
): Promise<ResultadoCiclo> {
  const lineas = opciones.lineasConsola ?? LINEAS_CONSOLA_RESPALDO;
  const bruto = desenvolver(
    await ciscoClient.callTool(
      "readDeviceConsole",
      { deviceName, lines: lineas },
      opciones.pollTimeoutMs ? { timeoutMs: opciones.pollTimeoutMs } : undefined,
    ),
  );

  const texto = typeof bruto?.output === "string" ? bruto.output.trim() : "";
  const filas: FilaComando[] = texto
    ? [
        {
          command: commands.length ? commands.join(" ; ") : "(consola)",
          status: "unknown",
          output: texto,
        },
      ]
    : [];

  return {
    ...vacio(deviceName),
    ...acumulado,
    results: filas,
    fuente: "buffer",
    resumen: resumenDe(filas),
    respaldo: motivo,
    diagnostico: diagnosticosDe(bruto),
    fallo:
      filas.length === 0
        ? String(
            bruto?.error ??
              `Packet Tracer no devolvió salida para '${deviceName}' con el ciclo de evento (${motivo}).`,
          )
        : undefined,
  };
}

export async function ejecutarYEsperar(
  deviceName: string,
  commands: string[],
  opciones: OpcionesCiclo = {},
): Promise<ResultadoCiclo> {
  const pollMs = positivo(opciones.pollMs, POLL_MS_POR_DEFECTO);
  const budgetMs = positivo(opciones.budgetMs, BUDGET_MS_POR_DEFECTO);
  const options: Record<string, unknown> = opciones.mode ? { mode: opciones.mode } : {};

  const intentosPosibles =
    opciones.reintentable === true ? MAX_LANZAMIENTOS : 1;
  const presupuestoMs = presupuestoPorIntento(budgetMs, intentosPosibles);

  let intentosTotales = 0;

  const estado: EstadoReintento = { reintentado: false };
  let lanzamiento = 0;

  while (true) {
    const esReintento = lanzamiento > 0;
    lanzamiento += 1;

    const t0 = Date.now();

    const lanzado = desenvolver(
      await ciscoClient.callTool(
        "runCommandAsync",
        { deviceName, commands, options },
        opciones.timeoutMs ? { timeoutMs: opciones.timeoutMs } : undefined,
      ),
    );

    const pendienteId = textoDe(lanzado?.pendienteId);
    if (lanzado?.success === false || !pendienteId) {
      const motivo =
        lanzado?.success === false
          ? `runCommandAsync falló: ${String(lanzado?.error ?? "error sin detalle")}`
          : "la extensión no devolvió pendienteId (extensión antigua)";
      Logger.warning({
        message: `[Consola] Sin ciclo de evento para '${deviceName}' (${motivo}); se usa runDeviceCommands.`,
        data: { deviceName, commands: commands.length, esReintento },
      });
      if (!esReintento) {
        return respaldoSincrono(deviceName, commands, options, opciones, motivo);
      }

      return respaldoConsola(deviceName, commands, opciones, `reintento sin ciclo: ${motivo}`, {
        ...estadoReintentoDe(estado),
        intentos: intentosTotales,
      });
    }

    const pendiente = (): number =>
      Math.max(0, Date.now() - (numeroDe(lanzado?.t0) ?? t0));

    if (lanzado.eventoRegistrado === false) {
      const ronda = await sondear(
        pendienteId,
        deviceName,
        ESPERAR_SIN_EVENTO_MS,
        opciones,
      );
      intentosTotales += 1;
      if (ronda.done) {
        return resultadoDeSalida(
          deviceName,
          ronda.payload,
          intentosTotales,
          pendiente(),
          tipoDeDispositivo(lanzado),
          "eventoRegistrado=false",
          estado,
        );
      }
      Logger.warning({
        message:
          `[Consola] '${deviceName}' no registró el evento commandEnded; se vuelve ` +
          `a runDeviceCommands.`,
        data: { deviceName, pendienteId, esReintento },
      });
      if (!esReintento) {
        return respaldoSincrono(
          deviceName,
          commands,
          options,
          opciones,
          "eventoRegistrado=false",
        );
      }
      return respaldoConsola(deviceName, commands, opciones, "reintento sin evento commandEnded", {
        ...estadoReintentoDe(estado),
        intentos: intentosTotales,
      });
    }

    const limite = Date.now() + presupuestoMs;
    let intentos = 0;

    let reintentar = false;

    while (true) {
      const restante = limite - Date.now();
      if (restante <= 0) break;

      const intervalo = Math.min(intervaloDe(intentos + 1, pollMs), restante);
      const ronda = await sondear(
        pendienteId,
        deviceName,
        Math.min(intervalo, ESPERAR_MS_TECHO),
        opciones,
      );
      intentos += 1;
      intentosTotales += 1;

      if (ronda.done) {

        return resultadoDeSalida(
          deviceName,
          ronda.payload,
          intentosTotales,
          pendiente(),
          tipoDeDispositivo(lanzado),
          undefined,
          estado,
        );
      }

      if (ronda.sinSoporte) {
        if (esReintento) {
          return respaldoConsola(deviceName, commands, opciones, `reintento: pollCommandResult no disponible`, {
            ...estadoReintentoDe(estado),
            intentos: intentosTotales,
          });
        }
        return respaldoSincrono(
          deviceName,
          commands,
          options,
          opciones,
          `pollCommandResult no disponible: ${String(ronda.payload?.error ?? "")}`,
        );
      }

      if (ronda.cerrado) {
        const motivo = `pendiente cerrado: ${String(ronda.payload?.error ?? "desconocido")}`;
        Logger.warning({
          message: `[Consola] Pendiente '${pendienteId}' cerrado (${motivo}); se relee la consola de '${deviceName}'.`,
          data: { deviceName, pendienteId, esReintento },
        });
        return respaldoConsola(deviceName, commands, opciones, motivo, {
          ...estadoReintentoDe(estado),
          pendienteMs: pendiente(),
          intentos: intentosTotales,
        });
      }

      const bloqueo = bloqueoDe(ronda.payload);

      if (bloqueo.consumido) {
        Logger.warning({
          message:
            `[Consola] '${deviceName}': un prompt pendiente (${bloqueo.resuelto ?? "motivo desconocido"}) ` +
            `se ha comido el comando tecleado; NO llegó a ejecutarse.`,
          data: {
            deviceName,
            pendienteId,
            bloqueoResuelto: bloqueo.resuelto ?? null,
            intentos,
            esReintento,
          },
        });

        if (esReintento) {
          return comandoConsumidoSinRepetir(
            deviceName,
            commands,
            opciones,
            bloqueo,
            {
              ...estado,
              motivoReintento:
                `${estado.motivoReintento ?? "el prompt pendiente consumió el comando"}; ` +
                `el reintento volvió a ser consumido y no se insiste`,
            },
            intentosTotales,
          );
        }
        if (opciones.reintentable !== true) {
          return comandoConsumidoSinRepetir(
            deviceName,
            commands,
            opciones,
            bloqueo,
            {
              ...estado,
              reintentado: false,
              motivoReintento:
                `el prompt pendiente (${bloqueo.resuelto ?? "motivo desconocido"}) consumió el ` +
                `comando tecleado y NO se ha repetido porque ` +
                `${opciones.nombreTool ? `la tool '${opciones.nombreTool}'` : "la tool"} no admite reintento`,
            },
            intentosTotales,
          );
        }

        await limpiarPendiente(pendienteId, deviceName, opciones);
        estado.reintentado = true;

        estado.comandoConsumido = true;
        estado.bloqueoResuelto = estado.bloqueoResuelto ?? bloqueo.resuelto;
        estado.motivoReintento =
          `el prompt pendiente (${bloqueo.resuelto ?? "motivo desconocido"}) consumió el comando tecleado; ` +
          `se relanza el lote una vez`;
        reintentar = true;
        break;
      }

      if (bloqueo.agotado) {
        Logger.warning({
          message:
            `[Consola] '${deviceName}': el resolutor de la extensión agotó sus acciones ` +
            `y el prompt pendiente no se deja pagar; el comando no se espera más.`,
          data: { deviceName, pendienteId, intentos, esReintento },
        });
        const releida = await respaldoConsola(
          deviceName,
          commands,
          opciones,
          "bloqueoAgotado",
          {
            ...estadoReintentoDe({
              ...estado,
              comandoConsumido: true,
              bloqueoAgotado: true,
            }),
            pendienteMs: pendiente(),
            intentos: intentosTotales,
          },
        );
        return releida.results.length > 0
          ? releida
          : {
              ...releida,
              fallo:
                `La consola de '${deviceName}' tiene un prompt pendiente que Packet ` +
                `Tracer no deja pagar y el comando NO llegó a ejecutarse.`,
            };
      }

      if (Date.now() >= limite) break;
      await esperar(intervalo);
    }

    if (reintentar) continue;

    Logger.warning({
      message:
        `[Consola] '${deviceName}': el comando no terminó en ${presupuestoMs} ms ` +
        `por intento (${intentosTotales} sondeo(s)${esReintento ? ", ya reintentado" : ""}). ` +
        `Puede seguir ejecutándose en Packet Tracer.`,
      data: {
        deviceName,
        pendienteId,
        intentos: intentosTotales,
        budgetMs: presupuestoMs,
        presupuestoTotal: budgetMs,
        esReintento,
      },
    });
    const acumulado: Partial<ResultadoCiclo> = {
      ...estadoReintentoDe(estado),
      fuente: "commandEnded",
      pendienteMs: pendiente(),
      intentos: intentosTotales,
      timedOut: true,
    };

    const releida = await respaldoConsola(
      deviceName,
      commands,
      opciones,
      "presupuesto agotado",
      acumulado,
    );
    if (releida.results.length > 0) {
      return { ...releida, fallo: undefined };
    }
    return {
      ...vacio(deviceName),
      ...acumulado,
      results: [],
      resumen: { total: 0, ok: 0, errors: 0 },
      respaldo: "presupuesto agotado",
      fallo:
        `El comando no terminó dentro del presupuesto de ${presupuestoMs} ms ` +
        `por intento y la consola de '${deviceName}' estaba vacía. En Packet ` +
        `Tracer puede seguir ejecutándose: NO lo repitas, espera y vuelve a leer ` +
        `la consola del equipo.`,
    };
  }
}

async function comandoConsumidoSinRepetir(
  deviceName: string,
  commands: string[],
  opciones: OpcionesCiclo,
  bloqueo: BloqueoConsola,
  estado: EstadoReintento,
  intentos: number,
): Promise<ResultadoCiclo> {
  const tool = opciones.nombreTool ? `'${opciones.nombreTool}'` : "la tool";
  Logger.warning({
    message:
      `[Consola] '${deviceName}': el comando se consumió como respuesta a un prompt ` +
      `pendiente y NO se reintenta más. ${estado.motivoReintento ?? ""}`,
    data: { deviceName, intentos, bloqueoResuelto: bloqueo.resuelto ?? null },
  });

  const releida = await respaldoConsola(
    deviceName,
    commands,
    opciones,
    "comando consumido por un prompt pendiente",
    {
      ...estadoReintentoDe({
        ...estado,
        comandoConsumido: true,
        bloqueoResuelto: bloqueo.resuelto,
      }),
      intentos,
    },
  );

  return {
    ...releida,
    fallo:
      releida.results.length > 0
        ? releida.fallo
        : `El comando se consumió como respuesta a un prompt pendiente de ` +
          `'${deviceName}' (${bloqueo.resuelto ?? "motivo desconocido"}) y NO se ha ` +
          `repetido: no llegó a ejecutarse. Revisa la consola del equipo antes de ` +
          `volver a lanzarlo desde ${tool}.`,
  };
}

export async function limpiarPendiente(
  pendienteId: string,
  deviceName?: string,
  opciones: OpcionesCiclo = {},
): Promise<boolean> {
  try {
    const bruto = desenvolver(
      await ciscoClient.callTool(
        "pollCommandResult",
        {
          pendienteId,
          ...(deviceName ? { deviceName } : {}),
          options: { esperarMs: 0 },
        },
        opciones.pollTimeoutMs
          ? { timeoutMs: opciones.pollTimeoutMs }
          : undefined,
      ),
    );
    return bruto?.success === true;
  } catch (error) {
    Logger.warning({
      message: `[Consola] No se pudo limpiar el pendiente '${pendienteId}': ${mensajeDe(error)}`,
      data: { deviceName, pendienteId },
    });
    return false;
  }
}
