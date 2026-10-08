

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIMEOUT_POR_HERRAMIENTA,
  ciscoClient,
} from "@/client/PacketTracerClient";
import { ESPERAR_MS_TECHO } from "@/client/PacketTracerConsola";
import {
  CISCO_PACKET_TRACER_TOOLS_ADMIN,
  COMANDO_GUARDADO_NVRAM,
  MAX_CARACTERES_LINEA,
  MAX_LINEAS_LOTE,
  PRESUPUESTO_CICLO_CONFIG_MS,
  TECHO_RESPALDO_CONFIG_MS,
  contenidoDeLogConfiguracion,
  extraerExpectativas,
  parsearLoteConfiguracion,
  payloadDeConfigureIosDevice,
  revisarEquipoParaConfig,
  verificarLoteContraConfig,
  verificacionNoRealizada,
} from "@/agent/ciscoPacketTracer/Tool";


const TECHO_CYCLE_CONFIG_MS = 120_000;





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


function infoRouter(ips: string[] = ["192.168.10.1"]): any {
  return {
    success: true,
    result: {
      device: {
        name: "R1",
        model: "2911",
        
        
        
        
        
        type: 0,
        interfaces: [
          {
            name: "GigabitEthernet0/0",
            in_use: true,
            ipAddress: ips[0],
            subnetMask: "255.255.255.0",
          },
        ],
        ...(ips.length > 0 ? { ips } : {}),
      },
      connections: [],
    },
  };
}


function lanzamiento(id = "p-1"): any {
  return {
    success: true,
    pendingId: id,
    deviceName: "R1",
    commands: ["hostname R1"],
    mode: "global",
    eventRecorded: true,
    t0: Date.now(),
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


function reintentar(blockResolved = "enter"): any {
  return {
    success: true,
    pendingId: "p-1",
    done: false,
    status: "reintentar",
    commandConsumido: true,
    blockResolved,
    pendingMs: 300,
    eventRecorded: true,
  };
}


const ROWS_OK = [
  { command: "hostname R1", status: "ok", output: "" },
  { command: "interface GigabitEthernet0/0", status: "ok", output: "" },
  { command: "ip address 192.168.10.1 255.255.255.0", status: "ok", output: "" },
  { command: COMANDO_GUARDADO_NVRAM, status: "ok", output: "Building configuration..." },
];


function snapshotAplicado(config = CONFIG_R1): any {
  return {
    success: true,
    deviceName: "R1",
    runningConfig: config,
    startupConfig: config,
    config,
  };
}

const CONFIG_R1 = [
  "hostname R1",
  "interface GigabitEthernet0/0",
  " ip address 192.168.10.1 255.255.255.0",
  " no shutdown",
  "end",
].join("\n");





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

async function invocarConfigure(
  deviceName: string,
  commands: string,
): Promise<any> {
  const output = await toolByName("configureIosDevice").invoke({
    deviceName,
    commands,
  });
  return typeof output === "string" ? JSON.parse(output) : output;
}


const LOTE = [
  "hostname R1",
  "interface GigabitEthernet0/0",
  "ip address 192.168.10.1 255.255.255.0",
  "no shutdown",
  "exit",
].join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});



