

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAVE_GLOBAL,
  TIMEOUT_POR_HERRAMIENTA,
  ciscoClient,
  dispositivoDe,
} from "@/client/PacketTracerClient";
import {
  POLL_MS_POR_DEFECTO,
  type ResultadoCiclo,
  ejecutarYEsperar,
  intervaloDe,
  limpiarPendiente,
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
    de: (tool) => modelcalls.filter((l) => l.tool === tool),
  };
}


function lanzamiento(extra: Record<string, unknown> = {}): any {
  return {
    success: true,
    pendingId: "p-1",
    deviceName: "R1",
    commands: ["show clock"],
    mode: "enable",
    eventRecorded: true,
    t0: Date.now(),
    ...extra,
  };
}


function enCurso(pendingMs = 200): any {
  return {
    success: true,
    pendingId: "p-1",
    done: false,
    status: "en_curso",
    pendingMs,
    eventRecorded: true,
  };
}


function terminado(results: any[], fuente = "commandEnded"): any {
  return {
    success: true,
    pendingId: "p-1",
    done: true,
    status: "terminado",
    fuente,
    pendingMs: 412,
    results,
  };
}


const ROWS = [
  { command: "show ip int brief", status: "ok", output: "Gi0/0 up" },
];

afterEach(() => {
  vi.restoreAllMocks();
});





describe("ejecutarYEsperar: camino con evento commandEnded", () => {
  it("lanza, sondea una vez y devuelve la salida del evento", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [terminado(ROWS)],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 1_000,
    });

    expect(cycle.fuente).toBe("commandEnded");
    expect(cycle.results).toEqual(ROWS);
    expect(cycle.resumen).toEqual({ total: 1, ok: 1, errors: 0 });
    expect(cycle.intentos).toBe(1);
    expect(cycle.timedOut).toBe(false);
    
    expect(cycle.pendienteMs).toBe(412);
    expect(cycle.deviceName).toBe("R1");
    expect(cycle.fallo).toBeUndefined();

    
    
    const sondeo = bridgeFake.de("pollCommandResult")[0];
    expect(sondeo.input.pendienteId).toBe("p-1");
    expect(sondeo.input.deviceName).toBe("R1");
    expect(sondeo.input.options.waitMs).toBeGreaterThan(0);
    expect(sondeo.input.options.waitMs).toBeLessThanOrEqual(500);
  });

  it("insiste hasta que el evento salta y cuenta los intentos", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [
        enCurso(200),
        enCurso(600),
        terminado(
          [
            { command: "show clock", status: "ok", output: "12:00:00" },
            { command: "show vlan brief", status: "ok", output: "1 vlan" },
          ],
          "commandEnded",
        ),
      ],
    });

    const cycle = await ejecutarYEsperar(
      "R1",
      ["show clock", "show vlan brief"],
      { budgetMs: 2_000, pollMs: 1 },
    );

    expect(cycle.intentos).toBe(3);
    expect(bridgeFake.de("pollCommandResult")).toHaveLength(3);
    expect(cycle.fuente).toBe("commandEnded");
    expect(cycle.results).toHaveLength(2);
    expect(cycle.resumen).toEqual({ total: 2, ok: 2, errors: 0 });
    expect(cycle.timedOut).toBe(false);
  });

  it("acepta una salida que la extensión cortó desde el buffer (fuente:buffer)", async () => {
    bridge({
      runCommandAsync: [lanzamiento()],
      
      pollCommandResult: [terminado(ROWS, "buffer")],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 1_000,
    });

    expect(cycle.fuente).toBe("buffer");
    expect(cycle.results).toEqual(ROWS);
  });

  it("un fallo de socket en una ronda no corta el ciclo: sigue hasta el evento", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: (input, invocacion) => {
        if (invocacion === 0) throw new Error("Timeout de 25s esperando a Packet Tracer");
        return terminado(ROWS);
      },
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 2_000,
      pollMs: 1,
    });

    
    expect(cycle.fuente).toBe("commandEnded");
    expect(cycle.intentos).toBe(2);
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
  });
});





