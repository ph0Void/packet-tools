

import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMEOUT_POR_HERRAMIENTA, ciscoClient } from "@/client/PacketTracerClient";
import {
  ESTADO_REINTENTAR,
  MAX_LANZAMIENTOS,
  type ResultadoCiclo,
  bloqueoDe,
  ejecutarYEsperar,
  presupuestoPorIntento,
} from "@/client/PacketTracerConsola";
import {
  CISCO_PACKET_TRACER_TOOLS_ADMIN,
  budgetDeRunDeviceCommand,
  payloadDeRunDeviceCommand,
} from "@/agent/ciscoPacketTracer/Tool";





interface Call {
  tool: string;
  input: any;
  opciones: any;
}

type Script = any[] | ((input: any, invocacion: number) => any);

interface BridgeFake {
  modelcalls: Call[];
  de(tool: string): Call[];
}

function bridge(scripts: Record<string, Script>): BridgeFake {
  const modelcalls: Call[] = [];
  vi.spyOn(ciscoClient, "callTool").mockImplementation(
    async (tool: string, input: any, opciones?: any) => {
      const invocacion = modelcalls.filter(
        (call) => call.tool === tool,
      ).length;
      modelcalls.push({ tool, input, opciones });
      const script = scripts[tool];
      if (!script) throw new Error(`Llamada inesperada a '${tool}'`);
      if (typeof script === "function") return script(input, invocacion);
      if (invocacion < script.length) return script[invocacion];
      return script[script.length - 1];
    },
  );
  return {
    modelcalls,
    de: (tool) =>
      modelcalls.filter((call) => call.tool === tool),
  };
}


function lanzamiento(id = "p-1"): any {
  return {
    success: true,
    pendingId: id,
    deviceName: "R1",
    commands: ["show ip int brief"],
    mode: "enable",
    eventRecorded: true,
    t0: Date.now(),
  };
}


function enCurso(pendingMs = 200, extra: Record<string, unknown> = {}): any {
  return {
    success: true,
    pendingId: "p-1",
    done: false,
    status: "en_curso",
    pendingMs,
    eventRecorded: true,
    ...extra,
  };
}


function terminado(results: any[], extra: Record<string, unknown> = {}): any {
  return {
    success: true,
    pendingId: "p-1",
    done: true,
    status: "terminado",
    fuente: "commandEnded",
    pendingMs: 412,
    results,
    ...extra,
  };
}


function reintentar(
  blockResolved = "enter",
  pendingMs = 300,
  extra: Record<string, unknown> = {},
): any {
  return {
    success: true,
    pendingId: "p-1",
    done: false,
    status: ESTADO_REINTENTAR,
    commandConsumido: true,
    blockResolved,
    pendingMs,
    eventRecorded: true,
    ...extra,
  };
}

const ROWS = [{ command: "show ip int brief", status: "ok", output: "Gi0/0 up" }];


const ROWS_SECOND = [
  { command: "show ip int brief", status: "ok", output: "Gi0/0 up (2º intento)" },
];

afterEach(() => {
  vi.restoreAllMocks();
});





