// Configuración de Prisma para el servidor MCP.
//
// Es un archivo aparte del de `packages/server` a propósito: el MCP tiene su
// propia BD (`DATABASE_URL_MCP`) y no debe compartir ni el esquema ni el archivo
// SQLite del backend.
//
// La búsqueda del `.env` raíz se hace con walk-up por el mismo motivo que en el
// server: turbo solo propaga las variables listadas en `turbo.json#globalEnv`, y
// `import "dotenv/config"` a secas busca en `packages/mcp/.env`, que no existe.
// El `.env` real vive en la raíz del monorepo.
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

if (!process.env.DATABASE_URL_MCP) {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false, quiet: true });
      if (process.env.DATABASE_URL_MCP) break;
    }
  }
  if (!process.env.DATABASE_URL_MCP) dotenv.config({ quiet: true });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Valor por defecto relativo a `packages/mcp`: cada paquete tiene su propio
    // archivo, así que no se pisan entre ellos.
    url: env("DATABASE_URL_MCP"),
  },
});