describe("ejecutarYEsperar: respaldo al camino de siempre", () => {
  it("si runCommandAsync falla se llama a runDeviceCommands (fuente:síncrono)", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [
        { success: false, error: "herramienta no compatible: runCommandAsync" },
      ],
      runDeviceCommands: [
        {
          success: true,
          deviceName: "R1",
          deviceType: 9,
          results: ROWS,
          summary: { total: 1, ok: 1, errors: 0 },
        },
      ],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"]);

    expect(cycle.fuente).toBe("sincrono");
    expect(cycle.results).toEqual(ROWS);
    expect(cycle.deviceType).toBe(9);
    expect(cycle.respaldo).toContain("runCommandAsync");
    expect(cycle.intentos).toBe(0);

    
    const respaldo = bridgeFake.de("runDeviceCommands")[0];
    expect(respaldo.input.deviceName).toBe("R1");
    expect(respaldo.input.commands).toEqual(["show ip int brief"]);
    expect(respaldo.input.options).toEqual({});
    expect(bridgeFake.de("pollCommandResult")).toHaveLength(0);
  });

  it("si la respuesta no trae pendienteId (extensión antigua) va al respaldo", async () => {
    const bridgeFake = bridge({
      
      runCommandAsync: [{ success: true, deviceName: "R1" }],
      runDeviceCommands: [
        {
          success: true,
          deviceName: "R1",
          results: ROWS,
          summary: { total: 1, ok: 1, errors: 0 },
        },
      ],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"]);

    expect(cycle.fuente).toBe("sincrono");
    expect(cycle.respaldo).toContain("pendienteId");
    expect(bridgeFake.de("pollCommandResult")).toHaveLength(0);
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(1);
  });

  it("eventoRegistrado:false hace UN solo sondeo y luego el respaldo", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento({ eventRecorded: false })],
      pollCommandResult: [enCurso(300)],
      runDeviceCommands: [
        {
          success: true,
          deviceName: "R1",
          results: ROWS,
          summary: { total: 1, ok: 1, errors: 0 },
        },
      ],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 5_000,
    });

    
    
    expect(bridgeFake.de("pollCommandResult")).toHaveLength(1);
    expect(bridgeFake.de("pollCommandResult")[0].input.options.waitMs).toBe(300);
    expect(cycle.fuente).toBe("sincrono");
    expect(cycle.respaldo).toBe("eventoRegistrado=false");
    expect(cycle.results).toEqual(ROWS);
  });

  it("eventoRegistrado:false que sí terminó en esa ronda NO toca el respaldo", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento({ eventRecorded: false })],
      pollCommandResult: [terminado(ROWS)],
      runDeviceCommands: [],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"]);

    expect(cycle.fuente).toBe("commandEnded");
    expect(cycle.intentos).toBe(1);
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
  });

  it("una extensión sin pollCommandResult vuelve al camino de siempre", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [
        { success: false, error: "herramienta no compatible: pollCommandResult" },
      ],
      runDeviceCommands: [
        {
          success: true,
          deviceName: "R1",
          results: ROWS,
          summary: { total: 1, ok: 1, errors: 0 },
        },
      ],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"]);

    expect(cycle.fuente).toBe("sincrono");
    expect(cycle.respaldo).toContain("pollCommandResult no disponible");
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(1);
  });

  it("propaga el error del respaldo para que el agente vea el fallo de siempre", async () => {
    bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [{ success: false, error: "pendiente desconocido: p-1" }],
      readDeviceConsole: [{ success: true, deviceName: "R1", output: "" }],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"]);

    expect(cycle.results).toEqual([]);
    expect(cycle.fallo).toBeTruthy();
  });
});





describe("ejecutarYEsperar: presupuesto agotado", () => {
  it("devuelve timedOut:true y NO vuelve a ejecutar el comando", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      
      pollCommandResult: [enCurso(50)],
      readDeviceConsole: [{ success: true, deviceName: "R1", output: "" }],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 40,
      pollMs: 5,
    });

    expect(cycle.timedOut).toBe(true);
    expect(cycle.intentos).toBeGreaterThanOrEqual(2);
    
    
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
    
    expect(cycle.results).toEqual([]);
    expect(cycle.fallo).toContain("NO lo repitas");
    
    expect(bridgeFake.de("readDeviceConsole")).toHaveLength(1);
  });

  it("si la consola ya tiene algo escrito, lo devuelve sin re-ejecutar", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [enCurso(50)],
      readDeviceConsole: [
        {
          success: true,
          deviceName: "R1",
          output: "show ip int brief\nGigabitEthernet0/0 is up",
        },
      ],
    });

    const cycle = await ejecutarYEsperar("R1", ["show ip int brief"], {
      budgetMs: 30,
      pollMs: 5,
    });

    expect(cycle.timedOut).toBe(true);
    expect(cycle.fuente).toBe("buffer");
    
    expect(cycle.results).toHaveLength(1);
    expect(cycle.results[0].status).toBe("unknown");
    expect(cycle.results[0].output).toContain("GigabitEthernet0/0 is up");
    expect(cycle.fallo).toBeUndefined();
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
  });
});

