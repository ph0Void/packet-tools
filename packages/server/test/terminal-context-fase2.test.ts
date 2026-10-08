

import { afterEach, describe, expect, it } from "vitest";
import { terminalSessionHub, type TerminalSessionRegistration } from "@/sockets/TerminalSessionHub";
import { requestContext } from "@/utils/RequestContext";
import {
  buildTerminalHeaderBlock,
  buildTerminalSessionBlock,
} from "@/agent/terminal/SessionContext";
import { buildSystemPrompt } from "@/agent/Model";
import { buildTurnContextPrompt } from "@/agent/deep/DeepSupervisor";
import { DEFAULT_TURN_CONTEXT } from "@/agent/deep/context";


function sessionRegistration(
  overrides: Partial<TerminalSessionRegistration> = {},
): TerminalSessionRegistration {
  return {
    socketId: "s1",
    userId: "u1",
    providerId: "p1",
    protocol: "SSH",
    deviceName: "R1",
    fingerprint: null,
    write: () => {},
    isAlive: () => true,
    ...overrides,
  };
}

function userContext(overrides: Record<string, unknown> = {}) {
  return { id: "u1", username: "test", role: "ADMIN", ...overrides } as any;
}


const MOCKCONSOLE_RAW = "\x1b[36mR1# show version\x1b[0m\r\nCisco IOS XE Software\r\nR1# ";

afterEach(() => {
  terminalSessionHub.clear();
  terminalSessionHub.stopKeepalive();
});

describe("TerminalContext Fase 2 (default 0 = solo encabezado)", () => {
  it("buildTerminalHeaderBlock: ~80 tokens, encabezado mínimo, sin residuos de consola", () => {
    terminalSessionHub.register(sessionRegistration());
    terminalSessionHub.recordData("s1", MOCKCONSOLE_RAW);

    const header = requestContext.run(
      userContext({ terminalSessionId: "s1" }),
      () => buildTerminalHeaderBlock(),
    );

    expect(header).toContain("## Terminal activa");
    expect(header).toContain("Dispositivo: R1");
    expect(header).toContain("Protocolo: SSH");
    expect(Math.ceil(header.length / 4)).toBeLessThanOrEqual(80);
    expect(header).not.toContain("Cisco IOS XE");
    expect(header).not.toContain("\x1b");
    expect(header).not.toContain("```");
  });

  it("con terminalContextLines ausente, el bloque no trae líneas de consola", () => {
    terminalSessionHub.register(sessionRegistration());
    terminalSessionHub.recordData("s1", MOCKCONSOLE_RAW);

    const block = requestContext.run(
      userContext({ terminalSessionId: "s1" }),
      () => buildTerminalSessionBlock(),
    );

    expect(block).toContain("Estado de la terminal activa");
    expect(block).not.toContain("```text");
    expect(block).not.toContain("Cisco IOS XE");
    expect(block).not.toContain("\x1b");
  });

  it("con terminalContextLines=10, el bloque trae líneas sanitizadas y recortadas", () => {
    terminalSessionHub.register(sessionRegistration());
    const lines = Array.from({ length: 30 }, (_, i) => `linea-${i + 1}`);
    terminalSessionHub.recordData("s1", `${lines.join("\n")}\n`);

    const block = requestContext.run(
      userContext({ terminalSessionId: "s1", terminalContextLines: 10 }),
      () => buildTerminalSessionBlock(),
    );

    expect(block).toContain("```text");
    const inner = block.split("```text\n")[1]?.split("\n```")[0] ?? "";
    const innerLines = inner.split("\n").filter((l) => l.trim() !== "");
    expect(innerLines.length).toBeLessThanOrEqual(10);
    expect(block).toContain("linea-30");
    expect(block).not.toContain("linea-1\n");
    expect(block).not.toContain("\x1b");
  });

  it("buildSystemPrompt ya NO contiene el bloque de terminal aunque haya sesión viva", async () => {
    terminalSessionHub.register(sessionRegistration());
    terminalSessionHub.recordData("s1", MOCKCONSOLE_RAW);

    const prompt = await requestContext.run(
      userContext({ terminalSessionId: "s1", terminalOrigin: "terminal" }),
      () => buildSystemPrompt("BASE_PROMPT"),
    );

    expect(prompt).toContain("BASE_PROMPT");
    expect(prompt).not.toContain("Estado de la terminal activa");
    expect(prompt).not.toContain("Terminal activa");
    expect(prompt).not.toContain("Cisco IOS XE");
    expect(prompt).not.toContain("```");
  });

  it("buildTurnContextPrompt inyecta solo el encabezado + regla de delegación, sin consola", async () => {
    terminalSessionHub.register(sessionRegistration());
    terminalSessionHub.recordData("s1", MOCKCONSOLE_RAW);

    const prompt = await requestContext.run(
      userContext({ terminalSessionId: "s1", terminalOrigin: "terminal" }),
      () => buildTurnContextPrompt(DEFAULT_TURN_CONTEXT),
    );

    expect(prompt).toContain("## Terminal activa");
    expect(prompt).toContain("Delegation rule for terminal turns");
    expect(prompt).not.toContain("Cisco IOS XE");
    expect(prompt).not.toContain("```text");
    const blockTerminal = prompt
      .split("\n\n")
      .find((b) => b.startsWith("## Terminal activa"));
    expect(blockTerminal).toBeDefined();
    expect(Math.ceil(blockTerminal!.length / 4)).toBeLessThanOrEqual(80);
  });
});

describe("TerminalContext Fase 2 (terminalContextLines=0 explícito)", () => {
  it("0 explícito behaves like ausente: solo encabezado, sin fence", () => {
    terminalSessionHub.register(sessionRegistration());
    terminalSessionHub.recordData("s1", MOCKCONSOLE_RAW);

    const block = requestContext.run(
      userContext({ terminalSessionId: "s1", terminalContextLines: 0 }),
      () => buildTerminalSessionBlock(),
      );

    expect(block).not.toContain("```text");
    expect(block).not.toContain("Cisco IOS XE");
  });
});
