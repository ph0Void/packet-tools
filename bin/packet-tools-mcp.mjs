#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const entry = path.join(root, "packages", "mcp", "dist", "app.js");

function build() {
  const result = spawnSync(
    "npm",
    ["run", "build", "--workspace=@packet-tools/mcp"],
    {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    },
  );
  return result.status === 0 && existsSync(entry);
}

if (!existsSync(entry) && !build()) {
  process.stderr.write(
    "[packet-tools-mcp] build failed. Clone the repository and run: npm install && npm run build:mcp\n",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [entry], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
