

import { describe, expect, it } from "vitest";
import {
  CLAVE_GLOBAL,
  TIMEOUT_POR_DEFECTO,
  TIMEOUT_POR_HERRAMIENTA,
  dispositivoDe,
  mensajeDeTimeout,
  timeoutDe,
} from "@/client/PacketTracerClient";
import { SerializadorPorClave } from "@/client/SerializadorPorClave";


const GLOBALES = [
  "getNetwork",
  "validateTopology",
  "listDeviceModels",
  "clearWorkspace",
  "exportWorkspace",
  "importWorkspace",
  "addDevice",
  "addLink",
  "removeDevice",
  "removeLink",
  "setSimulationMode",
  "getSimulationStatus",
  "stepSimulation",
  "sendPdu",
  "getPduResults",
  "pingDevices",
  "reachabilityMatrix",
];


const RETIRADAS = ["configureIosDevice", "exportTopologyJSON", "loadTopologyFromJSON"];


const BY_DEVICE = [
  ["addModule", { deviceName: "R1" }, "R1"],
  ["configurePcIp", { deviceName: "PC1" }, "PC1"],
  ["configureIosDevice", { deviceName: "R1", commands: "hostname R1" }, "R1"],
  ["getDeviceInfo", { deviceName: "SW1" }, "SW1"],
  ["renameDevice", { deviceName: "R1", newName: "R2" }, "R1"],
  ["moveDevice", { deviceName: "R1", x: 100, y: 200 }, "R1"],
  ["setPower", { deviceName: "R1", power: true }, "R1"],
  ["getCommandLog", { deviceName: "R1", limit: 50 }, "R1"],
  ["getCommandLog", {}, null], 
  ["getRoutingTable", { deviceName: "R1" }, "R1"],
  ["getVlanConfiguration", { switchName: "SW1" }, "SW1"],
  ["getDeviceMetrics", { deviceName: "R1" }, "R1"],
  ["validateSecurityConfig", { deviceName: "R1" }, "R1"],
  ["runDeviceCommands", { deviceName: "R1", commands: ["show clock"] }, "R1"],
  ["readDeviceConsole", { deviceName: "R1", lines: 40 }, "R1"],
  ["applyDeviceConfig", { deviceName: "R1", configText: "hostname R1" }, "R1"],
  ["getDeviceConfigSnapshot", { deviceName: "R1" }, "R1"],
  ["listDeviceModules", { deviceName: "R1" }, "R1"],
  ["simulateLinkFailure", { deviceName: "R1", interfaceName: "Gi0/0" }, "R1"],
  ["restoreLink", { deviceName: "R1", interfaceName: "Gi0/0" }, "R1"],
] as const;

describe("dispositivoDe(): tabla de claves de serialización", () => {
  it("las herramientas de topología y simulación global usan la clave global", () => {
    for (const name of GLOBALES) {
      expect(
        dispositivoDe(name, { deviceName: "R1" }),
        name,
      ).toBe(CLAVE_GLOBAL);
    }
  });

  it("cada herramienta de un solo equipo devuelve su clave de dispositivo", () => {
    for (const [name, input, team] of BY_DEVICE) {
      
      const esperado = team
        ? `dispositivo:${team.toLowerCase()}`
        : CLAVE_GLOBAL;
      expect(dispositivoDe(name, input), name).toBe(esperado);
    }
  });

  it("normaliza el nombre (trim + minúsculas) para no perder el lock", () => {
    expect(dispositivoDe("runDeviceCommands", { deviceName: "  R1  " })).toBe(
      "dispositivo:r1",
    );

    expect(dispositivoDe("runDeviceCommands", { deviceName: "R1" })).toBe(
      dispositivoDe("getDeviceConfigSnapshot", { deviceName: "r1" }),
    );
  });

  it("usa deviceName y, si falta, switchName o los otros campos", () => {
    expect(dispositivoDe("configurePcIp", { deviceName: "PC1", dnsServer: "8.8.8.8" })).toBe(
      "dispositivo:pc1",
    );
    expect(dispositivoDe("getVlanConfiguration", { switchName: "SW1" })).toBe(
      "dispositivo:sw1",
    );
    expect(dispositivoDe("getRoutingTable", { sourceName: "R1" })).toBe(
      "dispositivo:r1",
    );
    expect(dispositivoDe("simulateLinkFailure", { targetName: "R1" })).toBe(
      "dispositivo:r1",
    );
  });

  it("las herramientas retiradas del puente ya no son globales ni tienen timeout", () => {
    for (const name of RETIRADAS) {

      expect(dispositivoDe(name, { deviceName: "R1" }), name).toBe(
        "dispositivo:r1",
      );
      expect(timeoutDe(name), name).toBe(TIMEOUT_POR_DEFECTO);
      expect(TIMEOUT_POR_HERRAMIENTA[name], name).toBeUndefined();
    }
  });

  it("cae en la clave global cuando no hay equipo deducible", () => {

    expect(dispositivoDe("removeDevice", { deviceNames: ["R1", "R2"] })).toBe(
      CLAVE_GLOBAL,
    );
    expect(
      dispositivoDe("reachabilityMatrix", { sourceName: "R1", targetNames: ["PC1"] }),
    ).toBe(CLAVE_GLOBAL);
    expect(dispositivoDe("getCommandLog", { deviceName: null })).toBe(CLAVE_GLOBAL);
    expect(dispositivoDe("getCommandLog", {})).toBe(CLAVE_GLOBAL);
    expect(dispositivoDe("herramientaInventada", {})).toBe(CLAVE_GLOBAL);
    expect(dispositivoDe("getDeviceInfo", undefined)).toBe(CLAVE_GLOBAL);
    expect(dispositivoDe("getDeviceInfo", { deviceName: { name: "R1" } })).toBe(
      CLAVE_GLOBAL,
    );
  });
});

