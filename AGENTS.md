# Packet Tools — Agent instructions

TypeScript monorepo with npm workspaces + Turborepo.

## Repository map

- `packages/server` — `@packet-tools/server`: Express 5 + TypeScript backend (dev with `tsx`; production `node dist/app.js`). Detail in `packages/server/AGENTS.md`.
- `packages/web` — `@packet-tools/web`: Next.js 16 + React 19 frontend. Detail in `packages/web/AGENTS.md`.
- `packages/desktop` — `@package/desktop`: all-in-one Electron installer (NSIS/AppImage/deb). Detail in `packages/desktop/AGENTS.md`; intentionally no `build` script (turbo never builds it). Code there uses English identifiers and no comments.
- `packages/mcp` — `@packet-tools/mcp`: MCP (Model Context Protocol) server over stdio exposing the Packet Tools engine (Packet Tracer, GNS3, serial, Telnet, SSH) as tools. Real workspace. Detail in `packages/mcp/README.md`; its `src/`/`scripts/`/`test/` carry no comments (stripped on purpose). `dist/` is committed so `npx -y --package=github:ph0Void/packet-tools packet-tools-mcp` works straight from the git repo.
- `extension-packetracer/` — Cisco Packet Tracer extension in plain JavaScript. **Not an npm workspace** (only `packages/*` are); never build it with turbo. Detail in `extension-packetracer/AGENTS.md`.
- `.agents/skills/` — canonical-format agent skills for repo development (`ai-sdk`, `frontend-design`, `grill-me`, `impeccable`, `vercel-react-best-practices`). **The Packet Tools backend does NOT read them**: its own skills live in the `KnowledgeBase type=SKILL` table; do not confuse them.
- Public docs: `README.md` and `packages/*/README.md`. The root, `server`, `web` and `desktop` `package.json` are at **1.2.1**; `mcp` at **1.2.3** (its own UI/extension line) — keep each line aligned before shipping.

## Commands (root)

All root scripts load the `.env` with `dotenv -e .env --` **except two**: `init` (which also *creates* the `.env`) and `build-desktop` do not. The root `.env` is mandatory and gitignored; `npm run init` creates it from `.example.env` and installs dependencies.

| Command | What it does |
| --- | --- |
| `npm run dev` | backend + frontend in parallel (turbo dev) |
| `npm run build` | compiles server (`tsc`) and web (`next build` via its script) |
| `npm run build-desktop` | full Electron installer (server + standalone web + Node + seeded SQLite); `-- --win/--linux` selects the platform. With `DESKTOP_OBFUSCATE=true` in `.env` it obfuscates backend and frontend to V8 bytecode (bytenode) before packing (detail in `packages/desktop/AGENTS.md`) |
| `npm run lint` | ESLint of the **web only**; the server has no lint |
| `npm test` | Vitest of the **server only** (84 suites) |
| `npm run migrate` / `generate` / `seed` / `studio` / `reset` | Prisma (see below) |
| `npm run migrate --workspace=@packet-tools/server` | `prisma migrate dev` |
| `npm run migrate:deploy` (server workspace) | `prisma migrate deploy` (production/Docker) |
| `npm run reset` | recreates the database (destructive) |
| `npm run test-pt` / `test-terminal` / `test-telnet` / `test-ssh` / `test-serial` / `test-gns3` | live suites against real transports (need hardware/simulators connected) |

- One suite: `npm test -- test/auth.test.ts`; watch: `npm test -- --watch` (suites in `packages/server/test/`).
- The web has no typecheck or test script: verify with `npx tsc --noEmit` and `npx eslint <file>` inside `packages/web`. Its pure logic has runnable checks instead: `check-tooloutput.ts`, `check-turno-corte.ts`, `check-adjuntos.ts`, `check-comandos-standard.ts` in `packages/web/scripts/`.
- Minimum verification after changes: `npm run lint` + `npm run build`; if you touched the backend, also `npm test`.
- Prompt-size benchmark: `npx tsx src/agent/deep/benchmarks/PromptSize.ts` (from `packages/server`).

## Agents (Deep Agents)

- **Single orchestration: Deep Agents.** The agentic supervisor lives in `packages/server/src/agent/deep/` (local entry `createDeepSupervisor` in `DeepSupervisor.ts`; `createDeepAgent` **is not project code**, it is the import from the external `deepagents` library). No legacy `StateGraph`, no orchestration flags.
- The only HITL is `ApprovalMiddleware` (native `interruptOn` retired). **Rollback = `git revert` or back to the previous tag/commit.**
- Backend skills live in the `KnowledgeBase type=SKILL` table (virtual in-memory filesystem), never as repo files; the canonical skill format is documented in `packages/server/AGENTS.md`.

