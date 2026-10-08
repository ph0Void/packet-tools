

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SCENARIOS, runScenario, type ResultScenario } from "./escenarios";
import { clearIsolation } from "./harness";
import { ROUTE_REPORT } from "./rutaInforme";


vi.mock("@/agent/Model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/agent/Model")>();
  const modelFake = async (): Promise<unknown> => {
    const { scriptInstalled, newModelFake } = await import("./modeloFalso");
    if (!scriptInstalled()) {
      throw new Error(
        "El eval llegó a construir un modelo sin guion: el escenario no llamó a activarGuion() (se llama dentro de ejecutarTurno).",
      );
    }
    return newModelFake();
  };
  return {
    ...original,
    getModelProvider: async (...args: unknown[]) => {
      await modelFake();
      return original.getModelProvider(...(args as [string | undefined, string]));
    },
    getModelProviderWithMeta: async (...args: unknown[]) => {
      const model = await modelFake();
      
      
      return { model: model, provider: "CUSTOM" };
    },
  };
});


const results: ResultScenario[] = [];

beforeEach(() => {
  clearIsolation();
});

afterAll(() => {
  clearIsolation();
  vi.restoreAllMocks();
  mkdirSync(dirname(ROUTE_REPORT), { recursive: true });
  writeFileSync(
    ROUTE_REPORT,
    JSON.stringify(
      {
        generatedEn: new Date().toISOString(),
        scenarios: results,
      },
      null,
      2,
    ),
    "utf8",
  );
});

describe("evals del arnés agéntico (Fase 6)", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const result = await runScenario(scenario);
      results.push(result);

      const failures = result.checks.filter((check) => !check.ok);
      const detail = [
        `${scenario.id} — umbral incumplido:`,
        ...failures.map(
          (check) =>
            `  · ${check.name}: medido ${check.value}, umbral ${check.threshold}` +
            (check.detail ? ` (${check.detail})` : ""),
        ),
        `  métricas: llm.calls=${result.measurement.calls}, input_tokens=${result.measurement.inputTokens}, ` +
          `toolCalls=[${result.measurement.toolCalls.map((tool) => `${tool.name}:${tool.status}`).join(", ")}]`,
      ].join("\n");

      expect(failures, detail).toHaveLength(0);
    }, 120_000);
  }

  it("todos los escenarios fijan el objetivo de llamadas del plan", () => {
    
    const ids = SCENARIOS.map((scenario) => scenario.id);
    for (const requiredid of [
      "consulta-simple-consola",
      "delegacion-pt",
      "tool-falla-definitivo",
      "aprobacion-rechazada",
      "pregunta-teorica",
      "tool-duplicada",
      "delegacion-resultado-en-stream",
    ]) {
      expect(ids, `falta el escenario obligatorio ${requiredid}`).toContain(requiredid);
    }
  });
});
