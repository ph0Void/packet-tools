

import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ciscoClient } from "@/client/PacketTracerClient";
import {
  AVISO_APLICACION_SIN_CONFIRMAR,
  AVISO_NO_REPETIR_RESTAURACION,
  AVISO_SNAPSHOT_PARCIAL,
  CISCO_PACKET_TRACER_TOOLS_ADMIN,
  MAX_LINEAS_LOTE,
  detalleDeVerificacionRestauracion,
  extraerExpectativas,
  payloadDeRestoreDeviceConfig,
  payloadDeRestoreSinConfirmacion,
  validarTextoDeRestauracion,
  verificarLoteContraConfig,
  verificacionNoRealizada,
} from "@/agent/ciscoPacketTracer/Tool";





interface Call {
  tool: string;
  input: any;
}

type Script = any[] | ((input: any, invocacion: number) => any);

interface BridgeFake {
  modelcalls: Call[];
  de(tool: string): Call[];
}

function bridge(scripts: Record<string, Script>): BridgeFake {
  const modelcalls: Call[] = [];
  vi.spyOn(ciscoClient, "callTool").mockImplementation(
    async (tool: string, input: any) => {
      const invocacion = modelcalls.filter(
        (call) => call.tool === tool,
      ).length;
      modelcalls.push({ tool, input });
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


function aplicacionOk(lines: string[]): any {
  return {
    success: true,
    deviceName: "R1",
    status: "applied",
    results: lines.map((command) => ({ command, status: "ok", output: "" })),
    summary: { total: lines.length, ok: lines.length, errors: 0 },
  };
}


function snapshotWith(config: string): any {
  return { success: true, deviceName: "R1", runningConfig: config, config };
}


function snapshotWithout(config: string): any {
  return { success: true, deviceName: "R1", runningConfig: config, config };
}





const DIR = path.resolve(process.cwd(), "uploads", "topologies");
const SNAPSHOT = `__test_restore_${process.pid}`;
const ROUTE = path.join(DIR, `${SNAPSHOT}.cfg`);


const CONFIG_R1 = [
  "hostname R1",
  "interface GigabitEthernet0/0",
  " ip address 192.168.10.1 255.255.255.0",
  " no shutdown",
  "end",
].join("\n");

function writeSnapshot(text: string): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ROUTE, text, "utf8");
}

beforeAll(() => {
  writeSnapshot(CONFIG_R1);
});

afterAll(() => {
  fs.rmSync(ROUTE, { force: true });
});

afterEach(() => {
  writeSnapshot(CONFIG_R1);
  vi.restoreAllMocks();
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

async function invocarRestore(): Promise<any> {
  const output = await toolByName("restoreDeviceConfig").invoke({
    deviceName: "R1",
    snapshotName: SNAPSHOT,
  });
  return typeof output === "string" ? JSON.parse(output) : output;
}



describe("validate: un snapshot imposible ni llega a Packet Tracer", () => {
  it("snapshot vacío: no se llama a la extensión y dice que se aplique por partes", async () => {
    writeSnapshot("   \n\n\t\n");
    const bridgeFake = bridge({});

    const output = await invocarRestore();

    expect(bridgeFake.modelcalls).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(false);
    expect(output.verificacionOk).toBe(false);
    expect(output.error).toContain("ninguna línea de configuración");
    expect(output.error).toContain("configureIosDevice");
  });

  it("snapshot por encima de MAX_LINEAS_LOTE: no se llama a la extensión", async () => {
    const enorme = Array.from(
      { length: MAX_LINEAS_LOTE + 1 },
      (_, i) => `linea ${i}`,
    ).join("\n");
    writeSnapshot(enorme);
    const bridgeFake = bridge({});

    const output = await invocarRestore();


    expect(bridgeFake.modelcalls).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(false);
    expect(output.verificacionOk).toBe(false);
    expect(output.verificacionRealizada).toBeFalsy();
    expect(output.verificado).toEqual([]);
    expect(output.error).toContain(String(MAX_LINEAS_LOTE));
    expect(output.error).toContain("no cabe en una sola restauración");
    expect(output.error).toContain("POR PARTES");
    expect(output.error).toContain("configureIosDevice");

    expect(output.error).not.toContain("restoreDeviceConfig");
  });

  it("validarTextoDeRestauracion: cuenta líneas útiles y distingue el motivo", () => {
    const ok = validarTextoDeRestauracion("hostname R1\n\nhostname R2\n");
    expect(ok.ok).toBe(true);
    expect(ok.lines).toEqual(["hostname R1", "hostname R2"]);

    const long = validarTextoDeRestauracion(
      Array.from({ length: MAX_LINEAS_LOTE + 1 }, () => "no shutdown").join("\n"),
    );
    expect(long.ok).toBe(false);
    expect(long.lines).toEqual([]);
    expect(long.error).toContain("configureIosDevice");


    expect(
      validarTextoDeRestauracion(
        Array.from({ length: MAX_LINEAS_LOTE }, (_, i) => `n ${i}`).join("\n"),
      ).ok,
    ).toBe(true);

    const empty = validarTextoDeRestauracion("");
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain("configureIosDevice");

    const lineLong = validarTextoDeRestauracion(`description ${"x".repeat(250)}`);
    expect(lineLong.ok).toBe(false);
    expect(lineLong.error).toContain("configureIosDevice");
  });
});



describe("pre-flight: nada se aplica a ciegas", () => {
  it("equipo que no existe: no se aplica el snapshot", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [{ success: false, error: "Device R9 not found" }],
    });

    const output = await invocarRestore();

    expect(bridgeFake.de("applyDeviceConfig")).toHaveLength(0);
    expect(bridgeFake.de("getDeviceConfigSnapshot")).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(false);
    expect(output.error).toContain("no está en la topología");
  });

  it("equipo final sin consola IOS: no se aplica el snapshot", async () => {

    const bridgeFake = bridge({
      getDeviceInfo: [
        {
          success: true,
          result: {
            device: {
              name: "R1",
              model: "Laptop-PT",
              type: 18,
              interfaces: [{ name: "FastEthernet0", ipAddress: "192.168.10.5" }],
              ips: ["192.168.10.5"],
            },
          },
        },
      ],
    });

    const output = await invocarRestore();

    expect(bridgeFake.de("applyDeviceConfig")).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(false);
    expect(output.error).toMatch(/no tiene\s+consola IOS|equipo final/);
  });

  it("el pre-flight que falla NO corta con excepción si la lectura revienta", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: () => {
        throw new Error("timeout de getDeviceInfo");
      },
    });

    const output = await invocarRestore();

    expect(bridgeFake.de("applyDeviceConfig")).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(false);
    expect(output.error).toContain("reintentar es seguro");
  });
});