describe("configureIosDevice: pre-flight antes de escribir", () => {
  it("equipo sin ninguna IP: no envía nada y dice que hay que direccionarlo", async () => {

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({

      getDeviceInfo: [infoRouter([])],
      runCommandAsync: [lanzamiento()],
    });

    const output = await invocarConfigure("R1", "hostname R1\nno logging console");


    expect(bridgeFake.de("runCommandAsync")).toHaveLength(0);
    expect(bridgeFake.de("getDeviceConfigSnapshot")).toHaveLength(0);
    expect(bridgeFake.modelcalls.map((l) => l.tool)).toEqual(["getDeviceInfo"]);
    expect(output.success).toBe(false);
    expect(output.error).toContain("no tiene ninguna IP");
    expect(output.error).toContain("Direcciona el equipo primero");
    expect(output.equipo.sinIpAntes).toBe(true);
  });

  it("equipo inexistente: no envía nada", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [{ success: false, error: "Device R9 not found" }],
      runCommandAsync: [lanzamiento()],
    });

    const output = await invocarConfigure("R9", "hostname R9");

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.error).toContain("no está en la topología");
    expect(output.error).toContain("R9 not found");
  });

  it("equipo final sin consola IOS: no envía nada y apunta a configurePcIp", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [
        {
          success: true,
          result: {
            device: {
              name: "PC1",
              model: "PC-PT",

              type: 8,
              interfaces: [{ name: "FastEthernet0", in_use: true, ipAddress: "192.168.10.10" }],
            },
            connections: [],
          },
        },
      ],
      runCommandAsync: [lanzamiento()],
    });

    const output = await invocarConfigure("PC1", "hostname PC1");

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.error).toContain("no tiene consola IOS");
    expect(output.error).toContain("configurePcIp");
  });

  it("sin IP previa PERO con `ip address` en el lote: se aplica (es el caso de un router nuevo)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter([])],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [terminado(ROWS_OK)],
      getDeviceConfigSnapshot: [snapshotAplicado()],
    });

    const output = await invocarConfigure(
      "R1",
      "hostname R1\ninterface GigabitEthernet0/0\nip address 192.168.10.1 255.255.255.0\nno shutdown",
    );

    expect(bridgeFake.de("runCommandAsync")).toHaveLength(1);
    expect(output.success).toBe(true);
    expect(output.verificacionOk).toBe(true);

    expect(output.aviso).toContain("no tenía ninguna IP");
    expect(output.equipo.sinIpAntes).toBe(true);
  });

  it("validación de entrada local: lote vacío, tope de líneas y de longitud", async () => {
    const bridgeFake = bridge({});

    const empty = await invocarConfigure("R1", "   \n\n");
    expect(empty.success).toBe(false);
    expect(empty.error).toContain("ninguna línea");

    const long = await invocarConfigure(
      "R1",
      Array.from({ length: MAX_LINEAS_LOTE + 1 }, (_, i) => `linea ${i}`).join("\n"),
    );
    expect(long.success).toBe(false);
    expect(long.error).toContain(String(MAX_LINEAS_LOTE));

    const lineEnorme = await invocarConfigure(
      "R1",
      `hostname ${"a".repeat(MAX_CARACTERES_LINEA + 10)}`,
    );
    expect(lineEnorme.success).toBe(false);
    expect(lineEnorme.error).toContain(String(MAX_CARACTERES_LINEA));


    expect(bridgeFake.modelcalls).toHaveLength(0);
  });
});



describe("configureIosDevice: envío por el ciclo de eventos", () => {
  it("manda el lote con el guardado en NVRAM, en modo global, y verifica", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [terminado(ROWS_OK)],
      getDeviceConfigSnapshot: [snapshotAplicado()],
    });

    const output = await invocarConfigure("R1", LOTE);


    const sent = bridgeFake.de("runCommandAsync")[0].input.commands;
    expect(sent).toEqual([
      "hostname R1",
      "interface GigabitEthernet0/0",
      "ip address 192.168.10.1 255.255.255.0",
      "no shutdown",
      "exit",
      COMANDO_GUARDADO_NVRAM,
    ]);
    expect(sent[sent.length - 1]).toContain("write memory");
    expect(bridgeFake.de("runCommandAsync")[0].input.options).toEqual({
      mode: "global",
    });

    expect(bridgeFake.de("pollCommandResult")).toHaveLength(1);
    expect(bridgeFake.de("configureIosDevice")).toHaveLength(0);
    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(0);


    expect(output.success).toBe(true);
    expect(output.deviceName).toBe("R1");
    expect(Array.isArray(output.results)).toBe(true);
    expect(output.summary).toEqual({ total: ROWS_OK.length, ok: ROWS_OK.length, errors: 0 });

    expect(output.fuente).toBe("commandEnded");
    expect(output.verificacionOk).toBe(true);
    expect(output.verificacionRealizada).toBe(true);
    expect(output.cicloOk).toBe(true);
    expect(output.reintentado).toBe(false);
    expect(output.timedOut).toBe(false);
  });

  it("verifica el hostname y cada `ip address` enviados contra la configuración real", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    bridge({
      getDeviceInfo: [infoRouter()],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [terminado(ROWS_OK)],
      getDeviceConfigSnapshot: [snapshotAplicado()],
    });

    const output = await invocarConfigure("R1", LOTE);

    expect(output.verificado).toEqual([
      {
        datum: "hostname",
        esperado: "hostname R1",
        encontrado: "hostname R1",
        ok: true,
      },
      {
        datum: "ip address",
        esperado: "ip address 192.168.10.1 255.255.255.0",
        encontrado: "ip address 192.168.10.1 255.255.255.0",
        ok: true,
      },
    ]);

    expect(output.nvr.ok).toBe(true);
    expect(output.nvr.encontrado).toContain("ya tiene lo aplicado");
  });

  it("el log sólo dice 'guardados en NVRAM' cuando la verificación lo confirma", () => {
    const ok = contenidoDeLogConfiguracion({
      deviceName: "R1",
      lines: ["hostname R1"],
      exito: true,
      verificacion: verificarLoteContraConfig(
        extraerExpectativas(["hostname R1"]),
        snapshotAplicado(),
        "R1",
      ),
    });
    expect(ok).toContain("guardados en NVRAM");
    expect(ok).toContain("verificado leyendo la configuración");


    const withoutNvr = contenidoDeLogConfiguracion({
      deviceName: "R1",
      lines: ["hostname R1"],
      exito: true,
      verificacion: verificarLoteContraConfig(
        extraerExpectativas(["hostname R1"]),
        { success: true, runningConfig: CONFIG_R1, startupEmpty: true },
        "R1",
      ),
    });
    expect(withoutNvr).toContain("Comandos aplicados");
    expect(withoutNvr).not.toMatch(/guardad[oa]s? en NVRAM/i);
    expect(withoutNvr).toContain("no se pudo confirmar");


    const failure = contenidoDeLogConfiguracion({
      deviceName: "R1",
      lines: ["hostname R1", "ip address 10.0.0.1 255.255.255.0"],
      exito: false,
      verificacion: verificarLoteContraConfig(
        extraerExpectativas(["hostname R1", "ip address 10.0.0.1 255.255.255.0"]),
        { success: true, runningConfig: CONFIG_R1 },
        "R1",
      ),
      problema: "el prompt pendiente consumió el comando",
    });
    expect(failure).toContain("el prompt pendiente consumió el comando");
    expect(failure).toContain("no aparece esa dirección");
    expect(failure).toContain("NVRAM sin confirmar");
    expect(failure).not.toMatch(/guardad[oa]s? en NVRAM/i);
  });
});