describe("ejecutarYEsperar: pendiente ya cerrado", () => {
  it("relee la consola una vez y no vuelve a ejecutar", async () => {
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [
        { success: false, error: "pendiente desconocido o ya cerrado: p-1" },
      ],
      readDeviceConsole: [
        { success: true, deviceName: "R1", output: "R1#show clock\n12:00:00" },
      ],
      runDeviceCommands: [],
    });

    const cycle = await ejecutarYEsperar("R1", ["show clock"], {
      budgetMs: 2_000,
    });

    expect(bridgeFake.de("pollCommandResult")).toHaveLength(1);
    expect(bridgeFake.de("readDeviceConsole")).toHaveLength(1);
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
    expect(cycle.fuente).toBe("buffer");
    expect(cycle.respaldo).toContain("pendiente cerrado");
    expect(cycle.results[0].output).toContain("12:00:00");
  });

  it("si la relectura tampoco trae nada, lo dice sin inventarse salida", async () => {
    bridge({
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [{ success: false, error: "pendiente desconocido: p-1" }],
      readDeviceConsole: [{ success: true, deviceName: "R1", output: "   \n  " }],
    });

    const cycle = await ejecutarYEsperar("R1", ["show clock"], {
      budgetMs: 2_000,
    });

    expect(cycle.results).toEqual([]);
    expect(cycle.fallo).toBeTruthy();
  });
});





describe("limpiarPendiente", () => {
  it("fuerza el cierre con una sola llamada de espera 0", async () => {
    const bridgeFake = bridge({
      pollCommandResult: [{ success: true, pendingId: "p-9", done: true }],
    });

    await expect(limpiarPendiente("p-9", "R1")).resolves.toBe(true);

    const modelcalls = bridgeFake.de("pollCommandResult");
    expect(modelcalls).toHaveLength(1);
    expect(modelcalls[0].input).toEqual({
      pendingId: "p-9",
      deviceName: "R1",
      options: { waitMs: 0 },
    });
  });

  it("es best effort: si el puente no responde, no lanza", async () => {
    bridge({ pollCommandResult: [() => { throw new Error("sin socket"); }] });
    await expect(limpiarPendiente("p-9", "R1")).resolves.toBe(false);
  });
});

describe("intervaloDe(): escalera de sondeo", () => {
  it("empieza en pollMs y se dobla hasta el techo", () => {
    expect(intervaloDe(1, 250)).toBe(250);
    expect(intervaloDe(8, 250)).toBe(250);
    expect(intervaloDe(9, 250)).toBe(500);
    expect(intervaloDe(40, 250)).toBe(1_000);
    
    expect(intervaloDe(3, 5_000)).toBe(1_000);
    
    expect(intervaloDe(1, 0)).toBe(POLL_MS_POR_DEFECTO);
  });
});





describe("serialización del sondeo", () => {
  it("el sondeo se serializa por EQUIPO, no de forma exclusiva", () => {
    
    
    expect(
      dispositivoDe("pollCommandResult", {
        pendingId: "p-1",
        deviceName: "R1",
        options: { waitMs: 250 },
      }),
    ).toBe("dispositivo:r1");
    
    
    expect(
      dispositivoDe("pollCommandResult", { pendingId: "p-1" }),
    ).not.toBe(CLAVE_GLOBAL);
    
    expect(
      dispositivoDe("runCommandAsync", {
        deviceName: "R1",
        commands: ["show clock"],
        options: {},
      }),
    ).toBe("dispositivo:r1");
  });

  it("las dos herramientas del ciclo tienen timeout propio en la tabla", () => {
    expect(timeoutOfTool("runCommandAsync")).toBe(30_000);
    expect(timeoutOfTool("pollCommandResult")).toBe(25_000);
    
    
    expect(timeoutOfTool("pollCommandResult")).toBeLessThanOrEqual(
      timeoutOfTool("runDeviceCommands"),
    );
  });
});


function timeoutOfTool(tool: string): number {
  return TIMEOUT_POR_HERRAMIENTA[tool] ?? 0;
}





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