describe("verificación por lectura", () => {
  it("lectura que confirma el snapshot: success:true y seApplyOk", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      applyDeviceConfig: [aplicacionOk(["hostname R1"])],
      getDeviceConfigSnapshot: [snapshotWith(CONFIG_R1)],
    });

    const output = await invocarRestore();

    expect(bridgeFake.de("applyDeviceConfig")).toHaveLength(1);
    expect(output.success).toBe(true);
    expect(output.aplicado).toBe(true);
    expect(output.verificacionOk).toBe(true);
    expect(output.verificacionRealizada).toBe(true);
    expect(output.verificado.map((datum: any) => datum.dato)).toEqual([
      "hostname",
      "ip address",
    ]);
    expect(output.verificado.every((datum: any) => datum.ok)).toBe(true);

    expect(output.aviso).toBeUndefined();
    expect(output.error).toBeUndefined();
  });

  it("la extensión dice success:true pero la lectura NO cuadra: success:false", async () => {

    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      applyDeviceConfig: [
        { success: true, status: "unknown", message: "aplicado (aproximadamente)" },
      ],
      getDeviceConfigSnapshot: [
        snapshotWithout("hostname OTRO\ninterface Gi0/0\n ip address 10.9.9.9 255.255.255.0\nend"),
      ],
    });

    const output = await invocarRestore();

    expect(output.aplicado).toBe(true);
    expect(output.success).toBe(false);
    expect(output.verificacionOk).toBe(false);
    expect(output.verificacionRealizada).toBe(true);

    expect(output.error).toContain("hostname R1");
    expect(output.error).toContain("hostname OTRO");
    expect(output.error).toContain("192.168.10.1");
    expect(output.aviso).toBe(AVISO_SNAPSHOT_PARCIAL);
    expect(output.aviso).toContain("NO repitas la restauración");
  });

  it("la extensión falla: success:false y se lee igualmente para saber el estado", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      applyDeviceConfig: [{ success: false, error: "consola ocupada" }],
      getDeviceConfigSnapshot: [snapshotWith(CONFIG_R1)],
    });

    const output = await invocarRestore();

    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(false);
    expect(output.error).toContain("consola ocupada");

    expect(output.verificacionRealizada).toBe(true);
    expect(output.verificacionOk).toBe(true);

    expect(output.aviso).toBe(AVISO_NO_REPETIR_RESTAURACION);
    expect(output.aviso).toContain("NO repitas");
  });
});



