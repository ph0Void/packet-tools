

import { describe, expect, it } from "vitest";
import {
  KNOWN_SUBAGENTS,
  TASK_TOOL_NAME,
  resolveHandoffTarget,
  resolveTaskBrief,
} from "@/agent/deep/handoff";

describe("traducción de delegación Deep Agents → SSE", () => {
  it("mapea cada sub-agente de red al nombre corto histórico", () => {
    const casos: Array<[string, string]> = [
      ["packet_tracer_specialist", "packet_tracer"],
      ["gns3_specialist", "gns3"],
      ["ssh_specialist", "ssh"],
      ["telnet_specialist", "telnet"],
      ["serial_specialist", "serial"],
    ];
    for (const [subagent, esperado] of casos) {
      expect(
        resolveHandoffTarget(TASK_TOOL_NAME, { subagent_type: subagent }),
      ).toBe(esperado);
    }
  });

  it("ignora tools que no son la task nativa", () => {
    expect(
      resolveHandoffTarget("send_command", { subagent_type: "ssh_specialist" }),
    ).toBeNull();
  });

  it("tolera input ausente, nulo o sin subagent_type", () => {
    expect(resolveHandoffTarget(TASK_TOOL_NAME, null)).toBeNull();
    expect(resolveHandoffTarget(TASK_TOOL_NAME, {})).toBeNull();
    expect(resolveHandoffTarget(TASK_TOOL_NAME, { subagent_type: 42 })).toBeNull();
  });

  it("cae al nombre del sub-agente si no está en el mapa", () => {
    expect(
      resolveHandoffTarget(TASK_TOOL_NAME, { subagent_type: "nuevo_agente" }),
    ).toBe("nuevo_agente");
  });

  it("extrae el brief de la tarea delegada", () => {
    expect(
      resolveTaskBrief({ description: "Configurar OSPF en R1" }),
    ).toBe("Configurar OSPF en R1");
    expect(resolveTaskBrief({})).toBe("");
    expect(resolveTaskBrief(null)).toBe("");
  });

  it("expone el catálogo de sub-agentes conocidos", () => {
    expect(KNOWN_SUBAGENTS).toContain("packet_tracer_specialist");
    expect(KNOWN_SUBAGENTS).toContain("general-purpose");
  });
});
