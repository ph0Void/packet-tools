import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src/agent");
const FILES = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (entry.name.endsWith(".ts")) FILES.push(filePath);
  }
})(ROOT);

const SPANISH = /[áéíóúÁÉÍÓÚñÑ¿¡]|\b(el|la|los|las|un|una|del|de|con|para|por|que|sin|desde|entre|Nombre|Comandos|Dispositivo|Puerto|Nodo|Enlace|Proyecto|Cantidad|Tiempo|Límite|Filtrar|Duración|Estado|Tipo|Archivo|Lista|Usa|Úsala)\b/i;

function readLiteral(source, from) {
  let i = from;
  while (i < source.length && /[\s:]/.test(source[i])) i++;
  let text = "";
  let inString = false;
  for (; i < source.length; i++) {
    const char = source[i];
    if (!inString) {
      if (char === '"' || char === "'" || char === "`") {
        inString = true;
        continue;
      }
      if (char === "+" || /\s/.test(char)) continue;
      break;
    }
    if (char === "\\") {
      text += source[i + 1] ?? "";
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = false;
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) j++;
      if (source[j] === "+") {
        i = j;
        continue;
      }
      break;
    }
    text += char;
  }
  return text;
}

let total = 0;
let suspects = 0;
for (const file of FILES) {
  const source = fs.readFileSync(file, "utf8");
  const report = [];
  const patterns = [
    { kind: "tool", re: /description:/g },
    { kind: "param", re: /\.describe\(/g },
  ];
  for (const { kind, re } of patterns) {
    let match;
    while ((match = re.exec(source))) {
      const text = readLiteral(source, match.index + match[0].length);
      const line = source.slice(0, match.index).split("\n").length;
      total++;
      if (SPANISH.test(text)) {
        suspects++;
        report.push(`  L${line} [${kind}] ${text.slice(0, 110)}`);
      }
    }
  }
  if (report.length) {
    console.log(`\n=== ${path.relative(process.cwd(), file)} (${report.length})`);
    console.log(report.join("\n"));
  }
}
console.log(`\nTOTAL descripciones=${total} | en español=${suspects}`);