## Environment and ports

- `SERVER_PORT=7531` (API + Socket.IO), `PORT=3090` (frontend), `NEXT_PUBLIC_API_URL=http://localhost:7531` (real values in `.env`).
- New backend env vars: add them to `globalEnv` in `turbo.json`. Turbo propagates **no** unlisted variable; that is why `EnvConfig.ts`, `PrismaClient.ts` and `prisma.config.ts` walk up looking for the root `.env`. All `AGENT_*` are already listed there.
- `DATABASE_URL` points to a SQLite file relative to the server package (`file:.packet_tool_database.db` → `packages/server/.packet_tool_database.db`); absolute paths allowed (used by Docker).
- The frontend inlines `NEXT_PUBLIC_*` **at build** (`env` in `next.config.ts`): `NEXT_PUBLIC_BACKEND_URL = NEXT_PUBLIC_API_URL`. Chat SSE, HITL approvals and Socket.IO go straight to the backend, never through the Next rewrite.
- **Web build gotcha**: the root `.env` exports `NODE_ENV=development` (needed by backend/cron) while `next build` requires `NODE_ENV=production`; `packages/web/scripts/build.mjs` forces it. Use `npm run build`, never bare `next build` with the root env loaded.

## Docker

- `dockerfile` (lowercase name) builds an all-in-one image: backend `:7531` + frontend `:3090` in one container.
- `docker-compose.yml` orchestrates deployment (`docker compose up --build`), with a `packet-tools-data` volume for SQLite and a healthcheck on `/api/health`.
- `docker-entrypoint.sh` runs `migrate:deploy` + `seed` + both `start`s. Keep LF line endings (enforced by `.gitattributes`); never save it with CRLF.
- Building the image needs the Docker daemon running; otherwise at least validate YAML/JSON and line endings.

## Cross-cutting rules

- Security: every new route under `/api` applies `authMiddleware` + `requireRoles(...)`; sockets filter in `socket.auth`. JWT-less socket exceptions: the Packet Tracer extension (Qt user-agent / `clientType=packet-tracer`) and `clientType=backend-agent`.
- **`GET /api/logs` is user-isolated**: ADMIN sees all; `USER`/`STAFF` only rows with `userId` = their id, and `userId = null` rows (cronjobs and system actions) ADMIN-only. The filter is **mandatory** in the `where` for non-ADMIN roles, never "if provided". Any new log must write `userId` or its author will never see it. Same for **`GET /api/jobs`**: ADMIN/STAFF see all automations, `USER` only theirs (their `prompt` is the instruction the agent executes on the network). Detail in `packages/server/AGENTS.md`.
- **Scheduled jobs**: the scheduler is `packages/server/src/service/JobScheduler.ts` (**hybrid**: `node-schedule` only provides the one-shot timer and `cron-parser` decides when it fires; `node-cron` is gone). Each active automation owns its timer, so it **runs at the scheduled time, not "within the next minute"**. Inspect with `GET /api/jobs/scheduler` (ADMIN/STAFF). Never reintroduce a global tick.
- Roles: `USER` (read-only) < `STAFF` (devices/topologies/chats) < `ADMIN` (everything).
- Never publish runtime data: the root `.env`, `packages/server/.packet_tool_database.db` and `packages/server/uploads/` are gitignored and must stay untracked. No API keys or private tokens are hardcoded anywhere; if you add an integration needing one, read it from the env and document it in `.example.env` (placeholder value only).
- Do not add new dependencies when an installed alternative exists; check the package's `package.json` first. The root `package.json` already declares `deepagents`, `langchain` and `@langchain/core` in `dependencies`, and `packages/server/package.json` declares `deepagents`: reuse them instead of duplicating.

----

# CRITICAL RULES FOR AGENTS - MANDATORY

## PLANNING MODE

- Always ask clarifying questions before starting any task
- Never assume design, stack or features — always confirm with the user
- Use deep-analysis subagents to investigate and gather information
- Use deep-analysis subagents to review different aspects of your proposal to the user

## EDIT/CHANGE MODE

- Before new features: plan and ask; do not assume design, stack or features.
- Never implement features yourself when possible — use subagents!
- Identify plan changes that can run in parallel and use subagents to implement features efficiently
- When using subagents to implement features, act only as coordinator
- Use the best model per task — premium models for complex tasks (like coding), mid-tier for simpler ones (like docs)
- Once the plan is approved, run UI/frontend changes without extra confirmation.
- When a feature is done: lint + build (plus backend tests when relevant).

---
