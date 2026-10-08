import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

const __dirnameConfig = __dirname;
if (
  !process.env.SERVER_PORT ||
  !process.env.JWT_SECRET ||
  !process.env.DATABASE_URL
) {
  const candidates: string[] = [
    path.resolve(__dirnameConfig, "../../../.env"), // src/config -> root (4 niveles)
    path.resolve(__dirnameConfig, "../../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  let cur = __dirnameConfig;
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

      if (process.env.SERVER_PORT && process.env.DATABASE_URL) break;
    }
  }
  if (!process.env.SERVER_PORT) dotenv.config();
}

const RECURSION_LIMIT = Number(process.env.AGENT_RECURSION_LIMIT) || 600;

const STEPS_PER_ROUND = 6;

export const envConfig = {
  SERVER_PORT: Number(process.env.SERVER_PORT) || 7531,
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET || "packet-tools-development-secret",
  JWT_EXPIRATION: process.env.JWT_EXPIRATION || "30d",
  RATE_LIMIT_REFRESH: Number(process.env.RATE_LIMIT_REFRESH) || 900000,
  RATE_LIMIT_REQUESTS: Number(process.env.RATE_LIMIT_REQUESTS) || 100, // 100 request

  AGENT_HISTORY_MESSAGES: Number(process.env.AGENT_HISTORY_MESSAGES) || 8,

  AGENT_CONTEXT_TOKENS: Number(process.env.AGENT_CONTEXT_TOKENS) || 10000,

  AGENT_TOOL_OUTPUT_CHARS: Number(process.env.AGENT_TOOL_OUTPUT_CHARS) || 4000,

  AGENT_CONTENT_CHARS: Number(process.env.AGENT_CONTENT_CHARS) || 4000,

  AGENT_USER_MESSAGE_CHARS:
    Number(process.env.AGENT_USER_MESSAGE_CHARS) || 8000,

  AGENT_RECURSION_LIMIT: RECURSION_LIMIT,

  AGENT_STEPS_PER_ROUND: STEPS_PER_ROUND,

  AGENT_SPECIALIST_MODEL_LIMIT: Math.max(
    8,
    Math.floor((RECURSION_LIMIT - 10) / STEPS_PER_ROUND) - 2,
  ),

  AGENT_SPECIALIST_TOOL_LIMIT:
    Math.max(8, Math.floor((RECURSION_LIMIT - 10) / STEPS_PER_ROUND) - 2) * 2,

  AGENT_SUPERVISOR_RECURSION_LIMIT: RECURSION_LIMIT * 4,

  AGENT_BUDGET_NUDGE_RATIO: 0.7,

  AGENT_BUDGET_FORCE_RATIO: 0.95,

  AGENT_CONTEXT_EDIT_TOKENS:
    Number(process.env.AGENT_CONTEXT_EDIT_TOKENS) || 48000,

  AGENT_TOKEN_LOGGING: process.env.AGENT_TOKEN_LOGGING === "true",

  AGENT_PROMPT_CACHING: process.env.AGENT_PROMPT_CACHING !== "false",

  TERMINAL_SNIPPET_MAX_CHARS:
    Number(process.env.TERMINAL_SNIPPET_MAX_CHARS) || 4000,

  FAST_PATH_ENABLED: process.env.FAST_PATH_ENABLED === "true",

  AGENT_LAZY_TOOLS: process.env.AGENT_LAZY_TOOLS !== "false",

  AGENT_SUBAGENT_LOGGING: process.env.AGENT_SUBAGENT_LOGGING !== "false",

  AGENT_MAX_OUTPUT_TOKENS:
    Number(process.env.AGENT_MAX_OUTPUT_TOKENS) || 4000,

  AGENT_PROVIDER_TIMEOUT_MS:
    Number(process.env.AGENT_PROVIDER_TIMEOUT_MS) || 120_000,

  AGENT_PROVIDER_MAX_RETRIES:
    Number(process.env.AGENT_PROVIDER_MAX_RETRIES) || 2,

  AGENT_TURN_TIMEOUT_MS:
    Number(process.env.AGENT_TURN_TIMEOUT_MS) || 300_000,

  AGENT_DUPLICATE_TOOL_GUARD:
    process.env.AGENT_DUPLICATE_TOOL_GUARD !== "false",

  ATTACHMENTS_DIR: process.env.ATTACHMENTS_DIR || "uploads/attachments",

  ATTACHMENT_MAX_BYTES:
    Number(process.env.ATTACHMENT_MAX_BYTES) || 10 * 1024 * 1024,

  PT_EXTENSION_SECRET: process.env.PT_EXTENSION_SECRET || "",

  CORS_ORIGINS: (
    process.env.CORS_ORIGINS ||
    `http://localhost:${process.env.PORT || "3090"},http://localhost:${process.env.SERVER_PORT || "7531"}`
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  CHAT_MESSAGES_RATE_LIMIT: Number(process.env.CHAT_MESSAGES_RATE_LIMIT) || 30,
};