describe("configureIosDevice: prompt pendiente que consume el comando", () => {
  it("no relanza, falla honestamente y dice qué encontró la verificación", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      runCommandAsync: [lanzamiento("p-1"), lanzamiento("p-2")],

      pollCommandResult: [reintentar("enter")],
      readDeviceConsole: [
        { success: true, deviceName: "R1", output: "R1 con0/0 is down\nPress RETURN to get started!" },
      ],
      getDeviceConfigSnapshot: [
        { success: true, runningConfig: "interface GigabitEthernet0/0\n no shutdown" },
      ],
    });

    const output = await invocarConfigure("R1", LOTE);


    expect(bridgeFake.de("runCommandAsync")).toHaveLength(1);
    expect(bridgeFake.de("configureIosDevice")).toHaveLength(0);

    expect(output.success).toBe(false);
    expect(output.cicloOk).toBe(false);
    expect(output.reintentado).toBe(false);
    expect(output.comandoConsumido).toBe(true);
    expect(output.bloqueoResuelto).toBe("enter");
    expect(output.motivoReintento).toContain("NO se ha repetido");
    expect(output.error).toContain("se comió");
    expect(output.error).toContain("NO se ha repetido");

    expect(output.results[0].status).toBe("unknown");

    expect(output.verificacionOk).toBe(false);
    expect(output.verificado.map((d: any) => d.ok)).toEqual([false, false]);
    expect(output.verificado[0].encontrado).toContain("no aparece ningún hostname");
    expect(output.verificado[1].encontrado).toContain("no aparece esa dirección");
    expect(output.error).toContain("la configuración leída NO contiene");

    expect(output.aviso).toContain("NO repitas el lote");
  });

  it("el respaldo del ciclo (extensión antigua) tampoco re-ejecuta el lote a mano", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],

      runCommandAsync: [{ success: false, error: "herramienta no compatible" }],
      runDeviceCommands: [
        { success: true, deviceName: "R1", results: ROWS_OK, summary: { total: 4, ok: 4, errors: 0 } },
      ],
      getDeviceConfigSnapshot: [snapshotAplicado()],
    });

    const output = await invocarConfigure("R1", LOTE);


    expect(bridgeFake.de("runDeviceCommands")).toHaveLength(1);
    expect(bridgeFake.de("runDeviceCommands")[0].opciones).toEqual({
      timeoutMs: TECHO_RESPALDO_CONFIG_MS,
    });
    expect(output.fuente).toBe("sincrono");
    expect(output.success).toBe(true);
    expect(output.verificacionOk).toBe(true);
  });
});



