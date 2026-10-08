

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  CATALOGO_MODELOS_EXTENSION,
  TIPOS_CATALOGO_EXTENSION,
  clasificarEquipo,
  contenidoDeLogDeOperacion,
  detalleDeFallosParciales,
  extraerModelosValidos,
  interpretarMatrizAlcance,
  interpretarPing,
  modelosMasParecidos,
  operacionOk,
  PING_ESTADOS_DE_ERROR,
  PING_SIN_RESPUESTA,
  revisarEquipoParaConfig,
  validarModeloDeDispositivo,
} from "@/agent/ciscoPacketTracer/Tool";
import {
  NOTA_CACHE,
  readCacheMiddleware,
  resetReadCache,
  resultadoIndicaFallo,
} from "@/agent/tools/readCacheMiddleware";

afterEach(() => {
  resetReadCache();
});

describe("T1 — el catálogo de modelos lo manda la extensión", () => {
  
  
  
  const CATALOGO = [
    "1841",
    "1941",
    "2901",
    "2911",
    "Router-PT",
    "Switch-PT",
    "Cloud-PT",
    "PC-PT",
    "Server-PT",
    "Laptop-PT",
    "2960-24TT",
    "3560-24PS",
  ];

  it("extrae los ids del payload de listDeviceModels (envuelto o plano)", () => {
    const flat = extraerModelosValidos({
      success: true,
      models: [{ id: "Router-PT" }, { id: "2911" }],
    });
    expect(flat).toEqual(["Router-PT", "2911"]);

    
    const envuelto = extraerModelosValidos({
      code: "return listDeviceModels();",
      result: { success: true, models: [{ id: "Switch-PT" }] },
    });
    expect(envuelto).toEqual(["Switch-PT"]);

    
    expect(extraerModelosValidos({ success: false, error: "sin motor" })).toEqual([]);
  });

  it("acepta un Router-PT (el modelo que el enum antiguo impedía crear)", () => {
    const validacion = validarModeloDeDispositivo("Router-PT", CATALOGO);
    expect(validacion.ok).toBe(true);
    if (validacion.ok) expect(validacion.modelo).toBe("Router-PT");
  });

  it("rechaza 2921 (no existe) y señala los modelos válidos más cercanos", () => {
    const validacion = validarModeloDeDispositivo("2921", CATALOGO);

    expect(validacion.ok).toBe(false);
    if (validacion.ok) return;
    
    expect(validacion.error).toContain("2911");
    expect(validacion.error).toContain("listDeviceModels");
    expect(validacion.error).toContain("no es un modelo de dispositivo");
  });

  it("la coincidencia es exacta pero tolera espacios sobrantes", () => {
    expect(validarModeloDeDispositivo("  PC-PT  ", CATALOGO).ok).toBe(true);
    expect(validarModeloDeDispositivo("router-pt", CATALOGO).ok).toBe(false);
    expect(validarModeloDeDispositivo("", CATALOGO).ok).toBe(false);
  });

  it("propone los más parecidos por similitud", () => {
    expect(modelosMasParecidos("296", CATALOGO)[0]).toBe("2960-24TT");
    expect(modelosMasParecidos("Router", CATALOGO)[0]).toBe("Router-PT");
    
    expect(modelosMasParecidos("zzz", CATALOGO)).toEqual([]);
  });
});


function routeDevicesJs(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidata = path.resolve(dir, "extension-packetracer", "devices.js");
    if (fs.existsSync(candidata)) return candidata;
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  throw new Error(
    `no se encuentra extension-packetracer/devices.js subiendo desde ${__dirname}`,
  );
}



function allDeviceTypesOfLaExtension(): Record<string, number> {
  const route = routeDevicesJs();
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(fs.readFileSync(route, "utf8"), sandbox, { filename: route });
  const table = sandbox.allDeviceTypes;
  if (!table || typeof table !== "object") {
    throw new Error(`devices.js no declara allDeviceTypes: ${route}`);
  }
  return table as Record<string, number>;
}