describe("ejecutarYEsperar: reintento tras prompt pendiente", () => {
  it("con reintentable:true relanza runCommandAsync UNA vez y devuelve la 2ª ronda", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento("p-1"), lanzamiento("p-2")],
      pollCommandResult: [
        
        reintentar("enter"),
        
        terminado(ROWS_SECOND),
      ],
      readDeviceConsole: [],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 1_000,
      reintentable: true,
      nameTool: "runDeviceCommand",
    });

    
    const lanzamientos = bridgeFake.de("runCommandAsync");
    expect(lanzamientos).toHaveLength(2);
    expect(lanzamientos[1].input.commands).toEqual(["show ip int brief"]);
    expect(lanzamientos[1].input.deviceName).toBe("R1");

    
    expect(cycle.results).toEqual(ROWS_SECOND);
    expect(cycle.fuente).toBe("commandEnded");
    expect(cycle.reintentado).toBe(true);
    expect(cycle.motivoReintento).toContain("enter");
    expect(cycle.bloqueoResuelto).toBe("enter");
    expect(cycle.timedOut).toBe(false);

    
    
    const sondeos = bridgeFake.de("pollCommandResult");
    expect(sondeos[0].input.pendienteId).toBe("p-1");
    expect(sondeos[1].input.options.waitMs).toBe(0);
    expect(sondeos[2].input.pendienteId).toBe("p-2");
    
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
  });

  it("sin reintentable (por defecto) NO relanza y avisa de que NO se ha repetido", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [reintentar("enter")],
      
      readDeviceConsole: [
        {
          success: true,
          deviceName: "R1",
          output: "R1 con0/0 is administratively down\nPress RETURN to get started!",
        },
      ],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 5_000,
      nameTool: "runDeviceCommand",
    });

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(1);
    expect(cycle.reintentado).toBe(false);
    expect(cycle.comandoConsumido).toBe(true);
    expect(cycle.bloqueoResuelto).toBe("enter");
    expect(cycle.motivoReintento).toContain("NO se ha repetido");
    expect(cycle.motivoReintento).toContain("runDeviceCommand");
    
    
    expect(cycle.timedOut).toBe(false);
    
    expect(cycle.results).toHaveLength(1);
    expect(cycle.results[0].status).toBe("unknown");
    expect(cycle.results[0].output).toContain("Press RETURN");
  });

  it("sin fila recuperable, el fallo dice que no llegó a ejecutarse y que no se repitió", async () => {
    bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [reintentar("dialogo")],
      readDeviceConsole: [{ success: true, deviceName: "R1", output: "   " }],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 5_000,
      nameTool: "runDeviceCommand",
    });

    expect(cycle.results).toEqual([]);
    expect(cycle.fallo).toContain("NO se ha repetido");
    expect(cycle.fallo).toContain("R1");
    expect(cycle.fallo).toContain("dialogo");
  });

  it("consumido dos veces (también en el reintento): como mucho 2 lanzamientos", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento("p-1"), lanzamiento("p-2")],
      pollCommandResult: [
        reintentar("enter"),
        
        { success: true, pendingId: "p-1", done: false, status: "cerrado" },
        reintentar("enter"),
      ],
      readDeviceConsole: [{ success: true, deviceName: "R1", output: "Press RETURN" }],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 4_000,
      reintentable: true,
      nameTool: "runDeviceCommand",
    });

    
    
    expect(bridgeFake.de("runCommandAsync")).toHaveLength(2);
    expect(bridgeFake.de("runCommandAsync")).toHaveLength(MAX_LANZAMIENTOS);
    
    expect(cycle.reintentado).toBe(true);
    expect(cycle.motivoReintento).toContain("volvió a ser consumido");
    expect(cycle.comandoConsumido).toBe(true);
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
  });

  it("comandoConsumido:true en un done se marca pero NO se reintenta", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      
      pollCommandResult: [terminado(ROWS, { commandConsumido: true })],
      readDeviceConsole: [],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 5_000,
      reintentable: true,
    });

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(1);
    expect(cycle.reintentado).toBe(false);
    expect(cycle.comandoConsumido).toBe(true);
    
    expect(cycle.results).toEqual(ROWS);
    expect(cycle.resumen).toEqual({ total: 1, ok: 1, errors: 0 });
  });

  it("bloqueoAgotado:true sale al instante y lo refleja en el payload", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [
        enCurso(200, { blockAgotado: true, blockResolved: "dialogo" }),
      ],
      readDeviceConsole: [
        { success: true, deviceName: "R1", output: "% Invalid input detected" },
      ],
    });

    const start = Date.now();
    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 30_000,
      pollMs: 1_000,
      reintentable: true,
      nameTool: "runDeviceCommand",
    });
    const duracion = Date.now() - start;

    
    
    expect(duracion).toBeLessThan(2_000);
    expect(bridgeFake.de("pollCommandResult")).toHaveLength(1);
    
    expect(bridgeFake.de("runCommandAsync")).toHaveLength(1);
    expect(cycle.bloqueoAgotado).toBe(true);
    expect(cycle.reintentado).toBe(false);
    expect(cycle.comandoConsumido).toBe(true);

    const payload = payloadDeRunDeviceCommand(cycle);
    expect(payload.bloqueoAgotado).toBe(true);
    expect(payload.reintentado).toBe(false);
    expect(payload.aviso).toContain("no deja pagar");
    expect(payload.aviso).toContain("readDeviceConsole");
  });

  it("el estado 'reintentar' basta aunque no venga comandoConsumido", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento("p-1"), lanzamiento("p-2")],
      pollCommandResult: [
        {
          success: true,
          done: false,
          status: ESTADO_REINTENTAR,
          blockResolved: "espacio",
        },
        terminado(ROWS_SECOND),
      ],
      readDeviceConsole: [],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 1_000,
      reintentable: true,
    });

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(2);
    expect(cycle.results).toEqual(ROWS_SECOND);
    expect(cycle.bloqueoResuelto).toBe("espacio");
  });
});





