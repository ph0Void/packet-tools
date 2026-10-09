"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_module_1 = require("node:module");
const EnvConfig_1 = require("../config/EnvConfig.js");
const Logger_1 = require("../utils/Logger.js");
const Database = (0, node_module_1.createRequire)(__filename)("better-sqlite3");
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
function resolveDatabaseFile() {
    const raw = (process.env.DATABASE_URL_MCP ?? "").trim() || "file:.packet_tools_mcp.db";
    const withoutScheme = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
    const candidate = node_path_1.default.isAbsolute(withoutScheme)
        ? withoutScheme
        : node_path_1.default.join(EnvConfig_1.DATA_DIR, withoutScheme);
    return candidate.replace(/^file:/, "");
}
function resolveMigrationsDir() {
    const candidates = [
        node_path_1.default.resolve(__dirname, "../../prisma/migrations"),
        node_path_1.default.resolve(__dirname, "../../../prisma/migrations"),
        node_path_1.default.resolve(process.cwd(), "packages/mcp/prisma/migrations"),
        node_path_1.default.resolve(process.cwd(), "prisma/migrations"),
    ];
    return candidates.find((dir) => node_fs_1.default.existsSync(dir)) ?? null;
}
function listMigrations(dir) {
    return node_fs_1.default
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() &&
        node_fs_1.default.existsSync(node_path_1.default.join(dir, entry.name, "migration.sql")))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
}
function applyMigrations() {
    const dbFile = resolveDatabaseFile();
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbFile), { recursive: true });
    const migrationsDir = resolveMigrationsDir();
    if (!migrationsDir) {
        Logger_1.Logger.warning("No se encontró el directorio de migraciones del MCP; la base se usará tal cual está.");
        return;
    }
    const db = new Database(dbFile);
    try {
        db.exec(CREATE_MIGRATION_TABLE);
        const find = db.prepare(`SELECT "migration_name", "finished_at" FROM "${MIGRATION_TABLE}" WHERE "migration_name" = ?`);
        const insert = db.prepare(`INSERT INTO "${MIGRATION_TABLE}" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
       VALUES (?, ?, ?, current_timestamp, 0)`);
        const finish = db.prepare(`UPDATE "${MIGRATION_TABLE}" SET "finished_at" = current_timestamp, "applied_steps_count" = 1 WHERE "id" = ?`);
        for (const name of listMigrations(migrationsDir)) {
            const existing = find.get(name);
            if (existing) {
                if (existing.finished_at === null) {
                    throw new Error(`Migración sin finalizar: "${name}"`);
                }
                continue;
            }
            const sql = node_fs_1.default.readFileSync(node_path_1.default.join(migrationsDir, name, "migration.sql"), "utf8");
            const id = node_crypto_1.default.randomUUID();
            const checksum = node_crypto_1.default.createHash("sha256").update(sql).digest("hex");
            insert.run(id, checksum, name);
            db.exec("BEGIN");
            try {
                db.exec(sql);
                finish.run(id);
                db.exec("COMMIT");
            }
            catch (error) {
                db.exec("ROLLBACK");
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`Falló la migración "${name}": ${detail}`);
            }
            Logger_1.Logger.debug(`Migración aplicada: ${name}`);
        }
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=Migrator.js.map