describe("timeoutDe(): tabla de timeouts por operación", () => {
  it("solo las lecturas simples y el catálogo bajan de 20 s", () => {

    const RAPIDAS = new Set([
      "listDeviceModels",
      "getDeviceInfo",
      "readDeviceConsole",
      "listDeviceModules",
      "getCommandLog",
      "getSimulationStatus",
      "moveDevice",
      "addDevice",
      "addLink",
      "removeDevice",
      "removeLink",
      "renameDevice",
    ]);
    for (const [name, milisegundos] of Object.entries(TIMEOUT_POR_HERRAMIENTA)) {
      expect(
        milisegundos,
        `${name} debe tener un timeout positivo`,
      ).toBeGreaterThan(0);
      if (milisegundos <= 20_000) {
        expect(
          RAPIDAS.has(name),
          `${name} tiene un timeout corto (${milisegundos} ms) sin ser lectura rápida`,
        ).toBe(true);
      }
    }

    const largos = Object.values(TIMEOUT_POR_HERRAMIENTA).filter((ms) => ms >= 60_000);
    expect(largos.length).toBeGreaterThanOrEqual(6);
  });

  it("clasifica las operaciones por coste real medido", () => {

    expect(timeoutDe("listDeviceModels")).toBe(15_000);
    expect(timeoutDe("getDeviceInfo")).toBe(15_000);
    expect(timeoutDe("readDeviceConsole")).toBe(15_000);
    expect(timeoutDe("getSimulationStatus")).toBe(10_000);

    expect(timeoutDe("getRoutingTable")).toBe(30_000);
    expect(timeoutDe("getDeviceConfigSnapshot")).toBe(45_000);
    expect(timeoutDe("runDeviceCommands")).toBe(60_000);

    expect(timeoutDe("getNetwork")).toBe(45_000);

    expect(timeoutDe("addDevice")).toBe(20_000);
    expect(timeoutDe("configurePcIp")).toBe(30_000);

    expect(timeoutDe("applyDeviceConfig")).toBe(120_000);

    expect(timeoutDe("exportWorkspace")).toBe(90_000);
    expect(timeoutDe("importWorkspace")).toBe(90_000);

    expect(timeoutDe("stepSimulation")).toBe(30_000);
    expect(timeoutDe("sendPdu")).toBe(45_000);

    expect(timeoutDe("pingDevices")).toBe(60_000);
    expect(timeoutDe("reachabilityMatrix")).toBe(90_000);
  });

  it("usa el override explícito del tercer parámetro de callTool", () => {
    expect(timeoutDe("getNetwork", { timeoutMs: 5_000 })).toBe(5_000);

    expect(timeoutDe("getNetwork", { timeoutMs: 300_000 })).toBe(300_000);
    expect(timeoutDe("getNetwork", {})).toBe(timeoutDe("getNetwork"));

    expect(timeoutDe("getNetwork", { timeoutMs: 0 })).toBe(45_000);
    expect(timeoutDe("getNetwork", { timeoutMs: -1 })).toBe(45_000);
    expect(timeoutDe("getNetwork", { timeoutMs: Number.NaN })).toBe(45_000);
  });

  it("cae en un default prudente (no 20 s) si la tool no está en la tabla", () => {
    expect(timeoutDe("herramientaInventada")).toBe(TIMEOUT_POR_DEFECTO);
    expect(TIMEOUT_POR_DEFECTO).toBeGreaterThan(20_000);
    expect(timeoutDe("herramientaInventada", { timeoutMs: 1_000 })).toBe(1_000);
  });
});

describe("mensajeDeTimeout()", () => {
  it("nombra la herramienta, el equipo y el tiempo esperado", () => {
    const byTeam = mensajeDeTimeout(
      "configureIosDevice",
      "dispositivo:r1",
      120_000,
    );
    expect(byTeam).toContain("configureIosDevice");
    expect(byTeam).toContain("'r1'");
    expect(byTeam).toContain("120s");

    const global = mensajeDeTimeout("getNetwork", CLAVE_GLOBAL, 45_000);
    expect(global).toContain("getNetwork");
    expect(global).toContain("workspace");
    expect(global).toContain("45s");
  });

  it("avisa de que el comando puede ejecutarse más tarde y de cómo recuperar", () => {
    const mensaje = mensajeDeTimeout("runDeviceCommands", "dispositivo:r1", 60_000);

    expect(mensaje).toContain("más tarde");
    expect(mensaje).toMatch(/reinicia Packet Tracer/i);
  });
});

