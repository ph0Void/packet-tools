import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

const SPECIFIER_PATTERN = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])([^"'\n]+)\2/g;
const COMPLETE_EXTENSION = /\.(js|mjs|cjs|json)$/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield fullPath;
  }
}

function resolveSpecifier(fromFile, specifier) {
  const isAlias = specifier.startsWith("@/");
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!isAlias && !isRelative) return null;

  const base = isAlias
    ? path.join(distDir, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const target = [`${base}.js`, path.join(base, "index.js")].find((candidate) => fs.existsSync(candidate));
  if (!target) return null;

  const relativePath = path.relative(path.dirname(fromFile), target).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

let rewritten = 0;
let scanned = 0;
const unresolved = [];

for (const file of walk(distDir)) {
  scanned++;
  const source = fs.readFileSync(file, "utf8");
  const relativeFile = path.relative(distDir, file);
  const output = source.replace(SPECIFIER_PATTERN, (match, prefix, quote, specifier) => {
    if (COMPLETE_EXTENSION.test(specifier)) return match;
    const resolved = resolveSpecifier(file, specifier);
    if (!resolved) {
      if (specifier.startsWith("@/") || specifier.startsWith("./") || specifier.startsWith("../")) {
        unresolved.push(`${relativeFile} -> ${specifier}`);
      }
      return match;
    }
    rewritten++;
    return `${prefix}${quote}${resolved}${quote}`;
  });
  if (output !== source) fs.writeFileSync(file, output);
}

if (unresolved.length > 0) {
  console.error("[rewrite-dist] Specifiers sin resolver (¿archivo inexistente?):");
  for (const item of unresolved) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`[rewrite-dist] ${rewritten} specifiers reescritos en ${scanned} archivos de dist/.`);
