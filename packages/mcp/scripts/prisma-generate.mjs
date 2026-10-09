
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizPaquete = path.resolve(aqui, "..");


function cargarEnvRaiz() {
  if (process.env.DATABASE_URL_MCP) return;

  const candidatos = [];
  let actual = raizPaquete;
  for (let i = 0; i < 5; i++) {
    candidatos.push(path.join(actual, ".env"));
    actual = path.dirname(actual);
  }

  for (const candidato of candidatos) {
    if (!fs.existsSync(candidato)) continue;
    dotenv.config({ path: candidato, override: false });
    if (process.env.DATABASE_URL_MCP) return;
  }
}

cargarEnvRaiz();

if (!process.env.DATABASE_URL_MCP) {
  
  
  
  process.env.DATABASE_URL_MCP = "file:.packet_tools_mcp.db";
}

const resultado = spawnSync("npx", ["prisma", "generate"], {
  cwd: raizPaquete,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (resultado.status !== 0) {
  console.error(
    "\n[prisma-generate] Falló la generación del cliente Prisma. " +
      "Comprueba que `prisma/schema.prisma` es válido y que las dependencias están instaladas.",
  );
  process.exit(resultado.status ?? 1);
}
