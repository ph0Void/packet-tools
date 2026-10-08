import { describe, expect, it } from "vitest";

import { payloadDe } from "@/agent/ciscoPacketTracer/Tool";


describe("payloadDe (desenvoltorio de la extensión)", () => {
  it("desenvuelve el envoltorio CON code (forma de algunas tools)", () => {
    expect(
      payloadDe({ code: "OK", result: { devices: [{ name: "R1" }] } }),
    ).toEqual({ devices: [{ name: "R1" }] });
  });

  it("desenvuelve el envoltorio SIN code, que es el de getNetwork (el que fallaba)", () => {
    const network = payloadDe({
      result: { devices: [{ name: "R1" }], deviceCount: 1 },
      success: true,
    });
    expect(Array.isArray(network.devices)).toBe(true);
    expect(network.devices).toHaveLength(1);
  });

  it("desenvuelve varios niveles anidados", () => {
    expect(
      payloadDe({ code: "OK", result: { result: { devices: [] }, success: true } }),
    ).toEqual({ devices: [] });
  });

  it("NO desenvuelve un payload que traiga `result` como dato propio", () => {
    
    
    const withData = { devices: [{ name: "R1" }], result: { ok: true } };
    expect(payloadDe(withData)).toBe(withData);
  });

  it("devuelve tal cual lo que no es un objeto", () => {
    expect(payloadDe(null)).toBeNull();
    expect(payloadDe(undefined)).toBeUndefined();
    expect(payloadDe("texto plano")).toBe("texto plano");
  });

  it("devuelve tal cual un payload sin `result`", () => {
    const flat = { success: true, devices: [] };
    expect(payloadDe(flat)).toBe(flat);
  });
});