describe("configureIosDevice: verificación que falla", () => {
  it("el snapshot no trae la IP enviada: verificacionOk:false y sin 'guardado en NVRAM'", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [terminado(ROWS_OK)],
      getDeviceConfigSnapshot: [
        {
          success: true,
          runningConfig: "hostname R1\ninterface GigabitEthernet0/0\n no shutdown",
          startupConfig: "hostname R1",
        },
      ],
    });

    const output = await invocarConfigure("R1", LOTE);

    expect(output.cicloOk).toBe(true);
    expect(output.verificacionOk).toBe(false);
    expect(output.success).toBe(false);
    const ip = output.verificado.find((d: any) => d.dato === "ip address");
    expect(ip.ok).toBe(false);
    expect(ip.esperado).toBe("ip address 192.168.10.1 255.255.255.0");
    expect(ip.encontrado).toContain("no aparece esa dirección");

    expect(output.verificado.find((d: any) => d.dato === "hostname").ok).toBe(true);
    expect(output.error).toContain("la configuración leída NO contiene");

    expect(output.nvr.ok).toBe(false);
    expect(output.nvr.encontrado).toContain("192.168.10.1");
  });

  it("snapshot ilegible: no se puede verificar y se dice (no se inventa un ok)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    bridge({
      getDeviceInfo: [infoRouter()],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [terminado(ROWS_OK)],
      getDeviceConfigSnapshot: [
        { success: true, runningConfig: "", config: "", warning: "running_config_unavailable" },
      ],
    });

    const output = await invocarConfigure("R1", LOTE);

    expect(output.verificacionRealizada).toBe(false);
    expect(output.verificacionOk).toBe(false);
    expect(output.verificacionMotivo).toContain("running_config_unavailable");
    expect(output.error).toContain("no se pudo verificar");
    expect(output.aviso).toContain("NO repitas el lote");
  });

  it("presupuesto agotado: NO lee el snapshot (el lote puede seguir vivo)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const enCurso = {
      success: true,
      pendingId: "p-1",
      done: false,
      status: "en_curso",
      pendingMs: 1000,
      eventRecorded: true,
    };
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      runCommandAsync: [lanzamiento()],
      pollCommandResult: [enCurso],
      readDeviceConsole: [{ success: true, deviceName: "R1", output: "   " }],
      getDeviceConfigSnapshot: [snapshotAplicado()],
    });


    vi.useFakeTimers();
    try {
      const pending = toolByName("configureIosDevice").invoke({
        deviceName: "R1",
        commands: LOTE,
      });
      await vi.advanceTimersByTimeAsync(PRESUPUESTO_CICLO_CONFIG_MS + 5_000);
      const output = JSON.parse((await pending) as string);

      expect(output.timedOut).toBe(true);
      expect(output.success).toBe(false);

      expect(bridgeFake.de("getDeviceConfigSnapshot")).toHaveLength(0);
      expect(output.verificacionRealizada).toBe(false);
      expect(output.verificacionMotivo).toContain("puede seguir");
      expect(output.aviso).toContain("NO repitas el lote");
    } finally {
      vi.useRealTimers();
    }
  });
});



