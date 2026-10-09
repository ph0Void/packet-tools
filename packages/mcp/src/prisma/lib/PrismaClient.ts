/**
 * Cliente Prisma del servidor MCP.
 *
 * Es INDEPENDIENTE del de `packages/server`: apunta a su propio archivo SQLite
 * (`DATABASE_URL_MCP`) y usa su propio esquema. El MCP arranca aunque el backend
 * esté parado, que es la razón de que exista esta base.
 *
 * Dos cosas que hay que respetar porque Prisma 7 las cambió:
 *  - La URL ya no vive en el `.schema`: aquí se pasa un `adapter` al constructor.
 *  - El cliente generado vive en `src/prisma/generated` (no en
 *    `node_modules/@prisma/client`), así que se importa por ruta relativa.
 *
 * La resolución del `.env` raíz se hace con walk-up por el mismo motivo que en
 * el backend: turbo solo propaga `turbo.json#globalEnv`, pero el MCP también se
 * lanza a mano (`node dist/app.js`) o desde un cliente MCP, y en esos casos no
 * hay nadie que haya cargado el `.env` del monorepo.
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/client";

/** Nombre del archivo SQLite por defecto, relativo a `packages/mcp`. */
const NOMBRE_BASE_POR_DEFECTO = ".packet_tools_mcp.db";

/**
 * Carga el `.env` de la raíz del monorepo si `DATABASE_URL_MCP` aún no está
 * definida, subiendo por el árbol de directorios desde `__dirname`.
 */
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

/**
 * Resuelve la URL de conexión.
 *
 * Una ruta relativa se interpreta respecto a la RAÍZ DE `packages/mcp` y no
 * respecto al `cwd`, porque un cliente MCP puede lanzar el proceso desde
 * cualquier directorio. Sin esto, `node dist/app.js` desde la raíz del repo
 * crearía el archivo SQLite en el sitio equivocado.
 */
function resolverUrlDeBaseDeDatos(): string {
  const cruda = (process.env.DATABASE_URL_MCP ?? "").trim();
  if (!cruda) return `file:${NOMBRE_BASE_POR_DEFECTO}`;
  if (!cruda.startsWith("file:")) return cruda; // ruta absoluta o URL de otro motor

  const ruta = cruda.slice("file:".length);
  if (path.isAbsolute(ruta)) return cruda;
  // `__dirname` en dist es <pkg>/dist/prisma/lib; subimos a <pkg>.
  const raizPaquete = path.resolve(__dirname, "../../..");
  return `file:${path.join(raizPaquete, ruta)}`;
}

const adapter = new PrismaBetterSqlite3({ url: resolverUrlDeBaseDeDatos() });

export const prismaClient = new PrismaClient({
  adapter,
  // El MCP no necesita el log ruidoso de Prisma; los errores se capturan en los
  // handlers de cada tool, donde sí se puede dar un mensaje accionable.
  log: process.env.MCP_PRISMA_LOG === "true" ? ["warn", "error"] : ["error"],
});

/** Cierra la conexión (lo usa el apagado ordenado del servidor). */
export async function disconnectPrisma(): Promise<void> {
  await prismaClient.$disconnect();
}
