import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/desktop/Bootstrap";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "packet-tools-bootstrap-"));
const dbPath = path.join(tmpDir, "test.db");
const migrationsDir = path.resolve("prisma/migrations");

function migrationCount(): number {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(migrationsDir, entry.name, "migration.sql"))).length;
}

function count(dbFile: string, sql: string): number {
  const db = new Database(dbFile, { readonly: true });
  try {
    return (db.prepare(sql).get() as { count: number }).count;
  } finally {
    db.close();
  }
}

function tableNames(dbFile: string): string[] {
  const db = new Database(dbFile, { readonly: true });
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("applyMigrations (bootstrap de escritorio)", () => {
  it("crea las tablas y registra cada migración una sola vez (idempotente)", () => {
    const total = migrationCount();
    expect(total).toBeGreaterThan(0);

    applyMigrations(dbPath, migrationsDir);

    const tables = tableNames(dbPath);
    expect(tables).toContain("User");
    expect(tables).toContain("Configuration");
    expect(tables).toContain("_prisma_migrations");
    expect(count(dbPath, 'SELECT COUNT(*) AS count FROM "_prisma_migrations"')).toBe(total);
    expect(count(dbPath, 'SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).toBe(total);

    applyMigrations(dbPath, migrationsDir);
    expect(count(dbPath, 'SELECT COUNT(*) AS count FROM "_prisma_migrations"')).toBe(total);
  });

  it("aborta si una migración previa quedó sin finalizar", () => {
    const brokenDir = path.join(tmpDir, "broken-migrations");
    fs.mkdirSync(path.join(brokenDir, "0001_rota"), { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "0001_rota", "migration.sql"), 'CREATE TABLE "ok" ("id" TEXT); CREATE TABLE "rota" (;');
    const brokenDb = path.join(tmpDir, "broken.db");

    expect(() => applyMigrations(brokenDb, brokenDir)).toThrow(/Falló la migración/);
    expect(() => applyMigrations(brokenDb, brokenDir)).toThrow(/sin finalizar/);
  });
});
