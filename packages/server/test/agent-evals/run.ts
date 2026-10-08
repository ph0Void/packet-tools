

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROUTE_REPORT } from "./rutaInforme";
import type { ResultScenario } from "./escenarios";


const SUITE = "test/agent-evals/evals.test.ts";


function vitestCli(): string {
  const require = createRequire(__filename);
  return join(require.resolve("vitest/package.json").replace(/package\.json$/, ""), "vitest.mjs");
}


function table(filas: string[][]): string {
  if (filas.length === 0) return "";
  const columns = Math.max(...filas.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, index) =>
    Math.max(...filas.map((row) => (row[index] ?? "").length)),
  );
  return filas
    .map((row) =>
      row
        .map((cell, index) =>
          index === row.length - 1 ? cell : cell.padEnd(widths[index]),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}


function icon(ok: boolean): string {
  return ok ? "OK  " : "FALLA";
}


function runSuite(): number {
  const binary = vitestCli();
  const proc = spawnSync(
    process.execPath,
    [binary, "run", SUITE, "--reporter=dot"],
    { stdio: "inherit", cwd: process.cwd(), env: process.env },
  );
  if (proc.error) {
    console.error(`No se pudo lanzar Vitest: ${proc.error.message}`);
    return 1;
  }
  return proc.status ?? 1;
}


function readResults(): ResultScenario[] | null {
  if (!existsSync(ROUTE_REPORT)) return null;
  try {
    const raw = JSON.parse(readFileSync(ROUTE_REPORT, "utf8")) as {
      scenarios?: ResultScenario[];
    };
    return Array.isArray(raw.scenarios) ? raw.scenarios : null;
  } catch (error) {
    console.error(`El informe de evals no se pudo leer: ${String(error)}`);
    return null;
  }
}


function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}


function tableSummary(results: ResultScenario[]): string {
  const filas: string[][] = [["escenario", "calls", "in_tok", "toolCalls", "veredicto"]];
  for (const result of results) {
    const toolCalls = result.measurement.toolCalls
      .map((tool) => `${tool.name}:${tool.status}`)
      .join(", ");
    filas.push([
      result.id,
      String(result.measurement.calls),
      String(result.measurement.inputTokens),
      toolCalls ? truncate(toolCalls, 58) : "-",
      `${icon(result.passes)} ${result.checks.filter((c) => c.ok).length}/${result.checks.length}`,
    ]);
  }
  return table(filas);
}


function detail(results: ResultScenario[]): string {
  const blocks: string[] = [];
  for (const result of results) {
    const lines: string[] = [
      "",
      `── ${result.id} — ${result.title}`,
      `   ${icon(result.passes)}  ${result.passes ? "cumple todos los umbrales" : "INCUMPLE algún umbral"}`,
      `   por qué: ${result.byThat}`,
      `   desglose: calls=${result.measurement.calls} (${JSON.stringify(result.measurement.callsByNode)}) ` +
        `input_tokens=${result.measurement.inputTokens} (${JSON.stringify(result.measurement.inputTokensByNode)}) ` +
        `delegaciones=${result.measurement.delegations} ` +
        `escrituras=${result.measurement.totalWrites} ` +
        `aprobar=${result.measurement.approvals.approved}/rechazar=${result.measurement.approvals.rejected} ` +
        `ruta(fastPath prevista/observada)=${result.measurement.route.predicted}/${result.measurement.route.observed}`,
    ];
    const checks = table(
      result.checks.map((c) => [
        `   ${icon(c.ok)}`,
        c.name,
        `medido=${c.value}`,
        `umbral=${c.threshold}`,
        c.detail ? `(${c.detail})` : "",
      ]),
    );
    lines.push(checks);
    if (result.notas.length > 0) {
      for (const nota of result.notas) lines.push(`   nota: ${nota}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n");
}

function main(): void {

  if (existsSync(ROUTE_REPORT)) rmSync(ROUTE_REPORT);

  const codeSuite = runSuite();
  const results = readResults();

  if (!results) {
    console.error(
      "\nNo se encontró el informe de evals: la suite no llegó a terminar. Revisa el error anterior.",
    );
    process.exit(codeSuite === 0 ? 1 : codeSuite);
  }

  const failed = results.filter((result) => !result.passes);
  console.log(`\n=== EVALS DEL ARNÉS (${results.length} escenarios) ===`);
  console.log(tableSummary(results));
  console.log(detail(results));
  console.log(
    `\nResumen: ${results.length - failed.length}/${results.length} escenarios cumplen sus umbrales.` +
      (failed.length > 0 ? ` Fallan: ${failed.map((r) => r.id).join(", ")}.` : ""),
  );
  console.log(`Métricas: estimadas con estimarTokens/estimarTokensMensajes (≈4 chars/token, agent/deep/metrics.ts).`);


  process.exit(failed.length > 0 || codeSuite !== 0 ? 1 : 0);
}

main();
