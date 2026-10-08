import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/client";

if (!process.env.DATABASE_URL) {
  const candidates: string[] = [

    path.resolve(__dirname, "../../../../.env"),
    path.resolve(__dirname, "../../../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
  ];

  let cur = __dirname;
  for (let i = 0; i < 7; i++) {
    cur = path.dirname(cur);
    candidates.push(path.join(cur, ".env"));
  }

  cur = process.cwd();
  for (let i = 0; i < 7; i++) {
    candidates.push(path.join(cur, ".env"));
    cur = path.dirname(cur);
    if (cur === path.parse(cur).root) break;
  }
  const seen = new Set<string>();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
      if (process.env.DATABASE_URL) break;
    }
  }
  if (!process.env.DATABASE_URL) dotenv.config();
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[PrismaClient] DATABASE_URL no definida. Asegúrate de tener .env en la raíz con DATABASE_URL=file:.packet_tool_database.db y que turbo.json incluya DATABASE_URL en globalEnv. CWD=" +
      process.cwd() +
      " __dirname=" +
      __dirname,
  );
}

const rawUrl = process.env.DATABASE_URL;
const relativePath = rawUrl.replace(/^file:/, "");
const dbPath = path.isAbsolute(relativePath)
  ? relativePath
  : path.resolve(__dirname, "../../..", relativePath);

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prismaClient = new PrismaClient({ adapter });

export { prismaClient };
