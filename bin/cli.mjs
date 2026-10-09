#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);

function run(scriptPath, label) {
  console.log(label);
  const child = spawn(process.execPath, [scriptPath], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (args.includes("--mcp") || args.includes("mcp")) {
  run(path.join(here, "packet-tools-mcp.mjs"), "Iniciando servidor MCP de Packet Tools...");
} else if (args.includes("--install-mcp")) {
  run(path.join(root, "scripts", "install-mcp.mjs"), "Configurando Packet Tools MCP en tus agentes...");
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Packet Tools CLI",
      "",
      "  packet-tools --mcp           Arranca el servidor MCP (stdio)",
      "  packet-tools --install-mcp   Detecta y configura tus agentes de código",
      "  packet-tools --help          Muestra esta ayuda",
      "",
      "La vía recomendada para integrar el MCP es declararlo en tu cliente:",
      '  npx -y --package=github:ph0Void/packet-tools packet-tools-mcp',
      "",
      "Detalle: https://github.com/ph0Void/packet-tools/blob/main/packages/mcp/README.md",
    ].join("\n"),
  );
} else {
  console.log(
    "Packet Tools CLI — usa 'packet-tools --help'. Para el servidor MCP: 'packet-tools --mcp'.",
  );
}
