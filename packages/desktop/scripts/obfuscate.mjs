import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./env.mjs";
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPTS_DIR, "../../..");
const DESKTOP_DIR = path.join(ROOT_DIR, "packages", "desktop");
const STAGING_RESOURCES_DIR = path.join(DESKTOP_DIR, ".staging", "resources");
const SUMMARY_MARKER = "OBF_JSON:";
const SMOKE_MARKER = "OBF_SMOKE:";
const MAX_BATCH_LENGTH = 20000;
const BATCH_TIMEOUT_MS = 600000;
const BACKEND_SMOKE_FILES = [
  path.join("server", "dist", "utils", "Logger.js"),
  path.join("server", "dist", "utils", "FormatDate.js"),
  path.join("server", "dist", "utils", "RequestContext.js"),
];
function log(message) {
  console.log(`[obfuscate] ${message}`);
}
function fail(message) {
  throw new Error(message);
}
function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
function parseArgs(argv) {
  const options = { root: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        fail("El argumento --root necesita una ruta como valor.");
      }
      options.root = value;
      i += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else {
      fail(`Argumento desconocido: ${arg} (usa --root <dir> o --force).`);
    }
  }
  return options;
}
function isObfuscationEnabled() {
  const rootEnv = loadRootEnv(ROOT_DIR);
  const value = String(rootEnv.DESKTOP_OBFUSCATE ?? process.env.DESKTOP_OBFUSCATE ?? "").trim();
  return /^(true|1)$/i.test(value);
}
function* walkFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(filePath);
    else if (entry.isFile()) yield filePath;
  }
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
  if (candidates.length === 0) return null;
  const scorePath = (filePath) => {
    let score = 0;
    if (fs.existsSync(path.join(path.dirname(filePath), ".next"))) score += 10;
    if (filePath.endsWith(path.join("packages", "web", "server.js"))) score += 5;
    return score;
  };
  candidates.sort((a, b) => scorePath(b) - scorePath(a));
  return candidates[0];
}
function splitBatches(paths, maxLength, prefixLength) {
  const batches = [];
  let current = [];
  let length = prefixLength;
  for (const filePath of paths) {
    const extra = filePath.length + 1;
    if (current.length > 0 && length + extra > maxLength) {
      batches.push(current);
      current = [];
      length = prefixLength;
    }
    current.push(filePath);
    length += extra;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
function buildWorkerSource(bytenodePath) {
  return `"use strict";
const bytenode = require(${JSON.stringify(bytenodePath)});
const fs = require("node:fs");
const path = require("node:path");
const summary = { compiled: 0, skipped: 0, bytesBefore: 0, bytesAfter: 0, errors: [] };
function buildStub(jscPath) {
  const target = JSON.stringify("./" + path.basename(jscPath));
  return ['require("bytenode");', "module.exports = require(" + target + ");", ""].join("\\n");
}
async function compileFile(file) {
  const bytesBefore = fs.statSync(file).size;
  const output = file.slice(0, -path.extname(file).length) + ".jsc";
  await bytenode.compileFile({
    filename: file,
    output: output,
    compileAsModule: true,
    compress: true,
  });
  const stub = buildStub(output);
  fs.writeFileSync(file, stub, "utf8");
  summary.compiled += 1;
  summary.bytesBefore += bytesBefore;
  summary.bytesAfter += fs.statSync(output).size + Buffer.byteLength(stub);
}
async function main() {
  for (const file of process.argv.slice(2)) {
    try {
      const output = file.slice(0, -path.extname(file).length) + ".jsc";
      if (fs.readFileSync(file, "utf8").startsWith('require("bytenode");')) {
        if (!fs.existsSync(output)) {
          throw new Error("stub sin .jsc correspondiente; re-ejecuta prepare.mjs y vuelve a ofuscar");
        }
        summary.skipped += 1;
        continue;
      }
      await compileFile(file);
    } catch (err) {
      summary.errors.push(file + ": " + (err && err.message ? err.message : String(err)));
    }
  }
}
main()
  .then(function () {
    process.stdout.write("\\n${SUMMARY_MARKER}" + JSON.stringify(summary) + "\\n");
    if (summary.errors.length > 0) process.exitCode = 1;
  })
  .catch(function (err) {
    process.stderr.write("[obfuscate-worker] " + (err && err.stack ? err.stack : err) + "\\n");
    process.exitCode = 1;
  });
`;
}
function extractSummary(text) {
  if (!text) return null;
  const line = String(text)
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith(SUMMARY_MARKER));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(SUMMARY_MARKER.length));
  } catch {
    return null;
  }
}
function runWorker(binary, workerPath, batch, resourcesDir) {
  const result = spawnSync(binary, [workerPath, ...batch], {
    cwd: resourcesDir,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
    timeout: BATCH_TIMEOUT_MS,
  });
  if (result.error) {
    fail(`No se pudo ejecutar el worker de ofuscación: ${result.error.message}`);
  }
  const summary = extractSummary(result.stdout);
  if (result.status !== 0) {
    const details = summary?.errors?.length
      ? summary.errors.join("\n  ")
      : String(result.stderr || result.stdout || "(sin salida)").trim();
    fail(`El worker de ofuscación terminó con código ${result.status}:\n  ${details}`);
  }
  if (!summary) {
    fail(
      `El worker de ofuscación no devolvió resumen JSON.\n` +
        `stdout: ${String(result.stdout ?? "").trim()}\n` +
        `stderr: ${String(result.stderr ?? "").trim()}`,
    );
  }
  return summary;
}
function accumulate(total, summary) {
  total.compiled += summary.compiled ?? 0;
  total.skipped += summary.skipped ?? 0;
  total.bytesBefore += summary.bytesBefore ?? summary.bytesAntes ?? 0;
  total.bytesAfter += summary.bytesAfter ?? summary.bytesDespues ?? 0;
}
function deleteSourceMaps(dir) {
  let deleted = 0;
  for (const filePath of walkFiles(dir)) {
    if (!filePath.endsWith(".js.map")) continue;
    try {
      fs.rmSync(filePath, { force: true });
      deleted += 1;
    } catch (err) {
      log(`ADVERTENCIA: no se pudo borrar ${filePath}: ${err.message}`);
    }
  }
  return deleted;
}
function resolveBytenodeSource() {
  const monorepoRequire = createRequire(import.meta.url);
  let resolved;
  try {
    resolved = monorepoRequire.resolve("bytenode");
  } catch {
    fail("No se encontró bytenode en node_modules. Ejecuta `npm install` en la raíz del monorepo.");
  }
  const packageDir = path.dirname(path.dirname(resolved));
  if (!fs.existsSync(path.join(packageDir, "package.json"))) {
    fail(`La ruta resuelta de bytenode no parece un paquete: ${packageDir}`);
  }
  return packageDir;
}
function copyBytenode(source, targets) {
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    log(`bytenode copiado a ${target}`);
  }
}
function verifyResolution(zonePath, label) {
  const zoneRequire = createRequire(path.join(zonePath, "index.js"));
  try {
    const resolved = zoneRequire.resolve("bytenode");
    log(`bytenode resuelto desde ${label}: ${resolved}`);
  } catch (err) {
    fail(`bytenode NO se resuelve desde ${label}: ${err.message}`);
  }
}
function pickBackendSmoke(resourcesDir) {
  for (const relativePath of BACKEND_SMOKE_FILES) {
    const filePath = path.join(resourcesDir, relativePath);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}
function pickFrontendSmoke(webBase) {
  const candidates = [
    path.join(webBase, ".next", "server", "chunks", "ssr", "[turbopack]_runtime.js"),
    path.join(webBase, ".next", "server", "chunks", "[turbopack]_runtime.js"),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  const chunksDir = path.join(webBase, ".next", "server", "chunks");
  for (const filePath of walkFiles(chunksDir)) {
    if (!filePath.endsWith(".js")) continue;
    if (path.basename(filePath).toLowerCase().includes("manifest")) continue;
    return filePath;
  }
  return null;
}
function runSmoke(binary, resourcesDir, targets) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obfuscate-smoke-"));
  try {
    const scriptPath = path.join(tempDir, "smoke.js");
    fs.writeFileSync(
      scriptPath,
      `"use strict";
const targets = ${JSON.stringify(targets, null, 2)};
const failures = [];
for (const filePath of targets) {
  try {
    require(filePath);
    process.stdout.write("OK " + filePath + "\\n");
  } catch (err) {
    failures.push(filePath);
    process.stderr.write("FALLO " + filePath + ": " + (err && err.stack ? err.stack : err) + "\\n");
  }
}
if (failures.length > 0) {
  process.stderr.write(${JSON.stringify(SMOKE_MARKER)} + "fallos=" + failures.length + "\\n");
  process.exitCode = 1;
} else {
  process.stdout.write(${JSON.stringify(SMOKE_MARKER)} + "ok=" + targets.length + "\\n");
}
`,
      "utf8",
    );
    const result = spawnSync(binary, [scriptPath], {
      cwd: resourcesDir,
      encoding: "utf8",
      shell: false,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
    });
    if (result.error) {
      fail(`No se pudo ejecutar el harness de humo: ${result.error.message}`);
    }
    const output = String(result.stdout ?? "").trim();
    if (output) log(`Humo:\n${output.split("\n").map((entry) => `  ${entry}`).join("\n")}`);
    if (result.status !== 0) {
      fail(
        `El harness de humo falló (código ${result.status}).\n` +
          `${String(result.stderr ?? "").trim() || output}\n` +
          "Si el error es `cachedDataRejected`, el .jsc no coincide con el V8 del " +
          "binario usado para compilar: revisa el Node empaquetado.",
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
function resolveNodeBinary(resourcesDir, allowFallback) {
  const relativePath = process.platform === "win32" ? "node.exe" : path.join("bin", "node");
  const nodePath = path.join(resourcesDir, "node", relativePath);
  if (fs.existsSync(nodePath)) {
    log(`Node empaquetado: ${nodePath}`);
    return nodePath;
  }
  if (allowFallback) {
    log(
      `ADVERTENCIA: no existe ${nodePath}; se usa el Node del sistema (${process.execPath}). ` +
        "Solo es válido para fixtures/pruebas: el bytecode debe compilarlo el Node empaquetado.",
    );
    return process.execPath;
  }
  fail(
    `No se encontró el runtime de Node empaquetado en ${nodePath}. ` +
      "Ejecuta el pipeline completo (scripts/prepare.mjs + verify-native.mjs).",
  );
  return null;
}
function verifyCommonjsOutput(distDir) {
  const packagePath = path.join(distDir, "package.json");
  if (!fs.existsSync(packagePath)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (err) {
    log(`ADVERTENCIA: no se pudo leer ${packagePath}: ${err.message}`);
    return;
  }
  if (data.type === "module") {
    fail(
      `${packagePath} declara "type": "module": bytenode solo compila CJS ` +
        "(Module.wrap + vm.Script). Falta la fase 1 del plan (migración ESM -> CJS " +
        "y scripts/postbuild.mjs, que reescribe este package.json a commonjs).",
    );
  }
}
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.force && !isObfuscationEnabled()) {
    log("DESKTOP_OBFUSCATE no está activo; se omite la ofuscación.");
    return;
  }
  const resourcesDir = options.root ? path.resolve(options.root) : STAGING_RESOURCES_DIR;
  if (!fs.existsSync(resourcesDir)) {
    fail(
      `No existe el staging de recursos en ${resourcesDir}. ` +
        "Ejecuta `npm run build-desktop` (scripts/prepare.mjs) antes de ofuscar.",
    );
  }
  log(`Raíz de recursos: ${resourcesDir}`);
  const distDir = path.join(resourcesDir, "server", "dist");
  if (!fs.existsSync(distDir)) {
    fail(`No existe el backend compilado en ${distDir}.`);
  }
  verifyCommonjsOutput(distDir);
  const webDir = path.join(resourcesDir, "web");
  const serverJs = locateWebServer(webDir);
  if (!serverJs) {
    fail(`No se encontró el server.js del standalone bajo ${webDir}.`);
  }
  const webBase = path.dirname(serverJs);
  const backendFiles = [...walkFiles(distDir)].filter((filePath) => filePath.endsWith(".js"));
  const nextServerDir = path.join(webBase, ".next", "server");
  const frontendFiles = [...walkFiles(nextServerDir)].filter(
    (filePath) =>
      filePath.endsWith(".js") &&
      !path.basename(filePath).toLowerCase().includes("manifest"),
  );
  if (fs.existsSync(serverJs)) frontendFiles.unshift(serverJs);
  if (backendFiles.length === 0 && frontendFiles.length === 0) {
    log("No hay ficheros .js que compilar; nada que hacer.");
    return;
  }
  const binary = resolveNodeBinary(resourcesDir, !!options.root);
  const bytenodeSource = resolveBytenodeSource();
  log(
    `A compilar: backend ${backendFiles.length} .js, ` +
      `frontend ${frontendFiles.length} .js (manifest excluidos).`,
  );
  const total = { compiled: 0, skipped: 0, bytesBefore: 0, bytesAfter: 0 };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obfuscate-"));
  try {
    const workerPath = path.join(tempDir, "worker.js");
    fs.writeFileSync(workerPath, buildWorkerSource(bytenodeSource), "utf8");
    const prefix = `"${binary}" "${workerPath}" `;
    const zones = [
      ["backend", backendFiles],
      ["frontend", frontendFiles],
    ];
    for (const [label, files] of zones) {
      if (files.length === 0) continue;
      const batches = splitBatches(files, MAX_BATCH_LENGTH, prefix.length);
      log(`${label}: ${files.length} ficheros en ${batches.length} lote(s)...`);
      let zoneCompiled = 0;
      for (const batch of batches) {
        const summary = runWorker(binary, workerPath, batch, resourcesDir);
        accumulate(total, summary);
        zoneCompiled += summary.compiled ?? 0;
      }
      log(`${label}: ${zoneCompiled} .jsc generados.`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  log(
    `Compilados: ${total.compiled} (.jsc), ya ofuscados: ${total.skipped}, ` +
      `${formatKilobytes(total.bytesBefore)} de .js -> ${formatKilobytes(total.bytesAfter)} en .jsc + stubs.`,
  );
  if (total.compiled === 0 && total.skipped === 0) {
    fail("No se compiló ningún fichero.");
  }
  const backendMaps = deleteSourceMaps(distDir);
  const frontendMaps = deleteSourceMaps(nextServerDir);
  let rootFrontendMaps = 0;
  for (const entry of fs.readdirSync(webBase, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js.map")) continue;
    fs.rmSync(path.join(webBase, entry.name), { force: true });
    rootFrontendMaps += 1;
  }
  log(
    `Source maps eliminados: ${backendMaps + frontendMaps + rootFrontendMaps} ` +
      `(backend ${backendMaps}, frontend ${frontendMaps + rootFrontendMaps}).`,
  );
  copyBytenode(bytenodeSource, [
    path.join(resourcesDir, "server", "node_modules", "bytenode"),
    path.join(resourcesDir, "web", "node_modules", "bytenode"),
  ]);
  verifyResolution(path.join(resourcesDir, "server", "dist"), "server/dist");
  verifyResolution(webBase, path.relative(resourcesDir, webBase) || "web");
  if (fs.existsSync(nextServerDir)) {
    verifyResolution(nextServerDir, path.relative(resourcesDir, nextServerDir));
  }
  const targets = [pickBackendSmoke(resourcesDir), pickFrontendSmoke(webBase)].filter(Boolean);
  if (targets.length === 0) {
    log("ADVERTENCIA: no hay módulos de humo disponibles; se omite la comprobación de carga.");
  } else {
    log(`Humo con ${binary}:`);
    for (const filePath of targets) log(`  - ${path.relative(resourcesDir, filePath)}`);
    runSmoke(binary, resourcesDir, targets);
    log("Humo superado: los .jsc cargan y los stubs resuelven.");
  }
  log(
    `Listo: ${total.compiled + total.skipped} ficheros ofuscados en ${resourcesDir} ` +
      `(${total.compiled} nuevos, ${total.skipped} ya existían; ` +
      `${formatKilobytes(total.bytesBefore)} -> ${formatKilobytes(total.bytesAfter)}).`,
  );
}
try {
  main();
} catch (err) {
  console.error(`[obfuscate] ERROR: ${err.message ?? err}`);
  process.exitCode = 1;
}
