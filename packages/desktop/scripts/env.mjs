import fs from "node:fs";
import path from "node:path";
export function parseEnv(content) {
  const result = {};
  const lines = String(content ?? "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eqIndex + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const closing = value.indexOf(quote, 1);
      value = closing === -1 ? value.slice(1) : value.slice(1, closing);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
      if (value.startsWith("#")) value = "";
    }
    result[key] = value;
  }
  return result;
}
export function loadRootEnv(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return {};
  return parseEnv(fs.readFileSync(envPath, "utf8"));
}
export function readElectronVersion(rootDir) {
  const packagePath = path.join(rootDir, "node_modules", "electron", "package.json");
  try {
    const version = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
    if (version) return version;
  } catch {
  }
  throw new Error(
    "No se pudo determinar la versión de Electron instalada. " +
      "Ejecuta `npm install` en la raíz (o revisa node_modules/electron).",
  );
}