describe("T1b — CATALOGO_MODELOS_EXTENSION no se desincroniza de devices.js", () => {
  it("tiene los MISMOS modelos y los MISMOS tipos que la fuente real", () => {

    const real = allDeviceTypesOfLaExtension();

    const faltan = Object.keys(real).filter((m) => !(m in CATALOGO_MODELOS_EXTENSION));
    const sobran = Object.keys(CATALOGO_MODELOS_EXTENSION).filter((m) => !(m in real));
    const kindDistinto = Object.keys(real)
      .filter((m) => m in CATALOGO_MODELOS_EXTENSION)
      .filter((m) => CATALOGO_MODELOS_EXTENSION[m] !== real[m])
      .map((m) => `${m}: devices.js=${real[m]} vs transcripción=${CATALOGO_MODELOS_EXTENSION[m]}`);

    const conteo =
      `devices.js=${Object.keys(real).length} modelos, ` +
      `CATALOGO_MODELOS_EXTENSION=${Object.keys(CATALOGO_MODELOS_EXTENSION).length} modelos`;
    const notice =
      `${conteo}. Re-sincroniza CATALOGO_MODELOS_EXTENSION con ` +
      `extension-packetracer/devices.js (no cambies este test).`;

    expect(
      faltan.map((m) => `falta ${m} (tipo ${real[m]})`),
      `modelos de devices.js que NO están en la transcripción. ${notice}`,
    ).toEqual([]);
    expect(
      sobran.map((m) => `sobra ${m} (tipo ${CATALOGO_MODELOS_EXTENSION[m]})`),
      `modelos de la transcripción que YA NO EXISTEN en devices.js (¿renombrados?). ${notice}`,
    ).toEqual([]);
    expect(kindDistinto, `modelos con otro tipo. ${notice}`).toEqual([]);
  });

  it("los tipos catalogados son exactamente los que usa la extensión", () => {

    const reales = [...new Set(Object.values(allDeviceTypesOfLaExtension()))].sort(
      (a, b) => a - b,
    );
    const copiados = [...TIPOS_CATALOGO_EXTENSION].sort((a, b) => a - b);

    expect(
      reales.filter((t) => !copiados.includes(t)),
      "tipos que usan los modelos de devices.js y no están catalogados",
    ).toEqual([]);
    expect(
      copiados.filter((t) => !reales.includes(t)),
      "tipos catalogados que devices.js ya no usa",
    ).toEqual([]);
  });
});

