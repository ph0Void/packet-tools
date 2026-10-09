
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import dotenv from "dotenv";


function cargarEnvRaiz(): void {
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
    return;
  }
}

cargarEnvRaiz();


function resolverRaizPaquete(): string {
  let actual = path.resolve(__dirname, "..", "..");
  
  
  
  for (let i = 0; i < 3; i++) {
    if (fs.existsSync(path.join(actual, "package.json"))) return actual;
    actual = path.dirname(actual);
  }
  return path.resolve(__dirname, "..", "..");
}

export const PACKAGE_ROOT = resolverRaizPaquete();


function resolverDirDatos(): string {
  const explicito = (process.env.MCP_DATA_DIR ?? "").trim();
  if (explicito) return path.resolve(explicito);

  const estaEnCache = PACKAGE_ROOT.includes(`${path.sep}node_modules${path.sep}`);
  if (!estaEnCache) return PACKAGE_ROOT;

  return path.join(os.homedir(), ".packet-tools", "mcp");
}

export const DATA_DIR = resolverDirDatos();



function numeroDeEnv(nombre: string, porDefecto: number): number {
  const bruto = Number(process.env[nombre]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : porDefecto;
}


function booleanoDeEnv(nombre: string, porDefecto: boolean): boolean {
  const bruto = process.env[nombre];
  if (bruto === undefined || bruto === "") return porDefecto;
  return bruto !== "false";
}


function rutaDeEnv(nombre: string, porDefecto: string): string {
  const bruto = (process.env[nombre] ?? "").trim() || porDefecto;
  return path.isAbsolute(bruto) ? bruto : path.join(DATA_DIR, bruto);
}

export const envConfig = {
  
  
  
  
  SERVER_PORT: numeroDeEnv("SERVER_PORT", 7531),

  
  MCP_BRIDGE_HOST: (process.env.MCP_BRIDGE_HOST ?? "127.0.0.1").trim() || "127.0.0.1",

  
  MCP_BRIDGE_PORT: numeroDeEnv("MCP_BRIDGE_PORT", 7532),

  
  MCP_BRIDGE_ENABLED: booleanoDeEnv("MCP_BRIDGE_ENABLED", true),

  
  MCP_PACKET_TRACER_HOST: (process.env.MCP_PACKET_TRACER_HOST ?? "localhost").trim(),

  
  PT_EXTENSION_SECRET: (process.env.PT_EXTENSION_SECRET ?? "").trim(),

  
  
  
  
  MCP_GNS3_URL: (process.env.MCP_GNS3_URL ?? "").trim(),

  
  
  
  
  MCP_TOOL_TIMEOUT_MS: numeroDeEnv("MCP_TOOL_TIMEOUT_MS", 120_000),
  
  MCP_TERMINAL_MAX_MS: numeroDeEnv("MCP_TERMINAL_MAX_MS", 20_000),
  
  MCP_TERMINAL_IDLE_MS: numeroDeEnv("MCP_TERMINAL_IDLE_MS", 700),
  
  MCP_MAX_OUTPUT_CHARS: numeroDeEnv("MCP_MAX_OUTPUT_CHARS", 20_000),

  
  
  
  
  MCP_PLANS_DIR: rutaDeEnv("MCP_PLANS_DIR", "plans"),
  
  MCP_SKILLS_DIR: rutaDeEnv("MCP_SKILLS_DIR", "skills"),

  
  
  
  
  MCP_DEBUG: booleanoDeEnv("MCP_DEBUG", false),
  
  MCP_TRACE_TOOLS: booleanoDeEnv("MCP_TRACE_TOOLS", false),
} as const;

export type EnvConfig = typeof envConfig;