describe("bloqueoDe(): normaliza la señal del contrato", () => {
  it("lee estado, bloqueoResuelto y bloqueoAgotado", () => {
    expect(bloqueoDe(reintentar("dialogo"))).toEqual({
      consumido: true,
      resolved: "dialogo",
      agotado: false,
    });
    expect(bloqueoDe(enCurso(100, { blockAgotado: true }))).toEqual({
      consumido: false,
      resolved: undefined,
      agotado: true,
    });
    expect(bloqueoDe(enCurso())).toEqual({
      consumido: false,
      resolved: undefined,
      agotado: false,
    });
    
    expect(bloqueoDe(null).consumido).toBe(false);
    expect(bloqueoDe({}).agotado).toBe(false);
  });
});

describe("presupuestoPorIntento(): el reintento no engorda el ciclo", () => {
  it("reparte el total entre los intentos posibles", () => {
    expect(presupuestoPorIntento(55_000, 1)).toBe(55_000);
    expect(presupuestoPorIntento(55_000, 2)).toBe(27_500);
    expect(presupuestoPorIntento(110_000, 2)).toBe(55_000);
    
    expect(presupuestoPorIntento(0, 2)).toBe(12_500);
    expect(presupuestoPorIntento(55_000, 0)).toBe(55_000);
  });

  it("el peor caso cabe en el timeout de la tool en los dos casos de lote", () => {
    
    const timeoutShort = TIMEOUT_POR_HERRAMIENTA.runDeviceCommands;
    const short = budgetDeRunDeviceCommand(3);
    expect(short).toBeLessThanOrEqual(timeoutShort);
    const peorShort = presupuestoPorIntento(short, MAX_LANZAMIENTOS) * MAX_LANZAMIENTOS;
    expect(peorShort).toBeLessThanOrEqual(timeoutShort);
    expect(peorShort).toBe(short);

    
    const timeoutLong = 120_000;
    const long = budgetDeRunDeviceCommand(4);
    expect(long).toBeGreaterThan(short);
    const peorLong = presupuestoPorIntento(long, MAX_LANZAMIENTOS) * MAX_LANZAMIENTOS;
    expect(peorLong).toBeLessThanOrEqual(timeoutLong);
    expect(peorLong).toBe(long);

    
    expect(presupuestoPorIntento(55_000, 2) * 2).toBe(55_000);
    expect(presupuestoPorIntento(110_000, 2) * 2).toBe(110_000);
    
    expect(TIMEOUT_POR_HERRAMIENTA.pollCommandResult).toBeGreaterThan(500);
  });
});





interface InvokableTool {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<unknown>;
}

function toolByName(name: string): InvokableTool {
  const encontrada = CISCO_PACKET_TRACER_TOOLS_ADMIN.find(
    (candidate) => candidate.name === name,
  );
  if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
  return encontrada as unknown as InvokableTool;
}

async function invocarRunDeviceCommand(
  deviceName: string,
  command: string,
): Promise<any> {
  const output = await toolByName("runDeviceCommand").invoke({
    deviceName,
    command,
  });
  return typeof output === "string" ? JSON.parse(output) : output;
}

