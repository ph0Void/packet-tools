

import { describe, expect, it } from "vitest";
import {
  PING_ESTADOS_DE_ERROR,
  PING_INTERFAZ_NO_LISTA,
  PING_NO_SOPORTADO,
  interpretarMatrizAlcance,
  interpretarPing,
} from "@/agent/ciscoPacketTracer/Tool";


function payloadInterfazCaida(extra: Record<string, unknown> = {}): any {
  return {
    success: true,
    ok: false,
    source: "PC1",
    target: "R1",
    protocol: "ICMP",
    sent: 0,
    received: 0,
    lossPercent: 100,
    metodo: "pdu",
    status: PING_INTERFAZ_NO_LISTA,
    output:
      "PDU ICMP PC1 -> R1: NO se creo el PDU porque 'PC1' tiene la interfaz " +
      "FastEthernet0 sin enlace operativo (isPortUp: false) tras esperar 4800 ms.",
    noSalioOfOrigen: true,
    interfacesEsperadas: 4800,
    ...extra,
  };
}

describe("estado interfaz_no_lista del ping de Packet Tracer", () => {
  it("esta en PING_ESTADOS_DE_ERROR con un motivo que NO induce a tocar la config", () => {
    const reason = PING_ESTADOS_DE_ERROR[PING_INTERFAZ_NO_LISTA];
    expect(reason).toBeTruthy();
    
    expect(reason).toMatch(/enlace|interfaz/i);
    expect(reason).toMatch(/no cambi|reintent|espera/i);
    expect(reason).toMatch(/topolog|direccionamiento|rutas/i);
    expect(reason).not.toMatch(/destino no responde/i);
  });

  it("no_reply NO esta en la tabla de errores (sigue siendo un ping valido)", () => {
    
    
    expect(PING_ESTADOS_DE_ERROR["no_reply"]).toBeUndefined();
    expect(PING_ESTADOS_DE_ERROR["ok"]).toBeUndefined();
    
    expect(PING_ESTADOS_DE_ERROR[PING_NO_SOPORTADO]).toBeUndefined();
  });

  it("interpretarPing lo devuelve como FALLO, no como ping valido", () => {
    const r = interpretarPing(payloadInterfazCaida());
    expect(r.fallo).toBeTruthy();
    expect(r.datos).toBeUndefined();
    expect(r.fallo).toContain(PING_INTERFAZ_NO_LISTA);
    expect(r.fallo).toContain("PC1");
    expect(r.fallo).toContain("R1");
  });

  it("el fallo de interpretarPing dice que no se cambie la configuracion", () => {
    const r = interpretarPing(payloadInterfazCaida());
    expect(r.fallo).toMatch(/no cambi/i);
    
    expect(r.fallo).not.toMatch(/el equipo destino no responde/i);
  });

  it("sin salida en el `output` de la extension el fallo sigue siendo util", () => {
    const r = interpretarPing(payloadInterfazCaida({ output: "" }));
    expect(r.fallo).toContain(PING_INTERFAZ_NO_LISTA);
    expect(r.fallo).toMatch(/no cambi/i);
  });

  it("desenvuelve el envoltorio {code, result} de PT", () => {
    const r = interpretarPing({ code: "0", result: payloadInterfazCaida(), success: true });
    expect(r.fallo).toBeTruthy();
    expect(r.fallo).toContain(PING_INTERFAZ_NO_LISTA);
  });

  it("unsupported_device sigue siendo un payload valido con mensaje, no un fallo", () => {
    const r = interpretarPing({
      success: true,
      ok: false,
      status: PING_NO_SOPORTADO,
      source: "PC1",
      target: "SW1",
      output: "no tiene consola IOS",
    });
    expect(r.fallo).toBeUndefined();
    expect(r.datos).toBeTruthy();
    expect(r.datos.message).toContain(PING_NO_SOPORTADO);
  });

  it("un ping ok o no_reply NO lo lee el backend como fallo de la tool", () => {
    expect(interpretarPing({ success: true, ok: true, status: "ok" }).fallo).toBeUndefined();
    expect(
      interpretarPing({ success: true, ok: false, status: "no_reply", lossPercent: 100 }).fallo,
    ).toBeUndefined();
  });
});

describe("interfaz_no_lista en reachabilityMatrix", () => {
  it("la cuenta como fila con error y explica que no mide alcance", () => {
    const r = interpretarMatrizAlcance(
      {
        success: true,
        source: "PC1",
        rows: [
          { target: "R1", ok: true, received: 1, lossPercent: 0, status: "ok" },
          payloadInterfazCaida({ target: "R2" }),
        ],
      },
      ["R1", "R2"],
    );
    expect(r.fallo).toBeUndefined();
    expect(r.datos.rows).toHaveLength(2);
    const mensaje = String(r.datos.message || "");
    expect(mensaje).toContain(PING_INTERFAZ_NO_LISTA);
    expect(mensaje).toContain("R2");
    expect(mensaje).toMatch(/no (miden|medir) alcance/i);
    expect(mensaje).toMatch(/no cambi/i);
  });

  it("si todas las filas son interfaz_no_lista, el fallo tambin lo dice", () => {
    const r = interpretarMatrizAlcance(
      {
        success: true,
        source: "PC1",
        rows: [
          payloadInterfazCaida({ target: "R1" }),
          payloadInterfazCaida({ target: "R2" }),
        ],
      },
      ["R1", "R2"],
    );
    expect(r.fallo).toBeTruthy();
    expect(r.fallo).toContain("R1");
    expect(r.fallo).toContain("R2");
    expect(r.fallo).toMatch(/no cambi/i);
    expect(r.fallo).toMatch(/topolog/i);
  });

  it("no se cuenta como fila de sinCli (ese caso es 'no es un fallo')", () => {
    const r = interpretarMatrizAlcance(
      {
        success: true,
        source: "PC1",
        rows: [payloadInterfazCaida({ target: "R1" })],
      },
      ["R1"],
    );
    
    expect(r.fallo).toBeTruthy();
    expect(r.fallo).not.toContain(PING_NO_SOPORTADO);
  });

  it("una matriz solo-ok no inventa mensaje de enlace caido", () => {
    const r = interpretarMatrizAlcance(
      {
        success: true,
        source: "PC1",
        rows: [
          { target: "R1", ok: true, received: 1, lossPercent: 0, status: "ok" },
          { target: "R2", ok: true, received: 1, lossPercent: 0, status: "ok" },
        ],
      },
      ["R1", "R2"],
    );
    expect(r.fallo).toBeUndefined();
    expect(r.datos.message).toBeUndefined();
  });
});
