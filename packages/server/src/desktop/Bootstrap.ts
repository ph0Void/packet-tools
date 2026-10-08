import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const MIGRATION_TABLE = "_prisma_migrations";

type MigrationRow = {
  migration_name: string;
  finished_at: string | null;
};

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

function resolveDatabasePath(): string {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "[Bootstrap] DATABASE_URL no está definida. El proceso Electron debe inyectarla antes de arrancar el backend.",
    );
  }
  const rawPath = rawUrl.replace(/^file:/, "");

  const dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, "../..", rawPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

function resolveMigrationsDir(): string {
  const fromEnv = process.env.MIGRATIONS_DIR;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`[Bootstrap] MIGRATIONS_DIR apunta a un directorio inexistente: ${fromEnv}`);
    }
    return fromEnv;
  }
  const candidates = [
    path.resolve(__dirname, "../../migrations"),
    path.resolve(__dirname, "../../prisma/migrations"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`[Bootstrap] No se encontró el directorio de migraciones. Rutas probadas: ${candidates.join(", ")}`);
  }
  return found;
}

function listMigrations(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`[Bootstrap] Directorio de migraciones inexistente: ${migrationsDir}`);
  }
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(migrationsDir, entry.name, "migration.sql")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function applyMigrations(dbPath: string, migrationsDir: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const migrations = listMigrations(migrationsDir);
  const db = new Database(dbPath);
  try {
    db.exec(CREATE_MIGRATION_TABLE);

    const findMigration = db.prepare(
      `SELECT "migration_name", "finished_at" FROM "${MIGRATION_TABLE}" WHERE "migration_name" = ?`,
    );
    const insertMigration = db.prepare(
      `INSERT INTO "${MIGRATION_TABLE}" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
       VALUES (?, ?, ?, current_timestamp, 0)`,
    );
    const finishMigration = db.prepare(
      `UPDATE "${MIGRATION_TABLE}" SET "finished_at" = current_timestamp, "applied_steps_count" = 1 WHERE "id" = ?`,
    );

    for (const name of migrations) {
      const existing = findMigration.get(name) as MigrationRow | undefined;
      if (existing) {
        if (existing.finished_at === null) {
          throw new Error(
            `[Bootstrap] Migración previa falló: "${name}" quedó sin finalizar (finished_at NULL). Resuélvela antes de reintentar.`,
          );
        }
        console.log(`[Bootstrap] Migración ya aplicada: ${name}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const id = crypto.randomUUID();

      console.log(`[Bootstrap] Aplicando migración: ${name}`);
      insertMigration.run(id, checksum, name);
      db.exec("BEGIN");
      try {
        db.exec(sql);
        finishMigration.run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`[Bootstrap] Falló la migración "${name}": ${detail}`);
      }
    }

    console.log(`[Bootstrap] Migraciones verificadas: ${migrations.length}`);
  } finally {
    db.close();
  }
}

export async function main(): Promise<void> {
  const dbPath = resolveDatabasePath();
  const migrationsDir = resolveMigrationsDir();
  console.log(`[Bootstrap] Base de datos: ${dbPath}`);
  console.log(`[Bootstrap] Migraciones: ${migrationsDir}`);
  applyMigrations(dbPath, migrationsDir);

  const [{ runSeed }, { prismaClient }] = await Promise.all([
    import("@/seed/SeedService"),
    import("@/prisma/lib/PrismaClient"),
  ]);
  await runSeed();
  await prismaClient.$disconnect();
  console.log("[Bootstrap] Listo: base de datos migrada y datos iniciales garantizados.");
}

const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isDirectRun =
  !!argv1 &&
  (argv1 === __filename || argv1 === __filename.replace(/\.jsc$/, ".js"));

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[Bootstrap]", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
