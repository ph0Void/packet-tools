import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { DATA_DIR } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";

interface Statement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

interface DatabaseConstructor {
  new (file: string): Database;
}

const Database = createRequire(__filename)("better-sqlite3") as DatabaseConstructor;

const MIGRATION_TABLE = "_prisma_migrations";

const CREATE_MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS "${MIGRATION_TABLE}" (
    "id" TEXT PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
`;

function resolveDatabaseFile(): string {
  const raw = (process.env.DATABASE_URL_MCP ?? "").trim() || "file:.packet_tools_mcp.db";
  const withoutScheme = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  const candidate = path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.join(DATA_DIR, withoutScheme);
  return candidate.replace(/^file:/, "");
}

function resolveMigrationsDir(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../prisma/migrations"),
    path.resolve(__dirname, "../../../prisma/migrations"),
    path.resolve(process.cwd(), "packages/mcp/prisma/migrations"),
    path.resolve(process.cwd(), "prisma/migrations"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? null;
}

function listMigrations(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(dir, entry.name, "migration.sql")),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function applyMigrations(): void {
  const dbFile = resolveDatabaseFile();
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  const migrationsDir = resolveMigrationsDir();
  if (!migrationsDir) {
    Logger.warning(
      "No se encontró el directorio de migraciones del MCP; la base se usará tal cual está.",
    );
    return;
  }

  const db = new Database(dbFile);
  try {
    db.exec(CREATE_MIGRATION_TABLE);

    const find = db.prepare(
      `SELECT "migration_name", "finished_at" FROM "${MIGRATION_TABLE}" WHERE "migration_name" = ?`,
    );
    const insert = db.prepare(
      `INSERT INTO "${MIGRATION_TABLE}" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
       VALUES (?, ?, ?, current_timestamp, 0)`,
    );
    const finish = db.prepare(
      `UPDATE "${MIGRATION_TABLE}" SET "finished_at" = current_timestamp, "applied_steps_count" = 1 WHERE "id" = ?`,
    );

    for (const name of listMigrations(migrationsDir)) {
      const existing = find.get(name) as { finished_at: string | null } | undefined;
      if (existing) {
        if (existing.finished_at === null) {
          throw new Error(`Migración sin finalizar: "${name}"`);
        }
        continue;
      }

      const sql = fs.readFileSync(
        path.join(migrationsDir, name, "migration.sql"),
        "utf8",
      );
      const id = crypto.randomUUID();
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");

      insert.run(id, checksum, name);
      db.exec("BEGIN");
      try {
        db.exec(sql);
        finish.run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Falló la migración "${name}": ${detail}`);
      }
      Logger.debug(`Migración aplicada: ${name}`);
    }
  } finally {
    db.close();
  }
}
