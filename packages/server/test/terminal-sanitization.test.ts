

import { describe, expect, it } from "vitest";
import {
  classifyCommandRisk,
  classifyCommands,
} from "@/agent/security/CommandClassifier";
import { sanitizeCommandsForPrompt } from "@/agent/terminal/sanitizeCommands";

describe("CommandClassifier: riesgo multilínea (regresión)", () => {
  it("un exit en la segunda línea manda aunque el lote venga multilínea", () => {
    
    
    expect(classifyCommandRisk("show version\nexit", "R1#")).toBe(
      "sessionControl",
    );
  });

  it("un reload embebido en la segunda línea eleva el riesgo a dangerous", () => {
    
    expect(classifyCommandRisk("show version\nreload", "R1#")).toBe(
      "dangerous",
    );
  });

  it("en sub-modo anidado el exit de la segunda línea está permitido", () => {
    
    
    expect(classifyCommandRisk("show version\nexit", "R1(config)#")).toBe(
      "config",
    );
  });

  it("reconoce la abreviatura Cisco wr erase como dangerous", () => {
    expect(classifyCommandRisk("wr erase")).toBe("dangerous");
  });

  it("classifyCommands desglosa el multilínea y detecta el exit interno", () => {
    const lote = classifyCommands(["show version\nexit"], "R1#");

    expect(lote.sessionCommands).toContain("exit");
    expect(lote.level).toBe("config");
  });
});

describe("sanitizeCommandsForPrompt: aplanado multilínea (regresión)", () => {
  it("aplana el lote y elimina el exit en prompt raíz", () => {
    const { commands, removed } = sanitizeCommandsForPrompt(
      ["show version\nexit"],
      "R1#",
    );

    expect(commands).toContain("show version");
    expect(commands).not.toContain("exit");
    expect(removed).toContain("exit");
  });

  it("en sub-modo anidado conserva show version y quit", () => {
    const { commands, removed } = sanitizeCommandsForPrompt(
      ["show version\nquit"],
      "R1(config-if)#",
    );

    expect(commands).toContain("show version");
    expect(commands).toContain("quit");
    expect(removed).toEqual([]);
  });

  it("conserva los comandos dangerous: la aprobación HITL los gestiona", () => {
    const { commands, removed } = sanitizeCommandsForPrompt(["reload"], "R1#");

    expect(commands).toContain("reload");
    expect(removed).toEqual([]);
  });
});