describe("presupuesto de configureIosDevice", () => {
  it("el peor caso de cada camino cabe en el timeout de la tool", () => {

    const techoTool = TECHO_CYCLE_CONFIG_MS;
    expect(techoTool).toBe(120_000);
    expect(TIMEOUT_POR_HERRAMIENTA.configureIosDevice).toBeUndefined();

    const preflight = TIMEOUT_POR_HERRAMIENTA.getDeviceInfo;
    const lanzamiento = TIMEOUT_POR_HERRAMIENTA.runCommandAsync;
    const verificacion = TIMEOUT_POR_HERRAMIENTA.getDeviceConfigSnapshot;
    const mockConsole = TIMEOUT_POR_HERRAMIENTA.readDeviceConsole;
    const respaldo = TECHO_RESPALDO_CONFIG_MS;


    const normal = preflight + lanzamiento + PRESUPUESTO_CICLO_CONFIG_MS + verificacion;
    expect(normal).toBeLessThanOrEqual(techoTool);
    expect(normal).toBe(115_000);


    const agotado =
      preflight + lanzamiento + PRESUPUESTO_CICLO_CONFIG_MS + mockConsole;
    expect(agotado).toBeLessThanOrEqual(techoTool);


    const consumido =
      preflight +
      lanzamiento +
      ESPERAR_MS_TECHO +
      mockConsole +
      verificacion;
    expect(consumido).toBeLessThanOrEqual(techoTool);


    const withoutCycle = preflight + respaldo + verificacion;
    expect(withoutCycle).toBeLessThanOrEqual(techoTool);


    expect(preflight).toBe(15_000);
    expect(lanzamiento).toBe(30_000);
    expect(verificacion).toBe(45_000);
    expect(PRESUPUESTO_CICLO_CONFIG_MS).toBe(25_000);

    expect(ESPERAR_MS_TECHO).toBeLessThan(TIMEOUT_POR_HERRAMIENTA.pollCommandResult);
  });

  it("el presupuesto no depende del tamaño del lote (el tecleo va en el lanzamiento)", () => {

    expect(PRESUPUESTO_CICLO_CONFIG_MS).toBe(25_000);
    expect(TIMEOUT_POR_HERRAMIENTA.runCommandAsync).toBeGreaterThan(0);
  });
});



describe("extraerExpectativas", () => {
  it("saca el hostname y cada `ip address` del lote", () => {
    expect(
      extraerExpectativas([
        "hostname R1",
        "interface GigabitEthernet0/0",
        "ip address 192.168.10.1 255.255.255.0",
        "ip address 10.0.0.2 255.255.255.252",
        "no shutdown",
        "exit",
      ]),
    ).toEqual({
      hostname: "R1",
      ips: [
        { ip: "192.168.10.1", mascara: "255.255.255.0" },
        { ip: "10.0.0.2", mascara: "255.255.255.252" },
      ],
    });
  });

  it("no cuenta `no hostname` ni `no ip address` (esos quitan, no ponen)", () => {
    expect(
      extraerExpectativas(["no hostname R1", "no ip address 1.1.1.1 255.255.255.0"]),
    ).toEqual({ hostname: null, ips: [] });
  });

  it("deduplica y tolera la IP sin máscara", () => {
    expect(
      extraerExpectativas([
        "ip address 1.1.1.1 255.255.255.0",
        "ip address 1.1.1.1 255.255.255.0",
        "ip address 2.2.2.2",
      ]).ips,
    ).toEqual([
      { ip: "1.1.1.1", mascara: "255.255.255.0" },
      { ip: "2.2.2.2", mascara: "" },
    ]);
  });
});

describe("verificarLoteContraConfig", () => {
  it("encuentra hostname e IP en el running-config", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["hostname R1", "ip address 192.168.10.1 255.255.255.0"]),
      { success: true, runningConfig: CONFIG_R1 },
      "R1",
    );

    expect(verificacion.realizada).toBe(true);
    expect(verificacion.ok).toBe(true);
    expect(verificacion.datos).toHaveLength(2);
  });

  it("avisa cuando la IP está pero CON OTRA máscara", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["ip address 192.168.10.1 255.255.255.0"]),
      {
        success: true,
        runningConfig: "interface Gi0/0\n ip address 192.168.10.1 255.255.255.128",
      },
      "R1",
    );

    expect(verificacion.ok).toBe(false);
    expect(verificacion.datos[0].ok).toBe(false);
    expect(verificacion.datos[0].encontrado).toContain("255.255.255.128");
    expect(verificacion.datos[0].encontrado).toContain("OTRA máscara");
  });

  it("hostname distinto: no cuadra y lo dice", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["hostname NUEVO"]),
      { success: true, runningConfig: CONFIG_R1 },
      "R1",
    );

    expect(verificacion.ok).toBe(false);
    expect(verificacion.datos[0].ok).toBe(false);
    expect(verificacion.datos[0].encontrado).toBe("hostname R1");
  });

  it("un lote sin hostname ni IP es verificable y no inventa datos", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["no logging console", "line vty 0 4"]),
      { success: true, runningConfig: CONFIG_R1, startupConfig: CONFIG_R1 },
      "R1",
    );

    expect(verificacion.realizada).toBe(true);
    expect(verificacion.ok).toBe(true);
    expect(verificacion.datos).toEqual([]);
    expect(verificacion.nvr?.ok).toBe(true);
  });

  it("snapshot ilegible: verificación no realizada con motivo", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["hostname R1"]),
      { success: true, runningConfig: "", warning: "running_config_unavailable" },
      "R1",
    );

    expect(verificacion.realizada).toBe(false);
    expect(verificacion.ok).toBe(false);
    expect(verificacion.datos).toEqual([]);
    expect(verificacion.reason).toContain("running_config_unavailable");
  });

  it("el startup-config vacío es lo que impide afirmar el guardado", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["hostname R1"]),
      { success: true, runningConfig: CONFIG_R1, startupEmpty: true },
      "R1",
    );

    expect(verificacion.ok).toBe(true);
    expect(verificacion.nvr?.ok).toBe(false);
    expect(verificacion.nvr?.encontrado).toContain("startup-config vacío");
  });

  it("running-config aplicado pero startup-config sin la IP: el guardado no está probado", () => {
    const verificacion = verificarLoteContraConfig(
      extraerExpectativas([
        "hostname R1",
        "ip address 192.168.10.1 255.255.255.0",
      ]),
      { success: true, runningConfig: CONFIG_R1, startupConfig: "hostname R1" },
      "R1",
    );


    expect(verificacion.ok).toBe(true);
    expect(verificacion.nvr?.ok).toBe(false);
    expect(verificacion.nvr?.encontrado).toContain("ip address 192.168.10.1");
  });

  it("prefiere el running-config al startup-config", () => {

    const verificacion = verificarLoteContraConfig(
      extraerExpectativas(["hostname R1"]),
      { success: true, runningConfig: CONFIG_R1, startupConfig: "" },
      "R1",
    );

    expect(verificacion.ok).toBe(true);
  });
});