describe("SerializadorPorClave", () => {
  it("serializa dos llamadas de la MISMA clave (no se solapan)", async () => {
    const serializador = new SerializadorPorClave();
    const orden: string[] = [];

    const slow = serializador.encolar("dispositivo:r1", async () => {
      orden.push("inicio-1");
      await wait(20);
      orden.push("fin-1");
      return 1;
    });
    const fast = serializador.encolar("dispositivo:r1", async () => {
      orden.push("inicio-2");
      return 2;
    });

    await Promise.all([slow, fast]);
    expect(orden).toEqual(["inicio-1", "fin-1", "inicio-2"]);
    expect(serializador.pendientes).toBe(0);
    expect(serializador.enCurso).toBe(0);
  });

  it("mantiene el orden FIFO de la cola de una clave", async () => {
    const serializador = new SerializadorPorClave();
    const orden: number[] = [];
    const tareas = [30, 5, 1].map((ms, index) =>
      serializador.encolar("dispositivo:r1", async () => {
        orden.push(index);
        await wait(ms);
        return index;
      }),
    );

    await Promise.all(tareas);
    expect(orden).toEqual([0, 1, 2]);
  });

  it("deja correr en paralelo llamadas de claves DISTINTAS", async () => {
    const serializador = new SerializadorPorClave();
    let maxSimultaneo = 0;
    let simultaneos = 0;

    const job = async () => {
      simultaneos += 1;
      maxSimultaneo = Math.max(maxSimultaneo, simultaneos);
      await wait(15);
      simultaneos -= 1;
    };

    await Promise.all([
      serializador.encolar("dispositivo:r1", job),
      serializador.encolar("dispositivo:pc1", job),
      serializador.encolar("dispositivo:sw1", job),
    ]);

    expect(maxSimultaneo).toBe(3);
  });

  it("una llamada que lanza NO deja la cola bloqueada", async () => {
    const serializador = new SerializadorPorClave();

    const fallida = serializador.encolar("dispositivo:r1", async () => {
      throw new Error("timeout simulado");
    });
    await expect(fallida).rejects.toThrow("timeout simulado");


    await expect(serializador.encolar("dispositivo:r1", async () => "ok")).resolves.toBe(
      "ok",
    );
    expect(serializador.pendientes).toBe(0);
    expect(serializador.enCurso).toBe(0);
    expect(serializador.clavesActivas).toEqual([]);
  });

  it("una llamada síncrona que lanza también libera la cola", async () => {
    const serializador = new SerializadorPorClave();
    await expect(
      serializador.encolar("dispositivo:r1", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(
      serializador.encolar("dispositivo:r1", () => "siguiente"),
    ).resolves.toBe("siguiente");
  });

  it("un exclusivo serializa el lienzo entero: bloquea a los dispositivos", async () => {
    const serializador = new SerializadorPorClave();
    const orden: string[] = [];

    const byDevice = serializador.encolar("dispositivo:r1", async () => {
      orden.push("inicio-r1");
      await wait(15);
      orden.push("fin-r1");
    });
    const global = serializador.encolarExclusivo(CLAVE_GLOBAL, async () => {
      orden.push("inicio-global");
    });
    const otherDevice = serializador.encolar("dispositivo:pc1", async () => {
      orden.push("inicio-pc1");
    });

    await Promise.all([byDevice, global, otherDevice]);
    expect(orden).toEqual(["inicio-r1", "fin-r1", "inicio-global", "inicio-pc1"]);
  });

  it("un exclusivo encolado después de varios dispositivos se respeta (escritor primero)", async () => {
    const serializador = new SerializadorPorClave();
    const orden: string[] = [];

    const first = serializador.encolar("dispositivo:r1", async () => {
      orden.push("r1");
      await wait(15);
    });
    const second = serializador.encolar("dispositivo:pc1", async () => {
      orden.push("pc1");
    });
    const global = serializador.encolarExclusivo(CLAVE_GLOBAL, async () => {
      orden.push("global");
    });

    await Promise.all([first, second, global]);

    expect(orden).toEqual(["r1", "pc1", "global"]);
  });

  it("no acumula claves cuando todo termina (sin fuga de estado)", async () => {
    const serializador = new SerializadorPorClave();
    await Promise.all([
      serializador.encolar("dispositivo:r1", async () => 1),
      serializador.encolarExclusivo(CLAVE_GLOBAL, async () => 2),
    ]);

    expect(serializador.clavesActivas).toEqual([]);
    expect(serializador.pendientes).toBe(0);
    expect(serializador.enCurso).toBe(0);
  });
});


function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
