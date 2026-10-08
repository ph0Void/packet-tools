import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/prisma/generated/client.ts",
);

let code = fs.readFileSync(clientPath, "utf8");
const originalCode = code;

code = code.replace(
  /path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/g,
  "__dirname",
);

if (code !== originalCode) {
  fs.writeFileSync(clientPath, code);
  console.log("[patch-generated] import.meta reescrito a __dirname en client.ts");
}

if (/import\.meta/.test(code)) {
  console.error(
    "[patch-generated] ERROR: queda `import.meta` en src/prisma/generated/client.ts. " +
      "Revisa el formato que genera Prisma y actualiza este script.",
  );
  process.exit(1);
}

console.log("[patch-generated] client.ts sin import.meta ✓");