describe("parsearLoteConfiguracion", () => {
  it("limpia líneas vacías y recortadas", () => {
    const result = parsearLoteConfiguracion(
      "  hostname R1 \r\n\n\tno shutdown\n\n",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines).toEqual(["hostname R1", "no shutdown"]);
  });

  it("rechaza el lote vacío y los topes", () => {
    expect(parsearLoteConfiguracion("").ok).toBe(false);
    expect(parsearLoteConfiguracion(undefined as any).ok).toBe(false);
    expect(
      parsearLoteConfiguracion(
        Array.from({ length: MAX_LINEAS_LOTE + 1 }, () => "no shutdown").join("\n"),
      ).ok,
    ).toBe(false);
    expect(parsearLoteConfiguracion("a".repeat(MAX_CARACTERES_LINEA + 1)).ok).toBe(
      false,
    );
  });
});

describe("revisarEquipoParaConfig", () => {
  it("acepta un router IOS direccionado", () => {
    const revision = revisarEquipoParaConfig(infoRouter(), "R1", ["hostname R1"]);
    expect(revision.ok).toBe(true);
    expect(revision.equipo?.ips).toEqual(["192.168.10.1"]);
    expect(revision.equipo?.sinIpAntes).toBe(false);
  });

  it("lee la IP aunque venga en `interfaces[].ipAddress`", () => {
    const revision = revisarEquipoParaConfig(
      {
        success: true,
        result: {
          device: {
            name: "SW1",
            model: "2960-24TT",
            type: 1,
            interfaces: [{ name: "Vlan1", in_use: true, ipAddress: "192.168.1.2" }],
          },
        },
      },
      "SW1",
      ["enable",
       "interface Vlan1",
       "no shutdown"],
    );
    expect(revision.ok).toBe(true);
    expect(revision.equipo?.ips).toEqual(["192.168.1.2"]);
  });

  it("bloquea equipo sin IP salvo que el lote lo direccione", () => {
    const info = infoRouter([]);
    expect(revisarEquipoParaConfig(info, "R1", ["hostname R1"]).ok).toBe(false);
    expect(
      revisarEquipoParaConfig(info, "R1", ["interface Gi0/0", "ip address 1.1.1.1 255.255.255.0"]).ok,
    ).toBe(true);
  });

  it("cubre respuestas raras del puente sin inventar datos", () => {
    expect(revisarEquipoParaConfig(null, "R1", ["hostname R1"]).ok).toBe(false);
    expect(revisarEquipoParaConfig({ success: true }, "R1", ["hostname R1"]).ok).toBe(false);
    expect(
      revisarEquipoParaConfig({ success: false, error: "Device R1 not found" }, "R1", ["hostname R1"]).error,
    ).toContain("no está en la topología");
  });
});
