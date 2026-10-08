import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./env.mjs";
import { prepareNodeRuntime } from "./node-runtime.mjs";
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPTS_DIR, "../../..");
const DESKTOP_DIR = path.join(ROOT_DIR, "packages", "desktop");
const STAGING_DIR = path.join(DESKTOP_DIR, ".staging");
const RESOURCES_DIR = path.join(STAGING_DIR, "resources");
const SERVER_DIR = path.join(ROOT_DIR, "packages", "server");
const WEB_DIR = path.join(ROOT_DIR, "packages", "web");
const ROOT_NODE_MODULES_DIR = path.join(ROOT_DIR, "node_modules");
const SERVER_NODE_MODULES_DIR = path.join(SERVER_DIR, "node_modules");
const SERVER_PORT = 7531;
const WEB_PORT = 3090;
const BACKEND_URL = `http://localhost:${SERVER_PORT}`;
const EXCLUDED_PACKAGES = new Set(["chromadb", "ffmpeg-static", "fluent-ffmpeg"]);
const CHROMADB_BINDINGS_PREFIX = "chromadb-js-bindings-";
function log(message) {
  console.log(`[prepare] ${message}`);
}
function fail(message) {
  throw new Error(`[prepare] ${message}`);
}
function isInside(container, targetPath) {
  const relativePath = path.relative(container, targetPath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
export function getPackageNames(relativePath) {
  const parts = relativePath.split(path.sep);
  const names = [];
  let index = 0;
  while (index < parts.length) {
    let name = parts[index];
    if (name.startsWith("@") && index + 1 < parts.length) {
      name = `${name}/${parts[index + 1]}`;
      index += 2;
    } else {
      index += 1;
    }
    names.push(name);
    while (index < parts.length && parts[index] !== "node_modules") index += 1;
    if (index < parts.length) index += 1;
  }
  return names;
}
function isExcludedPackage(name) {
  return EXCLUDED_PACKAGES.has(name) || name.startsWith(CHROMADB_BINDINGS_PREFIX);
}
function getDirectorySize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(filePath);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(filePath).size;
        } catch {
        }
      }
    }
  }
  return total;
}
function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function copyDirectory(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}
function validateArtifacts() {
  const missing = [];
  if (!fs.existsSync(path.join(SERVER_DIR, "dist", "app.js"))) {
    missing.push("packages/server/dist/app.js");
  }
  if (!fs.existsSync(path.join(SERVER_DIR, "dist", "desktop", "Bootstrap.js"))) {
    missing.push("packages/server/dist/desktop/Bootstrap.js");
  }
  if (!fs.existsSync(path.join(WEB_DIR, ".next", "standalone"))) {
    missing.push("packages/web/.next/standalone");
  }
  if (!fs.existsSync(path.join(WEB_DIR, ".next", "static"))) {
    missing.push("packages/web/.next/static");
  }
  if (!fs.existsSync(path.join(SERVER_DIR, "prisma", "migrations"))) {
    missing.push("packages/server/prisma/migrations");
  }
  if (missing.length > 0) {
    fail(
      `Faltan artefactos de compilación (${missing.join(", ")}). ` +
        "Ejecuta `npm run build-desktop` completo desde la raíz del monorepo " +
        "(compila server y web antes de preparar los recursos).",
    );
  }
}
export function selectProductionDependencies() {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "npm.cmd" : "npm";
  const args = ["ls", "--omit=dev", "--all", "--parseable", "--workspace=@packet-tools/server"];
  const useCmd = isWindows;
  const binary = useCmd ? process.env.ComSpec || "cmd.exe" : command;
  const finalArgs = useCmd ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  const result = spawnSync(binary, finalArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    fail(`No se pudo ejecutar \`npm ls\`: ${result.error.message}`);
  }
  const lines = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    fail("`npm ls` no devolvió rutas; revisa las dependencias del workspace del server.");
  }
  const selection = new Map();
  for (const line of lines) {
    if (!path.isAbsolute(line)) continue;
    const source = path.normalize(line);
    let relativePath = null;
    if (isInside(ROOT_NODE_MODULES_DIR, source)) {
      relativePath = path.relative(ROOT_NODE_MODULES_DIR, source);
    } else if (isInside(SERVER_NODE_MODULES_DIR, source)) {
      relativePath = path.relative(SERVER_NODE_MODULES_DIR, source);
    } else {
      continue;
    }
    if (!relativePath || relativePath.startsWith("..")) continue;
    const names = getPackageNames(relativePath);
    if (names.some(isExcludedPackage)) continue;
    let stats;
    try {
      stats = fs.lstatSync(source);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
    selection.set(relativePath.toLowerCase(), { source, relativePath });
  }
  return [...selection.values()];
}
const IMPORT_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];
function* walkJsFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsFiles(filePath);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield filePath;
  }
}
export function getImportedPackages(distDir) {
  const packages = new Set();
  for (const file of walkJsFiles(distDir)) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const specifier = match[1];
        if (
          !specifier ||
          specifier.startsWith(".") ||
          specifier.startsWith("/") ||
          specifier.startsWith("node:") ||
          specifier.startsWith("@/")
        ) {
          continue;
        }
        packages.add(
          specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0],
        );
      }
    }
  }
  return packages;
}
function resolvePackage(name, baseDir) {
  const packagePath = path.join(baseDir, ...name.split("/"));
  return fs.existsSync(path.join(packagePath, "package.json")) ? packagePath : null;
}
function getDeclaredDependencies(packagePath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packagePath, "package.json"), "utf8"));
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}
export function completeWithDistImports(selection, distDir) {
  const includedNames = new Set();
  for (const { relativePath } of selection) {
    for (const name of getPackageNames(relativePath)) includedNames.add(name.toLowerCase());
  }
  const extras = new Map();
  const queue = [...getImportedPackages(distDir)].map((name) => ({
    name,
    base: ROOT_NODE_MODULES_DIR,
  }));
  while (queue.length > 0) {
    const { name, base } = queue.pop();
    const key = name.toLowerCase();
    if (includedNames.has(key) || extras.has(key)) continue;
    const source = resolvePackage(name, base) ?? resolvePackage(name, ROOT_NODE_MODULES_DIR);
    if (!source) continue;
    extras.set(key, { source, relativePath: path.relative(ROOT_NODE_MODULES_DIR, source) });
    for (const dep of getDeclaredDependencies(source)) {
      queue.push({ name: dep, base: path.join(source, "node_modules") });
    }
  }
  return [...extras.values()];
}
function writeBuildInfo() {
  const rootEnv = loadRootEnv(ROOT_DIR);
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  const name = rootEnv.NAME || rootPackage.name || "Packet Tools";
  const version = rootPackage.version || rootEnv.VERSION || "0.0.0";
  const info = {
    name,
    version,
    serverPort: SERVER_PORT,
    webPort: WEB_PORT,
    backendUrl: BACKEND_URL,
  };
  fs.writeFileSync(
    path.join(RESOURCES_DIR, "build-info.json"),
    `${JSON.stringify(info, null, 2)}\n`,
    "utf8",
  );
  return info;
}
function locateWebServer(webBase) {
  const candidates = [];
  const pending = [webBase];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        pending.push(filePath);
      } else if (entry.isFile() && entry.name === "server.js") {
        candidates.push(filePath);
      }
    }
  }
  if (candidates.length === 0) {
    fail(`No se encontró server.js del frontend dentro de ${webBase}.`);
  }
  const scorePath = (filePath) => {
    let score = 0;
    if (fs.existsSync(path.join(path.dirname(filePath), ".next"))) score += 10;
    if (filePath.endsWith(path.join("packages", "web", "server.js"))) score += 5;
    return score;
  };
  candidates.sort((a, b) => scorePath(b) - scorePath(a));
  return candidates[0];
}
async function main() {
  log(`Limpiando ${STAGING_DIR}...`);
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  validateArtifacts();
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  const serverTarget = path.join(RESOURCES_DIR, "server");
  fs.mkdirSync(serverTarget, { recursive: true });
  log("Copiando packages/server/dist -> server/dist...");
  copyDirectory(path.join(SERVER_DIR, "dist"), path.join(serverTarget, "dist"));
  log("Copiando packages/server/prisma/migrations -> server/migrations...");
  copyDirectory(path.join(SERVER_DIR, "prisma", "migrations"), path.join(serverTarget, "migrations"));
  fs.writeFileSync(
    path.join(serverTarget, "package.json"),
    `${JSON.stringify(
      { name: "packet-tools-server", version: "1.0.0", private: true },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const dependencies = selectProductionDependencies();
  const distExtras = completeWithDistImports(dependencies, path.join(SERVER_DIR, "dist"));
  if (distExtras.length > 0) {
    log(
      `Dependencias extra por imports de dist: ${distExtras
        .map(({ relativePath }) => relativePath.replace(/\\/g, "/"))
        .join(", ")}`,
    );
  }
  const allDependencies = [...dependencies, ...distExtras];
  const nodeModulesTarget = path.join(serverTarget, "node_modules");
  fs.mkdirSync(nodeModulesTarget, { recursive: true });
  log(`Copiando ${allDependencies.length} paquetes de producción del server...`);
  let copied = 0;
  for (const { source, relativePath } of allDependencies) {
    const target = path.join(nodeModulesTarget, relativePath);
    try {
      copyDirectory(source, target);
      copied += 1;
    } catch (err) {
      log(`  ADVERTENCIA: no se pudo copiar ${relativePath}: ${err.message}`);
    }
  }
  log(`Paquetes copiados: ${copied}/${allDependencies.length}`);
  const webTarget = path.join(RESOURCES_DIR, "web");
  log("Copiando packages/web/.next/standalone -> web...");
  copyDirectory(path.join(WEB_DIR, ".next", "standalone"), webTarget);
  const serverJs = locateWebServer(webTarget);
  const webDir = path.dirname(serverJs);
  log(`Entrypoint del frontend: ${path.relative(RESOURCES_DIR, serverJs)}`);
  log("Copiando .next/static y public al directorio del standalone...");
  copyDirectory(
    path.join(WEB_DIR, ".next", "static"),
    path.join(webDir, ".next", "static"),
  );
  const publicSource = path.join(WEB_DIR, "public");
  if (fs.existsSync(publicSource)) {
    copyDirectory(publicSource, path.join(webDir, "public"));
  } else {
    log("ADVERTENCIA: packages/web/public no existe; se omite.");
  }
  await prepareNodeRuntime(RESOURCES_DIR);
  const buildInfo = writeBuildInfo();
  log(
    `build-info.json: name="${buildInfo.name}" version="${buildInfo.version}" ` +
      `serverPort=${buildInfo.serverPort} webPort=${buildInfo.webPort}`,
  );
  const rows = [
    ["resources (total)", RESOURCES_DIR],
    ["node (runtime)", path.join(RESOURCES_DIR, "node")],
    ["server/dist", path.join(serverTarget, "dist")],
    ["server/migrations", path.join(serverTarget, "migrations")],
    ["server/node_modules", nodeModulesTarget],
    ["web/packages/web/.next", path.join(webDir, ".next")],
    ["web/node_modules", path.join(webTarget, "node_modules")],
  ];
  console.log("\n[prepare] Resumen de tamaños:");
  for (const [label, dirPath] of rows) {
    if (!fs.existsSync(dirPath)) continue;
    console.log(`  ${label.padEnd(26)} ${formatMB(getDirectorySize(dirPath))}`);
  }
  log("Recursos listos en .staging/resources.");
}
const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isEntrypoint) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
