import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRootEnv, readElectronVersion } from "./env.mjs";
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPTS_DIR, "../../..");
const DESKTOP_DIR = path.join(ROOT_DIR, "packages", "desktop");
const DIST_DIR = path.join(DESKTOP_DIR, "dist");
const IS_WINDOWS = process.platform === "win32";
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";
const NPX = IS_WINDOWS ? "npx.cmd" : "npx";
const PLATFORM_FLAGS = new Set(["--win", "--linux", "--mac"]);
const ARTIFACT_EXTENSIONS = [".exe", ".AppImage", ".deb"];
const childEnv = { ...process.env, ...loadRootEnv(ROOT_DIR) };
function log(message) {
  console.log(`\n[build-desktop] ${message}`);
}
function runCommand(command, args, options = {}) {
  const useCmd = IS_WINDOWS && /\.(cmd|bat)$/i.test(command);
  const binary = useCmd ? process.env.ComSpec || "cmd.exe" : command;
  const finalArgs = useCmd ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  const result = spawnSync(binary, finalArgs, {
    cwd: options.cwd ?? ROOT_DIR,
    stdio: "inherit",
    env: options.env ?? childEnv,
  });
  if (result.error) {
    throw new Error(`No se pudo ejecutar "${command}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`El comando "${command} ${args.join(" ")}" terminó con código ${result.status}.`);
  }
}
function ensureElectron() {
  const electronDist = path.join(ROOT_DIR, "node_modules", "electron", "dist");
  if (fs.existsSync(electronDist)) {
    log("Electron ya está descargado.");
    return;
  }
  const installer = path.join(ROOT_DIR, "node_modules", "electron", "install.js");
  if (!fs.existsSync(installer)) {
    throw new Error("No se encontró node_modules/electron/install.js. Ejecuta `npm install` en la raíz.");
  }
  log("Electron no está descargado; ejecutando instalador (requiere conexión a Internet)...");
  runCommand(process.execPath, [installer], { cwd: ROOT_DIR });
  if (!fs.existsSync(electronDist)) {
    throw new Error("La descarga de Electron terminó pero node_modules/electron/dist sigue sin existir.");
  }
}
function resolvePlatformFlag() {
  const requested = process.argv.slice(2).find((arg) => PLATFORM_FLAGS.has(arg));
  if (requested) return requested;
  if (process.platform === "darwin") return "--mac";
  if (process.platform === "linux") return "--linux";
  return "--win";
}
function listArtifacts() {
  if (!fs.existsSync(DIST_DIR)) return [];
  return fs
    .readdirSync(DIST_DIR)
    .filter((name) => ARTIFACT_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => path.join(DIST_DIR, name));
}
function main() {
  ensureElectron();
  log("Compilando backend (@packet-tools/server)...");
  runCommand(NPM, ["run", "build", "--workspace=@packet-tools/server"], { cwd: ROOT_DIR });
  log("Compilando frontend (@packet-tools/web)...");
  runCommand(NPM, ["run", "build", "--workspace=@packet-tools/web"], { cwd: ROOT_DIR });
  log("Preparando recursos (scripts/prepare.mjs)...");
  runCommand(process.execPath, [path.join(SCRIPTS_DIR, "prepare.mjs")]);
  log("Verificando módulos nativos (scripts/verify-native.mjs)...");
  runCommand(process.execPath, [path.join(SCRIPTS_DIR, "verify-native.mjs")]);
  const isObfuscationEnabled = /^(true|1)$/i.test(
    String(childEnv.DESKTOP_OBFUSCATE ?? "").trim(),
  );
  if (isObfuscationEnabled) {
    log("Ofuscando el staging con bytenode (scripts/obfuscate.mjs)...");
    runCommand(process.execPath, [path.join(SCRIPTS_DIR, "obfuscate.mjs")]);
  }
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  const electronVersion = readElectronVersion(ROOT_DIR);
  const platformFlag = resolvePlatformFlag();
  log(
    `Empaquetando con electron-builder (${platformFlag}, versión ${rootPackage.version}, ` +
      `Electron ${electronVersion})...`,
  );
  runCommand(
    NPX,
    [
      "electron-builder",
      `-c.extraMetadata.version=${rootPackage.version}`,
      `-c.electronVersion=${electronVersion}`,
      platformFlag,
    ],
    {
      cwd: DESKTOP_DIR,
      env: { ...childEnv, NODE_ENV: "production" },
    },
  );
  const artifacts = listArtifacts();
  if (artifacts.length === 0) {
    log(`electron-builder terminó pero no se encontraron instaladores en ${DIST_DIR}.`);
    return;
  }
  log("Instaladores generados:");
  for (const artifact of artifacts) {
    console.log(`  - ${artifact}`);
  }
}
try {
  main();
} catch (error) {
  console.error(`\n[build-desktop] ERROR: ${error.message ?? error}`);
  process.exit(1);
}
