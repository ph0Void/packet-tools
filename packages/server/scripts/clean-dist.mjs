import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

fs.rmSync(distDir, { recursive: true, force: true });
console.log("[clean-dist] dist/ eliminado");
