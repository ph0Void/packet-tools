import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPTS_DIR, "../../..");
const CACHE_DIR = path.join(ROOT_DIR, "packages", "desktop", ".cache");
const DIST_URL = "https://nodejs.org/dist";
function log(message) {
  console.log(`[node-runtime] ${message}`);
}
function fail(message) {
  throw new Error(`[node-runtime] ${message}`);
}
function resolveNodePlatform(platform = process.platform) {
  if (platform === "win32") return "win";
  if (platform === "darwin") return "darwin";
  if (platform === "linux") return "linux";
  fail(`Plataforma no soportada para empaquetar Node: ${platform}`);
}
function resolveNodeArch(arch = process.arch) {
  if (arch === "x64") return "x64";
  if (arch === "arm64") return "arm64";
  fail(`Arquitectura no soportada para empaquetar Node: ${arch}`);
}
function archiveExtension(platform) {
  if (platform === "win") return "zip";
  if (platform === "darwin") return "tar.gz";
  return "tar.xz";
}
function distributionName(version, platform, arch, extension) {
  return `node-v${version}-${platform}-${arch}.${extension}`;
}
function download(url, targetPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        download(response.headers.location, targetPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} al descargar ${url}`));
        return;
      }
      const tempPath = `${targetPath}.parcial`;
      const stream = fs.createWriteStream(tempPath);
      response.pipe(stream);
      stream.on("finish", () => {
        stream.close(() => {
          fs.renameSync(tempPath, targetPath);
          resolve();
        });
      });
      stream.on("error", reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error(`Timeout descargando ${url}`)));
    request.on("error", reject);
  });
}
function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}
async function verifyChecksum(version, fileName, filePath) {
  const url = `${DIST_URL}/v${version}/SHASUMS256.txt`;
  const shasumsPath = path.join(CACHE_DIR, `shasums-${version}.txt`);
  await download(url, shasumsPath);
  const content = fs.readFileSync(shasumsPath, "utf8");
  const line = content.split(/\r?\n/).find((row) => row.trimEnd().endsWith(`  ${fileName}`));
  if (!line) {
    fail(`SHASUMS256.txt de Node ${version} no contiene ${fileName}.`);
  }
  const expected = line.trim().split(/\s+/)[0];
  const actual = sha256File(filePath);
  if (expected !== actual) {
    fail(
      `Checksum inválido para ${fileName}.\n  esperado: ${expected}\n  obtenido: ${actual}`,
    );
  }
  log(`Checksum verificado (${fileName}).`);
}
async function ensureDistribution(version, platform, arch, extension) {
  const fileName = distributionName(version, platform, arch, extension);
  const cachedPath = path.join(CACHE_DIR, fileName);
  if (!fs.existsSync(cachedPath)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    log(`Descargando Node v${version} (${fileName})...`);
    await download(`${DIST_URL}/v${version}/${fileName}`, cachedPath);
  } else {
    log(`Usando Node v${version} en caché (${cachedPath}).`);
  }
  await verifyChecksum(version, fileName, cachedPath);
  return { fileName, cachedPath };
}
function executableInDistribution(extractDir, version, platform, arch) {
  const base = path.join(extractDir, `node-v${version}-${platform}-${arch}`);
  if (platform === "win") return path.join(base, "node.exe");
  return path.join(base, "bin", "node");
}
export async function prepareNodeRuntime(targetResources) {
  const version = process.versions.node;
  const platform = resolveNodePlatform();
  const arch = resolveNodeArch();
  const extension = archiveExtension(platform);
  const { cachedPath } = await ensureDistribution(
    version,
    platform,
    arch,
    extension,
  );
  const extractDir = path.join(CACHE_DIR, "extraido");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const extractResult = spawnSync("tar", ["-xf", cachedPath, "-C", extractDir], {
    stdio: "inherit",
  });
  if (extractResult.error || extractResult.status !== 0) {
    fail(`No se pudo descomprimir ${cachedPath} con tar: ${extractResult.error?.message ?? extractResult.status}`);
  }
  const executable = executableInDistribution(
    extractDir,
    version,
    platform,
    arch,
  );
  if (!fs.existsSync(executable)) {
    fail(`No se encontró el ejecutable de Node en la distribución: ${executable}`);
  }
  const relativeTarget = platform === "win" ? "node.exe" : path.join("bin", "node");
  const target = path.join(targetResources, "node", relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(executable, target);
  if (platform !== "win") fs.chmodSync(target, 0o755);
  const sizeMB = (fs.statSync(target).size / (1024 * 1024)).toFixed(1);
  log(`Node v${version} empaquetado en ${path.relative(ROOT_DIR, target)} (${sizeMB} MB).`);
  return target;
}
