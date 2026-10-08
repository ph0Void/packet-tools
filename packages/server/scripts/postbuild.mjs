import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const packageJsonPath = path.join(distDir, "package.json");

fs.writeFileSync(packageJsonPath, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
console.log('[postbuild] dist/package.json escrito con {"type":"commonjs"}');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield fullPath;
  }
}

const issues = [];
let checkedCount = 0;

for (const file of walk(distDir)) {
  checkedCount++;
  const source = fs.readFileSync(file, "utf8");
  const relativePath = path.relative(distDir, file);

  if (/import\.meta/.test(source)) {
    issues.push(`${relativePath}: contiene import.meta (¿algún src sin migrar?)`);
    continue;
  }

  try {
    new vm.Script(source, { filename: relativePath });
  } catch (error) {
    issues.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (issues.length > 0) {
  console.error(`[postbuild] ERROR: ${issues.length} ficheros inválidos en dist/ (revisados: ${checkedCount}):`);
  for (const item of issues.slice(0, 30)) console.error(`  - ${item}`);
  if (issues.length > 30) console.error(`  ... y ${issues.length - 30} más`);
  process.exit(1);
}

console.log(`[postbuild] ${checkedCount} ficheros verificados como CJS válidos ✓`);