describe("T4 — los logs de auditoría dicen lo que pasó", () => {
  it("escribe el texto de éxito solo cuando la extensión confirmó", () => {
    const ok = contenidoDeLogDeOperacion({
      result: { success: true, message: "Workspace limpiado" },
      titleOk: "Espacio de Trabajo Limpiado",
      titleFailure: "Limpieza No Realizada",
      exito: "Todos los dispositivos fueron eliminados",
      intento: "Se vació el workspace",
    });

    expect(ok.title).toBe("Espacio de Trabajo Limpiado");
    expect(ok.content).toContain("eliminados");
    expect(ok.content).not.toContain("NO se pudo completar");
  });

  it("cambia título y contenido cuando la extensión falló", () => {
    const failure = contenidoDeLogDeOperacion({
      result: {
        success: false,
        error: "fileNew no disponible en este entorno",
      },
      titleOk: "Espacio de Trabajo Limpiado",
      titleFailure: "Limpieza No Realizada",
      exito: "Todos los dispositivos fueron eliminados",
      intento: "Se vació el workspace",
    });

    expect(failure.title).toBe("Limpieza No Realizada");
    expect(failure.content).toContain("NO se pudo completar");

    expect(failure.content).toContain("fileNew no disponible");

    expect(failure.content).not.toContain("Todos los dispositivos fueron eliminados");
  });

  it("usa el mismo criterio de ok() que la checklist de la extensión", () => {

    expect(operacionOk({ message: "algo" })).toBe(true);
    expect(operacionOk({ success: true })).toBe(true);
    expect(operacionOk({ success: false })).toBe(false);
    expect(operacionOk({ error: "Device not found" })).toBe(false);
    expect(operacionOk(null)).toBe(false);
    expect(operacionOk("texto")).toBe(false);

    const withoutMarkers = contenidoDeLogDeOperacion({
      result: {},
      titleOk: "Módulo Instalado",
      titleFailure: "Módulo No Instalado",
      exito: "instalado",
      intento: "Se intentó instalar",
    });
    expect(withoutMarkers.title).toBe("Módulo Instalado");

    const withoutObjeto = contenidoDeLogDeOperacion({
      result: undefined,
      titleOk: "Módulo Instalado",
      titleFailure: "Módulo No Instalado",
      exito: "instalado",
      intento: "Se intentó instalar",
    });
    expect(withoutObjeto.title).toBe("Módulo No Instalado");
    expect(withoutObjeto.content).toContain("no confirmó la operación");
  });

  it("un borrado en lote parcial dice cuántos fallaron", () => {
    const parcial = {
      success: false,
      totalDevices: 3,
      successCount: 2,
      failCount: 1,
      results: [
        { device: "R1", success: true },
        { device: "PC9", success: false, error: "Device not found" },
      ],
    };

    expect(detalleDeFallosParciales(parcial)).toContain("fallaron 1 de 3");
    expect(detalleDeFallosParciales(parcial)).toContain("'PC9'");

    expect(
      detalleDeFallosParciales({
        success: true,
        results: [{ device: "R1", success: true }],
      }),
    ).toBeNull();
    expect(detalleDeFallosParciales({ success: true })).toBeNull();

    const log = contenidoDeLogDeOperacion({
      result: parcial,
      titleOk: "Dispositivo Eliminado",
      titleFailure: "Dispositivo No Eliminado",
      exito: "Removido(s) de la red",
      intento: "Se intentó eliminar de la red",
      detail: detalleDeFallosParciales(parcial),
    });
    expect(log.content).toContain("fallaron 1 de 3");
  });
});

describe("T5 — reachMatrix no trunca en silencio", () => {
  it("marca truncado y lista los destinos omitidos", () => {
    const destinos = Array.from({ length: 15 }, (_, i) => `PC${i}`);

    const filas = destinos
      .slice(0, 10)
      .map((target) => ({ target, ok: true, status: "ok" }));

    const matriz = interpretarMatrizAlcance({ success: true, rows: filas }, destinos);

    expect(matriz.fallo).toBeUndefined();
    expect(matriz.datos!.truncado).toBe(true);
    expect(matriz.datos!.destinosPedidos).toBe(15);
    expect(matriz.datos!.destinosMedidos).toBe(10);
    expect(matriz.datos!.destinosOmitidos).toEqual(destinos.slice(10));

    expect(matriz.datos!.message).toContain("NO se ha medido");
  });

  it("no marca truncado cuando se midieron todos", () => {
    const destinos = ["R1", "R2", "PC1"];
    const filas = destinos.map((target) => ({ target, ok: true, status: "ok" }));

    const matriz = interpretarMatrizAlcance({ success: true, rows: filas }, destinos);

    expect(matriz.datos!.truncado).toBe(false);
    expect(matriz.datos!.destinosOmitidos).toBeUndefined();
  });
});