describe("verificación no realizada", () => {
  it("snapshot que no se pudo leer: success:false, verificado:[] y aviso literal", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      applyDeviceConfig: [aplicacionOk(["hostname R1"])],
      getDeviceConfigSnapshot: [snapshotWith("")],
    });

    const output = await invocarRestore();

    expect(output.success).toBe(false);
    expect(output.aplicado).toBe(true);
    expect(output.verificacionOk).toBe(false);
    expect(output.verificacionRealizada).toBe(false);
    expect(output.verificado).toEqual([]);
    expect(output.aviso).toBe(AVISO_NO_REPETIR_RESTAURACION);

    expect(output.aviso).toContain("puede que el snapshot se haya aplicado a medias");
    expect(output.aviso).toContain("NO repitas la restauración");
    expect(output.aviso).toContain("getDeviceConfig");
    expect(output.aviso).toContain("continúa desde ahí");
  });

  it("la lectura de verificación revienta: mismo aviso, sin fingir que se leyó", async () => {
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      applyDeviceConfig: [aplicacionOk(["hostname R1"])],
      getDeviceConfigSnapshot: () => {
        throw new Error("timeout de getDeviceConfigSnapshot");
      },
    });

    const output = await invocarRestore();

    expect(output.success).toBe(false);
    expect(output.aplicacion ?? output.aplicado).toBe(true);
    expect(output.verificacionRealizada).toBe(false);
    expect(output.verificado).toEqual([]);
    expect(output.verificacionMotivo).toContain("getDeviceConfigSnapshot");
    expect(output.aviso).toBe(AVISO_NO_REPETIR_RESTAURACION);
  });

  it("el aviso de no repetir es el MISMO texto en ambos caminos sin verificar", () => {
    const withoutRead = payloadDeRestoreDeviceConfig({
      deviceName: "R1",
      snapshotName: "cfg",
      lines: ["hostname R1"],
      aplicacion: { success: true },
      verificacion: verificacionNoRealizada("Packet Tracer no devolvió la configuración"),
    });
    const withoutConfirmar = payloadDeRestoreSinConfirmacion({
      deviceName: "R1",
      snapshotName: "cfg",
      lines: 5,
      reason: "la llamada se cortó",
    });

    expect(withoutRead.aviso).toBe(AVISO_NO_REPETIR_RESTAURACION);
    expect(withoutConfirmar.aviso).toBe(AVISO_APLICACION_SIN_CONFIRMAR);
    for (const payload of [withoutRead, withoutConfirmar]) {
      expect(payload.success).toBe(false);
      expect(payload.verificacionOk).toBe(false);
      expect(payload.verificado).toEqual([]);
      expect(String(payload.aviso)).toContain("getDeviceConfig");
    }
  });
});