describe("runDeviceCommand con el ciclo de evento", () => {
  it("mantiene la forma de payload de siempre y añade los campos aditivos", async () => {

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      runCommandAsync: [lanzamiento({ deviceName: "R1" })],
      pollCommandResult: [
        terminado([
          { command: "show clock", status: "ok", output: "12:00:00" },
        ]),
      ],
      runDeviceCommands: [],
    });

    const output = await invocarRunDeviceCommand("R1", "show clock");


    expect(output.success).toBe(true);
    expect(output.deviceName).toBe("R1");
    expect("deviceType" in output).toBe(true);
    expect(Array.isArray(output.results)).toBe(true);
    expect(output.results[0]).toEqual({
      command: "show clock",
      status: "ok",
      output: "12:00:00",
    });
    expect(output.summary).toEqual({ total: 1, ok: 1, errors: 0 });


    expect(output.fuente).toBe("commandEnded");
    expect(output.pendienteMs).toBe(412);
    expect(output.intentos).toBe(1);
    expect(output.timedOut).toBe(false);

    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);
  });

  it("con el respaldo reproduce el payload de runDeviceCommands", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    bridge({
      runCommandAsync: [{ success: false, error: "herramienta no compatible" }],
      runDeviceCommands: [
        {
          success: true,
          deviceName: "R1",
          deviceType: 9,
          results: [{ command: "show clock", status: "ok", output: "12:00:00" }],
          summary: { total: 1, ok: 1, errors: 0 },
        },
      ],
    });

    const output = await invocarRunDeviceCommand("R1", "show clock");

    expect(output.success).toBe(true);
    expect(output.deviceName).toBe("R1");

    expect(output.deviceType).toBe(9);
    expect(output.results[0].output).toBe("12:00:00");
    expect(output.summary).toEqual({ total: 1, ok: 1, errors: 0 });
    expect(output.fuente).toBe("sincrono");
  });

  it("rechaza un comando de escritura sin tocar el puente", async () => {
    const bridgeFake = bridge({});

    const output = await invocarRunDeviceCommand("R1", "configure terminal");

    expect(output.success).toBe(false);
    expect(output.error).toContain("configureIosDevice");
    expect(bridgeFake.modelcalls).toHaveLength(0);
  });

  it("el lote largo conserva el timeout de 120 s del camino de respaldo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      runCommandAsync: [{ success: false, error: "sin ciclo de evento" }],
      runDeviceCommands: [{ success: true, deviceName: "R1", results: [] }],
    });

    await invocarRunDeviceCommand(
      "R1",
      "show clock\nshow version\nshow vlan brief\nshow ip int brief",
    );

    expect(bridgeFake.de("runDeviceCommands")[0].opciones).toEqual({
      timeoutMs: 120_000,
    });
  });
});

describe("payloadDeRunDeviceCommand", () => {
  const base: ResultadoCiclo = {
    results: [{ command: "show clock", status: "ok", output: "12:00:00" }],
    fuente: "commandEnded",
    pendingMs: 412,
    intentos: 1,
    timedOut: false,
    deviceName: "R1",
    deviceType: null,
    summary: { total: 1, ok: 1, errors: 0 },
    reintentado: false,
    diagnostico: { warning: "console_output_unavailable" },
  };

  it("conserva el diagnóstico de la extensión y añade los campos nuevos", () => {
    const payload = payloadDeRunDeviceCommand(base);

    expect(payload.warning).toBe("console_output_unavailable");
    expect(payload.success).toBe(true);
    expect(payload.fuente).toBe("commandEnded");
    expect(payload.aviso).toBeUndefined();
  });

  it("sin filas y con fallo devuelve success:false + error", () => {
    const payload = payloadDeRunDeviceCommand({
      ...base,
      results: [],
      summary: { total: 0, ok: 0, errors: 0 },
      failure: "Device R1 not found",
    });

    expect(payload.success).toBe(false);
    expect(payload.error).toBe("Device R1 not found");

    expect(payload.fuente).toBe("commandEnded");
  });

  it("presupuesto agotado: avisa de que NO se repita el comando", () => {
    const withOutput = payloadDeRunDeviceCommand({
      ...base,
      timedOut: true,
      pendingMs: 55_000,
      intentos: 40,
    });
    expect(withOutput.success).toBe(true);
    expect(withOutput.timedOut).toBe(true);
    expect(withOutput.aviso).toContain("NO repitas");

    const withoutOutput = payloadDeRunDeviceCommand({
      ...base,
      results: [],
      summary: { total: 0, ok: 0, errors: 0 },
      timedOut: true,
      failure: "el comando no terminó",
    });
    expect(withoutOutput.success).toBe(false);
    expect(withoutOutput.error).toBe("el comando no terminó");
    expect(withoutOutput.aviso).toContain("NO repitas");
  });
});

describe("budgetDeRunDeviceCommand", () => {
  it("cabe dentro del timeout que tenía la tool en cada caso", () => {

    expect(TIMEOUT_POR_HERRAMIENTA.runDeviceCommands).toBe(60_000);
    expect(budgetDeRunDeviceCommand(1)).toBeLessThanOrEqual(60_000);
    expect(budgetDeRunDeviceCommand(3)).toBeLessThanOrEqual(60_000);

    expect(budgetDeRunDeviceCommand(4)).toBeLessThanOrEqual(120_000);
    expect(budgetDeRunDeviceCommand(4)).toBeGreaterThan(
      budgetDeRunDeviceCommand(3),
    );

    expect(budgetDeRunDeviceCommand(1)).toBeGreaterThan(25_000);
  });
});