describe("T6 — la consola IOS se decide como decide la extensión", () => {
  it("{0,1,16} tienen consola IOS y el resto de la tabla no", () => {
    for (const kind of [0, 1, 16]) {
      expect(clasificarEquipo({ type: kind }).clase, `tipo ${kind}`).toBe("ios");
    }
    for (const kind of [2, 8, 9, 10, 18, 27, 39, 50]) {
      expect(clasificarEquipo({ type: kind }).clase, `tipo ${kind}`).toBe("host");
    }
  });

  it("un tipo desconocido NO se convierte en router por ausencia de pistas", () => {

    const clasificacion = clasificarEquipo({ type: 15, name: "Algo" });
    expect(clasificacion.clase).toBe("desconocido");
    expect(clasificacion.reason).toContain("15");
  });

  it("sin `type` solo decide el modelo (o el nombre) si no deja dudas", () => {
    expect(clasificarEquipo({ model: "Router-PT" }).clase).toBe("ios");
    expect(clasificarEquipo({ model: "2911" }).clase).toBe("ios");
    expect(clasificarEquipo({ model: "Laptop-PT" }).clase).toBe("host");
    expect(clasificarEquipo({ name: "Router1" }).clase).toBe("ios");
    expect(clasificarEquipo({ name: "PC1" }).clase).toBe("host");

    expect(clasificarEquipo({ model: "HomeRouter-PT" }).clase).toBe("desconocido");
    expect(clasificarEquipo({}).clase).toBe("desconocido");
  });

  it("el caso del bug: un Laptop-PT (tipo 18) renombrado a 'Router1' NO pasa como router", () => {
    const info = {
      success: true,
      result: {
        device: {
          name: "Router1",
          model: "Laptop-PT",
          type: 18,
          interfaces: [
            { name: "Wireless0", in_use: true, ipAddress: "192.168.1.5" },
          ],
        },
        connections: [],
      },
    };

    const revision = revisarEquipoParaConfig(info, "Router1", [
      "hostname R1",
      "interface Gi0/0",
      "ip address 10.0.0.1 255.255.255.0",
      "do write memory",
    ]);

    expect(revision.ok).toBe(false);
    expect(revision.error).toContain("no tiene consola IOS");
    expect(revision.equipo?.consolaIos).toBe(false);
  });

  it("bloquea (y lo explica) cuando el equipo no se puede clasificar", () => {
    const info = {
      success: true,
      result: {
        device: {
          name: "X1",
          interfaces: [{ name: "Gi0/0", ipAddress: "10.0.0.1" }],
        },
      },
    };

    const revision = revisarEquipoParaConfig(info, "X1", ["hostname X1"]);

    expect(revision.ok).toBe(false);
    expect(revision.error).toContain("No se puede determinar");
    expect(revision.error).toContain("getDeviceInfo");
  });

  it("un router IOS (tipo 0) direccionado sigue pasando", () => {
    const info = {
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
              ipAddress: "192.168.10.1",
            },
          ],
        },
        connections: [],
      },
    };

    expect(revisarEquipoParaConfig(info, "R1", ["hostname R1"]).ok).toBe(true);
  });
});