describe("timeout: el aviso sobrevive a la excepción", () => {
  it("callTool rechaza: NO se pierde el aviso y NO se reintenta solo", async () => {
    let intentos = 0;
    const bridgeFake = bridge({
      getDeviceInfo: [infoRouter()],
      applyDeviceConfig: () => {
        intentos += 1;
        throw new Error("applyDeviceConfig agotó su tiempo de espera (120000 ms)");
      },
    });

    const output = await invocarRestore();


    expect(intentos).toBe(1);
    expect(bridgeFake.de("applyDeviceConfig")).toHaveLength(1);

    expect(bridgeFake.de("getDeviceConfigSnapshot")).toHaveLength(0);
    expect(output.success).toBe(false);
    expect(output.aplicado).toBeNull();
    expect(output.verificacionOk).toBe(false);
    expect(output.verificacionRealizada).toBe(false);
    expect(output.verificado).toEqual([]);
    expect(output.error).toContain("120000 ms");

    expect(output.aviso).toBe(AVISO_APLICACION_SIN_CONFIRMAR);
    expect(output.aviso).toContain("NO se sabe si llegó a aplicarse");
    expect(output.aviso).toContain("getDeviceConfig ANTES de reintentar");
  });

  it("el payload de timeout dice que el estado es desconocido, no 'no aplicado'", () => {
    const payload = payloadDeRestoreSinConfirmacion({
      deviceName: "R1",
      snapshotName: "cfg",
      lines: 300,
      reason: "timeout",
    });


    expect(payload.aplicado).toBeNull();
    expect(payload).not.toHaveProperty("results");
    expect(payload.nvr).toBeNull();
    expect(payload.lines).toBe(300);
  });
});



describe("piezas puras compartidas", () => {
  it("extraerExpectativas del snapshot: hostname + ips", () => {
    const expectativas = extraerExpectativas([
      "hostname R1",
      "interface GigabitEthernet0/0",
      "ip address 192.168.10.1 255.255.255.0",
      "no shutdown",
      "end",
    ]);
    expect(expectativas.hostname).toBe("R1");
    expect(expectativas.ips).toEqual([
      { ip: "192.168.10.1", mascara: "255.255.255.0" },
    ]);
  });

  it("verificarLoteContraConfig sobre el snapshot real: ok y no-ok", () => {
    const expectativas = extraerExpectativas(["hostname R1", "ip address 192.168.10.1 255.255.255.0"]);

    const bien = verificarLoteContraConfig(expectativas, snapshotWith(CONFIG_R1), "R1");
    expect(bien.realizada).toBe(true);
    expect(bien.ok).toBe(true);

    const mal = verificarLoteContraConfig(
      expectativas,
      snapshotWithout("hostname R1\n ip address 10.0.0.1 255.255.255.0\n"),
      "R1",
    );
    expect(mal.realizada).toBe(true);
    expect(mal.ok).toBe(false);
    expect(mal.datos.find((datum) => datum.dato === "ip address")?.ok).toBe(false);
  });

  it("detalleDeVerificacionRestauracion no afirma el guardado en NVRAM", () => {
    const noRealizada = detalleDeVerificacionRestauracion(
      verificacionNoRealizada("no se pudo leer"),
    );
    expect(noRealizada).toContain("verificación NO realizada");
    expect(noRealizada).toContain("no se puede afirmar");

    const withData = detalleDeVerificacionRestauracion(
      verificarLoteContraConfig(
        extraerExpectativas(["hostname R1"]),
        snapshotWith(CONFIG_R1),
        "R1",
      ),
    );
    expect(withData).toContain("1/1");
  });

  it("payloadDeRestoreDeviceConfig conserva el diagnóstico de la extensión", () => {
    const payload = payloadDeRestoreDeviceConfig({
      deviceName: "R1",
      snapshotName: "cfg",
      lines: ["hostname R1", "ip address 1.1.1.1 255.255.255.0"],
      aplicacion: { success: true, status: "unknown", warning: "lento", results: [] },
      verificacion: verificarLoteContraConfig(
        extraerExpectativas(["hostname R1"]),
        snapshotWith(CONFIG_R1),
        "R1",
      ),
    });

    expect(payload.status).toBe("unknown");
    expect(payload.warning).toBe("lento");
    expect(payload.results).toEqual([]);

    expect(payload.success).toBe(true);
    expect(payload.snapshotName).toBe("cfg");
    expect(payload.lines).toBe(2);
  });
});
