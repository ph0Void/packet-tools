import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

if (!process.env.DATABASE_URL) {
  const candidates = [
    path.resolve(process.cwd(), ".env"), // cwd = packages/server cuando se invoca prisma dentro del workspace
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(import.meta.dirname ?? process.cwd(), "../.env"),
    path.resolve(import.meta.dirname ?? process.cwd(), "../../.env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
      if (process.env.DATABASE_URL) break;
    }
  }
  if (!process.env.DATABASE_URL) dotenv.config();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