describe("T7 — la caché no congela un fallo escondido en el texto", () => {
  it("detecta los fallos que viajan como texto con status:'success'", () => {

    const failureMockConsole = JSON.stringify({
      success: false,
      deviceName: "R1",
      error: "sin salida",
      timedOut: false,
      notice: "El comando se consumió como respuesta a un prompt pendiente",
    });
    expect(resultadoIndicaFallo(failureMockConsole)).toBe(true);

    expect(
      resultadoIndicaFallo(
        JSON.stringify({
          success: true,
          results: [{ command: "show run", status: "ok" }],
        }),
      ),
    ).toBe(false);
    expect(resultadoIndicaFallo(JSON.stringify({ success: false, error: "x" }))).toBe(true);
    expect(resultadoIndicaFallo(JSON.stringify({ success: true, timedOut: true }))).toBe(true);
    expect(
      resultadoIndicaFallo(JSON.stringify({ success: true, results: [{ status: "error" }] })),
    ).toBe(true);
    expect(
      resultadoIndicaFallo(JSON.stringify({ success: true, verificacionOk: false })),
    ).toBe(true);

    expect(
      resultadoIndicaFallo(
        JSON.stringify({
          success: true,
          result: {
            devices: [
              {
                name: "R1",
                type: 0,
                interfaces: [{ name: "Gi0/0", in_use: true, status: "up" }],
              },
            ],
          },
        }),
      ),
    ).toBe(false);

    expect(resultadoIndicaFallo("# Informe de red\n> 3 dispositivo(s)")).toBe(false);
  });

  it("no cachea un resultado cuyo contenido dice success:false", async () => {
    const { ToolMessage } = await import("@langchain/core/messages");
    const middleware = readCacheMiddleware();
    const wrap = middleware.wrapToolCall as unknown as (
      request: unknown,
      handler: () => Promise<unknown>,
    ) => Promise<unknown>;

    let modelcalls = 0;
    const handlerFailure = async (request: any) => {
      ++modelcalls;
      return new ToolMessage({
        tool_call_id: request.toolCall.id,
        name: request.toolCall.name,
        content: JSON.stringify({ success: false, error: "prompt pendiente" }),
      });
    };

    const prompt = {
      toolCall: {
        name: "runDeviceCommand",
        args: { deviceName: "R1", command: "show run" },
        id: "tc-1",
        type: "tool_call",
      },
      runtime: { configurable: { thread_id: "hilo-fallo" } },
      state: { messages: [] },
    };

    const first: any = await wrap(prompt, handlerFailure);
    const second: any = await wrap(prompt, handlerFailure);


    expect(modelcalls).toBe(2);
    expect(String(first.content)).toContain("success");
    expect(String(second.content)).not.toContain(NOTA_CACHE);
  });

  it("sigue cacheando una lectura buena y la marca como de caché", async () => {
    const { ToolMessage } = await import("@langchain/core/messages");
    const middleware = readCacheMiddleware();
    const wrap = middleware.wrapToolCall as unknown as (
      request: unknown,
      handler: () => Promise<unknown>,
    ) => Promise<unknown>;

    let modelcalls = 0;
    const handlerOk = async (request: any) => {
      ++modelcalls;
      return new ToolMessage({
        tool_call_id: request.toolCall.id,
        name: request.toolCall.name,
        content: JSON.stringify({ success: true, devices: [{ name: "R1" }] }),
      });
    };

    const prompt = {
      toolCall: { name: "getNetwork", args: {}, id: "tc-2", type: "tool_call" },
      runtime: { configurable: { thread_id: "hilo-ok" } },
      state: { messages: [] },
    };

    await wrap(prompt, handlerOk);
    const second: any = await wrap(prompt, handlerOk);

    expect(modelcalls).toBe(1);
    expect(String(second.content).startsWith(NOTA_CACHE)).toBe(true);
  });
});

describe("T8c — no_reply es un veredicto, no un fallo de medición", () => {
  it("no_reply NO está entre los estados que se convierten en error", () => {
    expect(PING_ESTADOS_DE_ERROR[PING_SIN_RESPUESTA]).toBeUndefined();

    expect(Object.keys(PING_ESTADOS_DE_ERROR)).toContain("interfaz_no_lista");
    expect(Object.keys(PING_ESTADOS_DE_ERROR)).toContain("no_ip");
  });

  it("devuelve el dato con un mensaje que explica el 'no'", () => {
    const ping = interpretarPing({
      success: true,
      source: "PC1",
      target: "PC2",
      status: "no_reply",
      ok: false,
      received: 0,
      sent: 5,
      lossPercent: 100,
      descartadoEn: "PC1",
    });

    expect(ping.fallo).toBeUndefined();
    expect(ping.datos!.status).toBe("no_reply");
    expect(ping.datos!.ok).toBe(false);
    expect(ping.datos!.message).toContain("Sin respuesta de 'PC2'");
    expect(ping.datos!.message).toContain("no un fallo de la medición");
  });

  it("un estado que NO mide nada sigue siendo fallo explícito", () => {
    const ping = interpretarPing({
      success: true,
      source: "PC1",
      target: "PC2",
      status: "interfaz_no_lista",
    });

    expect(ping.fallo).toContain("todavía no estaba operativo");
  });
});
