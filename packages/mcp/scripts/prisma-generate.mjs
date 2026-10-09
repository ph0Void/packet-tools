/**
 * Genera el cliente Prisma antes de compilar.
 *
 * POR QUÉ HACE FALTA UN SCRIPT: el cliente generado vive en `src/prisma/generated`
 * y **no** está en el repositorio (es código derivado del esquema). Sin este paso,
 * `tsc` fallaría al no encontrar `../generated/client` en una clonación limpia o
 * en CI.
 *
 * Se resuelve la URL de `DATABASE_URL_MCP` con walk-up del `.env` raíz, porque
 * `prisma generate` necesita leer la configuración y el `.env` del monorepo no
 * vive en `packages/mcp`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizPaquete = path.resolve(aqui, "..");

/** Busca el `.env` raíz subiendo por el árbol de directorios. */
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
  // Un valor por defecto permite generar el cliente aunque todavía no exista el
  // `.env` (por ejemplo en CI, donde solo se compila). `prisma generate` no
  // necesita conectarse a la base.
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
