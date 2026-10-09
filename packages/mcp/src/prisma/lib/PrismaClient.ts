
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/client";
import { DATA_DIR } from "@/config/EnvConfig";
import { applyMigrations } from "../Migrator";


const NOMBRE_BASE_POR_DEFECTO = ".packet_tools_mcp.db";


function cargarEnvRaizSiFalta(): void {
  if (process.env.DATABASE_URL_MCP) return;

  const candidatos: string[] = [];
  let actual = __dirname;
  for (let i = 0; i < 8; i++) {
    candidatos.push(path.join(actual, ".env"));
    actual = path.dirname(actual);
  }
  candidatos.push(path.resolve(process.cwd(), ".env"));

  for (const candidato of candidatos) {
    if (!fs.existsSync(candidato)) continue;
    dotenv.config({ path: candidato, override: false, quiet: true });
    if (process.env.DATABASE_URL_MCP) return;
  }
}

cargarEnvRaizSiFalta();


function resolverUrlDeBaseDeDatos(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const cruda = (process.env.DATABASE_URL_MCP ?? "").trim();
  if (!cruda) return `file:${path.join(DATA_DIR, NOMBRE_BASE_POR_DEFECTO)}`;
  if (!cruda.startsWith("file:")) return cruda; 

  const ruta = cruda.slice("file:".length);
  if (path.isAbsolute(ruta)) return cruda;
  return `file:${path.join(DATA_DIR, ruta)}`;
}

applyMigrations();

const adapter = new PrismaBetterSqlite3({ url: resolverUrlDeBaseDeDatos() });

export const prismaClient = new PrismaClient({
  adapter,
  
  
  log: process.env.MCP_PRISMA_LOG === "true" ? ["warn", "error"] : ["error"],
});


export async function disconnectPrisma(): Promise<void> {
  await prismaClient.$disconnect();
}
