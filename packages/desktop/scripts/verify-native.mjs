import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPTS_DIR, "../../..");
const RESOURCES_DIR = path.join(ROOT_DIR, "packages", "desktop", ".staging", "resources");
const STAGED_SERVER_DIR = path.join(RESOURCES_DIR, "server");
const NODE_BIN_PATH = path.join(
  RESOURCES_DIR,
  "node",
  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
);
const MODULES_TO_VERIFY = ["better-sqlite3", "serialport"];
function log(message) {
  console.log(`[verify-native] ${message}`);
}
function main() {
  if (!fs.existsSync(NODE_BIN_PATH)) {
    throw new Error(
      `No se encontró el runtime de Node empaquetado en ${NODE_BIN_PATH}. ` +
        "Ejecuta `npm run build-desktop` completo (scripts/prepare.mjs lo copia).",
    );
  }
  for (const moduleName of MODULES_TO_VERIFY) {
    const modulePath = path.join(STAGED_SERVER_DIR, "node_modules", ...moduleName.split("/"));
    if (!fs.existsSync(modulePath)) {
      throw new Error(`No se encontró ${moduleName} en ${modulePath}; revisa el staging de dependencias.`);
    }
  }
  const snippet = `
    const names = ${JSON.stringify(MODULES_TO_VERIFY)};
    for (const name of names) {
      await import(name);
    }
    console.log("NODE_MODULE_VERSION=" + process.versions.modules + " node=" + process.version);
  `;
  log(`Probando módulos nativos con el Node empaquetado (${NODE_BIN_PATH})...`);
  const result = spawnSync(NODE_BIN_PATH, ["--input-type=module", "-e", snippet], {
    cwd: STAGED_SERVER_DIR,
    encoding: "utf8",
    timeout: 60000,
  });
  if (result.error) {
    throw new Error(`No se pudo ejecutar el Node empaquetado: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Los módulos nativos fallaron con el Node empaquetado (código ${result.status}).\n` +
        `${result.stderr?.trim() || result.stdout?.trim() || "(sin salida)"}\n\n` +
        "Suele indicar que node_modules se instaló con otra versión de Node. " +
        "Ejecuta `npm install` con el Node actual y vuelve a compilar el instalador.",
    );
  }
  log(`Módulos OK: ${MODULES_TO_VERIFY.join(", ")} (${result.stdout.trim().split("\n").pop()}).`);
}
try {
  main();
} catch (err) {
  console.error(`[verify-native] ${err.message ?? err}`);
  process.exit(1);
}
