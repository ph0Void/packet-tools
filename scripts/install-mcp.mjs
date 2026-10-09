#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_NAME = "packet-tools";
const COMMAND = "npx";
const ARGS = ["-y", "--package=github:ph0Void/packet-tools", "packet-tools-mcp"];

const home = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

function target(name, dir, file, shape) {
  return { name, dir, file, shape };
}

const JSON_SERVERS = "mcpServers";
const JSON_MCP = "mcp";
const JSON_VSCODE = "servers";

const targets = [
  target(
    "Claude Desktop",
    isWin
      ? path.join(appData, "Claude")
      : isMac
        ? path.join(home, "Library", "Application Support", "Claude")
        : path.join(home, ".config", "Claude"),
    "claude_desktop_config.json",
    JSON_SERVERS,
  ),
  target("Claude Code", path.join(process.cwd()), ".mcp.json", JSON_SERVERS),
  target("Cursor", path.join(home, ".cursor"), "mcp.json", JSON_SERVERS),
  target("Windsurf", path.join(home, ".codeium", "windsurf"), "mcp_config.json", JSON_SERVERS),
  target("LM Studio", path.join(home, ".lmstudio"), "mcp.json", JSON_SERVERS),
  target("OpenCode", path.join(home, ".config", "opencode"), "opencode.json", JSON_MCP),
  target(".vscode (workspace)", path.join(process.cwd(), ".vscode"), "mcp.json", JSON_VSCODE),
];

function leerJson(file) {
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { __invalid: true };
  }
}

function entryFor(shape) {
  if (shape === JSON_MCP) {
    return { type: "local", command: [COMMAND, ...ARGS], enabled: true };
  }
  if (shape === JSON_VSCODE) {
    return { type: "stdio", command: COMMAND, args: ARGS };
  }
  return { command: COMMAND, args: ARGS };
}

function install(t) {
  const file = path.join(t.dir, t.file);
  const json = leerJson(file);

  if (json.__invalid) {
    return { name: t.name, file, status: "skipped", reason: "JSON inválido" };
  }

  if (!json[t.shape] || typeof json[t.shape] !== "object") json[t.shape] = {};
  if (json[t.shape][SERVER_NAME]) {
    return { name: t.name, file, status: "already" };
  }

  json[t.shape][SERVER_NAME] = entryFor(t.shape);
  mkdirSync(t.dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return { name: t.name, file, status: "installed" };
}

console.log("Packet Tools MCP — configuración automática\n");
console.log(`Servidor: ${COMMAND} ${ARGS.join(" ")}\n`);

let installed = 0;
for (const t of targets) {
  if (!existsSync(t.dir)) {
    console.log(`  · ${t.name}: no detectado (${t.dir})`);
    continue;
  }
  const result = install(t);
  const icon = result.status === "installed" ? "✓" : result.status === "already" ? "=" : "✗";
  const detail = result.status === "installed" ? "configurado" : result.status === "already" ? "ya estaba" : result.reason;
  console.log(`  ${icon} ${result.name}: ${detail} — ${result.file}`);
  if (result.status === "installed") installed++;
}

console.log(
  [
    "",
    `Listo. ${installed} cliente(s) configurado(s).`,
    "Reinicia el cliente para que cargue el servidor MCP.",
    "Si tu agente no aparece en la lista, añade a mano:",
    `  ${COMMAND} ${ARGS.join(" ")}`,
    "",
    "Recuerda: la integración de Packet Tracer requiere la extensión v1.1.0+.",
  ].join("\n"),
);