describe("runDeviceCommand: reintento por prompt pendiente", () => {
  it("lee el reintento porque la lista blanca garantiza que no muta nada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento("p-1"), lanzamiento("p-2")],
      pollCommandResult: [reintentar("enter"), terminado(ROWS_SECOND)],
      readDeviceConsole: [],
    });

    const output = await invocarRunDeviceCommand("R1", "show ip int brief");

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(2);

    expect(bridgeFake.de("runCommandAsync")[1].input.commands).toEqual([
      "show ip int brief",
    ]);


    expect(output.success).toBe(true);
    expect(output.deviceName).toBe("R1");
    expect("deviceType" in output).toBe(true);
    expect(output.results).toEqual(ROWS_SECOND);
    expect(output.summary).toEqual({ total: 1, ok: 1, errors: 0 });
    expect(output.fuente).toBe("commandEnded");
    expect(output.timedOut).toBe(false);

    expect(output.reintentado).toBe(true);
    expect(output.comandoConsumido).toBe(true);
    expect(output.bloqueoResuelto).toBe("enter");
    expect(output.aviso).toBeUndefined();
  });

  it("si el reintento vuelve a caer en el prompt, el aviso dice que no se insiste", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento("p-1"), lanzamiento("p-2")],
      pollCommandResult: [
        reintentar("enter"),
        { success: true, pendingId: "p-1", done: false, status: "cerrado" },
        reintentar("enter"),
      ],
      readDeviceConsole: [
        { success: true, deviceName: "R1", output: "Press RETURN to get started!" },
      ],
    });

    const output = await invocarRunDeviceCommand("R1", "show ip int brief");

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(2);
    expect(output.reintentado).toBe(true);
    expect(output.comandoConsumido).toBe(true);
    expect(output.aviso).toContain("no se insiste más");

    expect(output.results[0].status).toBe("unknown");
    expect(output.results[0].output).toContain("Press RETURN");
    expect(output.motivoReintento).toContain("volvió a ser consumido");
  });

  it("una tool de escritura no pide reintento por ninguna vía", async () => {

    const bridgeFake = bridge({
      getDeviceInfo: [
        {
          success: true,
          result: {
            device: {
              name: "R1",
              model: "2911",

              type: 0,
              interfaces: [{ name: "GigabitEthernet0/0", in_use: true, ipAddress: "192.168.1.1" }],
            },
            connections: [],
          },
        },
      ],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [reintentar("enter")],
      readDeviceConsole: [
        { success: true, deviceName: "R1", output: "Press RETURN to get started!" },
      ],
      getDeviceConfigSnapshot: [
        { success: true, deviceName: "R1", runningConfig: "hostname R1", config: "hostname R1" },
      ],
    });

    const output = await toolByName("configureIosDevice").invoke({
      deviceName: "R1",
      commands: "hostname R1",
    });


    expect(bridgeFake.de("runCommandAsync")).toHaveLength(1);

    expect(bridgeFake.de("configureIosDevice")).toHaveLength(0);

    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
    expect(typeof output).toBe("string");
  });
});



describe("payloadDeRunDeviceCommand con bloqueo", () => {
  const base: ResultadoCiclo = {
    results: [],
    fuente: "buffer",
    pendingMs: 900,
    intentos: 2,
    timedOut: false,
    deviceName: "R1",
    deviceType: 9,
    summary: { total: 0, ok: 0, errors: 0 },
    reintentado: false,
    diagnostico: {},
  };

  it("consumido sin reintento: success:false y aviso explícito", () => {
    const payload = payloadDeRunDeviceCommand({
      ...base,
      failure: "El comando se consumió como respuesta a un prompt pendiente de 'R1' (enter) y NO se ha repetido.",
      commandConsumido: true,
      blockResolved: "enter",
      reasonRetry:
        "el prompt pendiente (enter) consumió el comando tecleado y NO se ha repetido porque la tool 'runDeviceCommand' no admite reintento",
    });

    expect(payload.success).toBe(false);
    expect(payload.reintentado).toBe(false);
    expect(payload.comandoConsumido).toBe(true);
    expect(payload.bloqueoResuelto).toBe("enter");
    expect(payload.motivoReintento).toContain("NO se ha repetido");
    expect(payload.aviso).toContain("NO se ha repetido");

    expect(payload.aviso).not.toContain("presupuesto");
  });

  it("con reintento y salida, no hay aviso ni error", () => {
    const payload = payloadDeRunDeviceCommand({
      ...base,
      results: ROWS,
      summary: { total: 1, ok: 1, errors: 0 },
      fuente: "commandEnded",
      reintentado: true,
      commandConsumido: true,
      blockResolved: "enter",
      reasonRetry: "el prompt pendiente (enter) consumió el comando; se relanza el lote una vez",
    });

    expect(payload.success).toBe(true);
    expect(payload.reintentado).toBe(true);
    expect(payload.aviso).toBeUndefined();
    expect(payload.error).toBeUndefined();
  });
});
