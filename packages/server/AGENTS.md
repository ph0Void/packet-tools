# Backend — Packet Tools (`@packet-tools/server`)

Express 5 + TypeScript run with `tsx` in development (no build). The package compiles to **CommonJS** (see below). Entry point: `src/app.ts` (API under `/api`, Socket.IO and cron in the same process). Public docs in `README.md`.

Code, comments and identifiers in `src/` are in Spanish by convention (e.g. `turnoStream.ts`, `paginacion.ts`, `adjuntos.ts`); this file is in English so external agents can work here.

## Commands

From `packages/server` or with `--workspace=@packet-tools/server`; from the root, scripts already inject the `.env` (workspace scripts do not).

| Script | Real command | Note |
| --- | --- | --- |
| `dev` | `tsx watch src/app.ts` | live reload |
| `build` | `node scripts/clean-dist.mjs && tsc && node scripts/rewrite-dist.mjs && node scripts/postbuild.mjs` | wipes `dist/` (tsc does not clean: deleted sources would leave stale ESM behind), compiles to **CJS** and leaves `dist/` loadable by Node (rewrites the `@/` alias, `require("@/…")` and extension-less relative imports; writes `dist/package.json` with `"type":"commonjs"` and aborts if any file still has `import.meta` or ESM syntax) |
| `start` | `node dist/app.js` | requires a prior `npm run build` |
| `test` | `vitest run` | see below |
| `migrate` / `migrate:deploy` | `prisma migrate dev` / `deploy` | |
| `generate` / `reset` / `seed` / `studio` | Prisma and initial data; `generate` also runs `scripts/patch-generated.mjs` (rewrites the `import.meta` Prisma injects into `src/prisma/generated/client.ts` to `__dirname`; without it the CJS emit breaks at runtime) | |
| `eval` | `tsx test/agent-evals/run.ts` | agent evals |
| `test-pt` / `test-terminal` / `test-telnet` / `test-ssh` / `test-serial` / `test-gns3` | live suites against real transports | each has its own subfolder under `test/`; `test-pt` needs Packet Tracer + the extension connected |

- Tests in `test/` (84 `*.test.ts` + `helpers.ts`), Vitest + supertest against the exported `app`. `fileParallelism: false`, timeout 20 s; socket tests open an ephemeral port.
- Under Vitest the server listens on **no port** and with `NODE_ENV=test` cron is disabled (guards in `src/app.ts`).
- No lint script: verify with `npm test` and `npm run build`.
- **CommonJS, not ESM**: `tsconfig.json` uses `module: commonjs` + `moduleResolution: node10`. `__dirname`/`__filename` are available; `import.meta` is forbidden (enforced by `postbuild.mjs`). The reason is desktop-installer obfuscation with bytenode (`DESKTOP_OBFUSCATE`), which only compiles CJS — do not go back to ESM without reviewing `packages/desktop/scripts/obfuscate.mjs`.

## Environment and database

- Mandatory `.env` at the monorepo root. `EnvConfig.ts`, `PrismaClient.ts` and `prisma.config.ts` find it via walk-up because turbo only propagates `turbo.json#globalEnv`; when adding a variable, list it there too. All `AGENT_*` are already listed.
- Main variables read by `src/config/EnvConfig.ts` (with code defaults): `SERVER_PORT` (7531), `NODE_ENV` (`development`), `JWT_SECRET` (`packet-tools-development-secret` — dev only, set a real one), `JWT_EXPIRATION` (`30d`), `RATE_LIMIT_REFRESH` (900000), `RATE_LIMIT_REQUESTS` (100), `AGENT_HISTORY_MESSAGES` (8), `AGENT_CONTEXT_TOKENS` (10000), `AGENT_TOOL_OUTPUT_CHARS` (4000), `AGENT_CONTENT_CHARS` (4000), `AGENT_USER_MESSAGE_CHARS` (8000), `AGENT_RECURSION_LIMIT` (600, single source), `AGENT_CONTEXT_EDIT_TOKENS` (48000), `AGENT_TOKEN_LOGGING` (false), `AGENT_PROMPT_CACHING` (true), `AGENT_LAZY_TOOLS` (true), `AGENT_SUBAGENT_LOGGING` (true), `AGENT_MAX_OUTPUT_TOKENS` (4000), `AGENT_PROVIDER_TIMEOUT_MS` (120000), `AGENT_PROVIDER_MAX_RETRIES` (2), `AGENT_TURN_TIMEOUT_MS` (300000), `AGENT_DUPLICATE_TOOL_GUARD` (true), `ATTACHMENTS_DIR` (`uploads/attachments`), `ATTACHMENT_MAX_BYTES` (10 MB), `PT_EXTENSION_SECRET` (empty), `CORS_ORIGINS` (both localhost ports), `CHAT_MESSAGES_RATE_LIMIT` (30), `FAST_PATH_ENABLED` (false). `DATABASE_URL` has no code default — it comes from the `.env`.
- Prisma 7 + SQLite with the `better-sqlite3` adapter. Schema in `prisma/schema.prisma` (14 models: `User`, `Configuration`, `ModelProvider`, `Chat`, `Message`, `Attachment`, `KnowledgeBase`, `DeviceProviders`, `Topology`, `ClientTopology`, `Log`, `Alert`, `ConfigTemplate`, `CronJob`), migrations in `prisma/migrations`, config in `prisma.config.ts`.
- Generated client in `src/prisma/generated` (**not** in `node_modules/@prisma/client`); import via `@/prisma/generated/...`. After schema changes: `npm run migrate` + `npm run generate`.
- The SQLite file lives at `packages/server/.packet_tool_database.db`; `DATABASE_URL` accepts an absolute path. `npm run reset` destroys it. **The database and `packages/server/uploads/` are gitignored and must stay untracked — never commit them to the public repo.**
- **D6 — chat attachments are NOT in the database**: content lives in `ATTACHMENTS_DIR` (default `uploads/attachments`, relative to `packages/server`) and `Attachment` only stores metadata. Modules: `src/api/router/adjuntos.ts` (validation, atomic write, `sha256`-based paths) and `scripts/migrate-adjuntos.ts` (`--dry-run`, `--revert`; test with `scripts/probar-migracion-adjuntos.ts` on a **copy** of the DB).
- Idempotent seed (`src/seed/SeedService.ts` → `runSeed()`; CLI in `src/seed/seed.ts`): user `admin/admin123` (ADMIN), Packet Tracer/GNS3 providers and two inactive LM Studio models (CHAT `qwen3.5-4b`, EMBEDDING `nomic-embed-text-v1.5`). RAG documents go to `packages/server/uploads/documents`. Change the admin password before exposing the service.
- `src/desktop/Bootstrap.ts` is the packaged-backend boot (Electron): resolves `DATABASE_URL` (mandatory; relative = `packages/server` root), applies `prisma/migrations` with its own runner over `better-sqlite3` (`MIGRATIONS_DIR` optional, else tries `<pkg>/migrations` and `<pkg>/prisma/migrations`) and runs `runSeed()`. Runnable with `node dist/desktop/Bootstrap.js`.

## API

- Routers in `src/api/router/` (21 files), mounted in `src/api/ServerApi.ts`. Generic CRUD via `resourceRouter(model, { roles, ownerField, scopeReads, adminMutations })`; the model must be in the `Model` union of `ResourceRouter.ts`.
- Response shape `{ success, message, data }`; `safe()` strips `password`/`token` and masks `apiKey` as `"[configured]"`.
- Rate limit only on `/api/auth`. Centralized errors in `src/middleware/error.middleware.ts` (ZodError → 400, P2002 → 409).
- `src/controller/*` is legacy unused code: routers talk to services/Prisma directly. Do not use it as a pattern.
- Chat SSE: `POST /api/chats/:id/messages`. The event contract is documented in the comment of `src/api/router/ChatsRouter.ts` and consumed by `packages/web/src/hooks/useCiscoChat.ts`: changing events or fields means updating both sides. Two layers: base events (unchanged) plus agentic-transparency events (`plan_update`, `skill_loading`, `skill_loaded`, `skill_created`, `subagent_started`, `subagent_completed`, `rag_retrieved`, `admin_action`), which are **additive** (an old client ignores them). The supervisor is the only orchestrator, so they are emitted whenever there is transparency to report.
- Skills in `src/api/router/DataRouter.ts`: `GET /api/data/skills` for any authenticated user (including `USER`); `POST` and `PUT` require `ADMIN`/`STAFF`; `DELETE` ADMIN only. `GET /api/data` returns only documents (`type=DATA`); skills never mix into RAG.

### Logs: isolation and agent trace

- **`GET /api/logs` is NOT global.** ADMIN sees everything; `USER` and `STAFF` see **only** rows with `userId` = their id, and rows with `userId = null` (cronjobs and system actions) are ADMIN-only. The `userId` filter is **mandatory** in the `where` for non-ADMIN roles, never "if provided". Each item adds `actor` (`{id, username, role}` or `null`), resolved with **one** extra query for the page's ids (never one `include` per item). `DELETE` stays ADMIN-only.
- `Log.level` is a free **`String`** (not an enum): agent levels are `AGENT_TURN`, `AGENT_PLAN`, `AGENT_DELEGATION`, `AGENT_TOOL`, `AGENT_SKILL`, `AGENT_RAG`, `AGENT_APPROVAL`, and a failed turn reuses `ERROR` so it shows when filtering by `ERROR`. `GET /api/logs/levels` = canonical ∪ distinct levels present in the table; the frontend dropdown consumes it, so **do not** hardcode levels there.
- `userId` is written by: the agent trace (`turnoStream`), `systemAdmin`'s `auditar`, `skills`' `auditarSkill` (the active topology's `ownerId`), `CronExecutorService`'s `log.create` calls and `ciscoPacketTracer`'s `createLog`. **A new log must carry `userId`** or its author will never see it.
- **`GET /api/jobs` and `GET /api/jobs/:id` are also user-isolated** (same rule as logs): ADMIN and STAFF see all automations, `USER` only theirs with the filter **mandatory** in the `where` (and `404`, not `403`, on another user's detail). `GET /api/jobs/scheduler` (ADMIN/STAFF, registered **before** `/:id`) returns the scheduler snapshot: the way to verify an automation is really **armed** in memory. `POST /api/jobs/:id/run` **runs immediately** and returns the execution result, not a "<1 min" promise.

### Chat: the turn lives outside the router

`ChatsRouter.ts` decides **whether** a turn opens; **how** it runs lives in
`src/api/router/turnoStream.ts`. Both turn endpoints use it, so they cannot diverge:

- `POST /api/chats/:id/messages` — creates the user message and runs the turn.
- `POST /api/chats/:id/messages/:messageId/retry` — **real retry**: does not create or re-insert the user message, reuses its `threadId` (`chatId:messageId`, derived as in `src/agent/deep/turn.ts`) and does **not** re-emit `user_message` (the client already has it; re-emitting would duplicate it in the UI). `404` if the chat is not the user's or the message is not a user message of that chat; `409 TURNO_EN_CURSO` (same lock as sending); `409 YA_REINTENTADO` with `data.assistantMessageId` if that message already has a **complete** assistant turn. "Complete" is decided by `corteTurno.ts` (the durable `AVISO_TURNO_*` notice), not by message existence: a cut turn also persists one, and that is exactly the one worth retrying.

### Pagination

`src/api/router/paginacion.ts` is the single source for `limit`/`cursor`/`page` and the `ORDEN_*` constants (cursor filter and `orderBy` read the same constant: if the filter compares with `>` and the order is `DESC`, the cursor returns the previous page). Without parameters, both endpoints return everything (compatibility).

**`GET /api/chats` contract change**: by default it returns the **summary** (`id`, `title`, selection, `createdAt`, `updatedAt`, `messageCount`, `attachmentCount`) and no longer includes `messages`/`attachments` — that `include` made the sidebar download the full history of every conversation. Full history needs `?include=messages`. The response adds `meta` (`limit`, `nextCursor`, `hasMore`, `count`); `data` stays a flat array.

### Attachments

- `GET /api/chats/attachments/:id` is the **only** read path: content is not in the database. It validates ownership (attachment or chat owner, or ADMIN) and answers `404` — not `403` — to everyone else, so ids cannot be probed (cuids are enumerable). Persisted-mime `Content-Type` + `X-Content-Type-Options: nosniff`; `Cache-Control: private` (never public: user content).
- Mimes: **closed** list in `adjuntos.ts`: png/jpeg/gif/webp + pdf/txt/md/csv/json. Anything else is `400`. Leading bytes are also checked against the mime, so an executable cannot be served as `image/png`.
- Two distinct `413`/`400`: a file over `ATTACHMENT_MAX_BYTES` is `400` (retryable with a smaller one) and a data-URL that does not even decode is `413`.
- `storagePath` derives from `sha256` (`<2 chars>/<sha>.<ext>`), so identical content is never written twice and migration is idempotent.

## Agents

- **Single orchestration: Deep Agents, no flags.** The `src/agent/deep/` supervisor is the only orchestrator (legacy `StateGraph` removed) and the only HITL is `ApprovalMiddleware` (native `interruptOn` retired). There are no orchestration or approval flags left.
- `src/agent/deep/`: `DeepSupervisor` (local entry `createDeepSupervisor`; **`createDeepAgent` is not project code**, it is the import from the external `deepagents` library), `subagents` (catalog), `runner` (per model+role agent cache), `turn` (turn streaming and bounded skill projection into `state.files`), `handoff`, `transparency` (8 SSE events), `agentLog` (trace in `Log`), `metrics`, `context` (`contextSchema`), plus `fastPath*`, `delegacionStream`, `duplicateGuardMiddleware`, `retryGuardMiddleware`, `turnPlazo*`, `streamChunk`.
- **`src/agent/deep/agentLog.ts` — the agent trace in the `Log` table** (shown at `/dashboard/log`). Three non-negotiable constraints:
  1. **No tokens consumed**: zero model calls and zero new prompt text. Only SQLite writes.
  2. **Zero per-token work**: the event observer is **synchronous**, no `await`, with a **closed 12-event whitelist**. `text_delta` and `reasoning` arrive once per token and are **not** recorded (thousands of rows per turn); neither are `tool_call_chunks`, `user_message`, `complete`, `handoff`, `admin_action` or `error`. **When adding an event to the whitelist, never add a per-token one.**
  3. **Never blocks the stream**: enqueue is just `push`; flushing happens in `setImmediate`, in batches of 10, capped at 200 pending (drops oldest, warns once) with one retry per entry.
- Single write point with the `Configuration.agentLogsEnabled` switch check (5-min in-memory cache, **fail-open**: unreadable config traces more, not less). `ConfigService` → `agentLog` is the only dependency direction, to avoid a cycle.
- The hook is **`send` in `turnoStream.ts`**: the turn's only fan-out (base, transparency and tool-emitted events all pass through). Cron uses separate start/end turn recorders (no SSE) with `userId: null` on purpose: it is the system.
- The switch is flipped by ADMIN from `/dashboard/configuration`, via `PUT /api/config/logs`, via the `setAgentLogsEnabled` tool (reversible → `autoApprove`, no confirmation) or from chat. Turning it off never deletes what is already written. System logs (INFO, CREATE, CONFIGURE, CRON_EXECUTION, ADMIN_ACTION) are always captured regardless.
- Dependencies: `packages/server/package.json` declares `deepagents`; `langchain` and `@langchain/core` live in the root `dependencies`. Do not duplicate them.
- Sub-agents register as `CompiledSubAgent` with `runnable:` (the `createXAgent` of `src/agent/<tipo>/`), so tools, prompt and middleware stay intact. Deep Agents isolates them: they receive **only** the delegated task, never the history.
- `src/agent/skills/`: **no files on disk**. The loader projects the `KnowledgeBase type=SKILL` table to an in-memory virtual filesystem (`/skills/<slug>/SKILL.md`) with a 5-min cache invalidated on write; titles are normalized with `slugify`.
- Skills reach the agent through `state.files`, which is **mandatory**: deepagents resolves its default backend as `StateBackend` and both `SkillsMiddleware.beforeModel` (lists `/skills/` and reads each `SKILL.md` frontmatter for the catalog) and the `read_file` tool read from there. Hence `turn.ts:buildTurnFiles` bounds the payload instead of inventing another channel: per-skill cap (24 000 chars) and per-turn cap (120 000), with the `@skill:<slug>` skill prioritized and an explicit notice when anything is trimmed.
- `src/agent/systemAdmin/`: cronjob, connection and global-config administration from chat. ADMIN has full CRUD; STAFF reads and creates/edits skills but never deletes. Every write is audited in `Log` with `level="ADMIN_ACTION"`, now also with the turn's `userId`.
- Each new specialist under `src/agent/<tipo>/` follows the three-file convention (`Agent.ts`, `Tool.ts`, `Promt.ts`, typo included).
- Per-turn step budget: `AGENT_RECURSION_LIMIT` (supersteps, default 600) is the **single source**; `AGENT_SPECIALIST_MODEL_LIMIT`/`AGENT_SPECIALIST_TOOL_LIMIT` (`EnvConfig.ts`) and `AGENT_SUPERVISOR_RECURSION_LIMIT` derive from it. `src/agent/deep/budgetMiddleware.ts` enforces the cooperative stop (70 % warning, graceful cut at 95 %, identical tool-call blocking) so LangGraph's `GraphRecursionError` never fires. On exhaustion, the chat persists the notice + plan and the UI offers "Continuar tarea".
- Model creation in `src/agent/Model.ts` + `src/config/ModelProviderConfig.ts` (OPENAI, GOOGLE, ANTHROPIC, OPENROUTER, OLLAMA, LMSTUDIO, CUSTOM; CHAT and EMBEDDING).
- Turn context precedence: `@dispositivo` mention > selector `connectionId` > `terminalSessionId` > active console (only if `origin=terminal`). `@rag` pre-queries the knowledge base; `@web` forces web search; `@skill:<slug>` forces reading `/skills/<slug>/SKILL.md` first. `rag`, `web` and `skill` are **reserved** mentions: never interpreted as device names.
- Hybrid RAG in `src/service/HybridSearchService.ts` (semantic + lexical, RRF fusion, `type` filter); web goes through `src/service/WebCacheService.ts` (1 h search cache, 30 min page cache, dedup, text extraction).
- Cron (`INTELLIGENT`): `src/service/CronExecutorService.ts` calls `invokeTurn(...)` from `agent/deep/turn` — cronjobs run the same Deep Agents supervisor as chat.
- **Scheduled jobs (`src/service/JobScheduler.ts`)** — hybrid, do not touch without understanding why:
  - `node-schedule` provides **only** the ONE-shot timer for an exact date (`scheduleJob("cronjob:<id>", date, cb)`). The key is `cronjob:<id>`, never the name (names repeat and `cancelJob` would hit the wrong one).
  - `cron-parser` is the **single source of truth** for "when it fires": `calcularProximaEjecucion(job)` (counted from **now**). Never use `scheduleJob(name, fn, cron)`: node-schedule embeds its own `cron-parser@4`, so parsing would duplicate and its state would diverge from the DB `nextRun`.
  - **`nextRun` precedence**: `programarJob` always recalculates (and fixes the row on mismatch); `iniciarProgramador` **honors a stored `nextRun`**, because a past `nextRun` is what **detects the missed run** (server was down when due). Recalculating there would silently skip it. Do not "unify" both rules.
  - **Lifecycle**: recurrent → runs and rearms the next occurrence (one failure never disables it); one-shot (`scheduledAt`) → **closes** (`isActive:false`, `nextRun:null`), never rearms. On boot, an active job with an expired `nextRun` recovers by running **once** (serial chain, backgrounded so port opening is not delayed).
  - **Overlap guard**: in-memory Set, not the DB `status === "RUNNING"` (stale after a crash).
  - `CronJobService` syncs the scheduler on `create`/`update`/`toggleStatus`/`delete`: saved means **armed in the same instant**.
  - **There is a real import cycle** `JobScheduler ⇄ CronExecutorService` (executor imports `calcularProximaEjecucion`; scheduler calls the executor). It works because usage is runtime-only and `calcularProximaEjecucion` is a hoisted `function` declaration, while `cronExecutorService` is a `const` evaluated on the second import. **Adding module-time usage (a top-level `const x = cronExecutorService…`) blows up with TDZ**: then extract `calcularProximaEjecucion` to a dependency-free module. `CronExecutorService` → `CronJobService` is forbidden.
  - `CronCommandRunner.ts` is what actually runs `STANDARD` jobs: SSH, Telnet, serial and Packet Tracer (GNS3 **not** supported, and it says so). `deviceProviderId` is mandatory (a topology never implies which device to command) and commands come from `payload` (`{"commands":[…]}`, JSON array or plain text), capped at 30 commands / 8000 chars.
  - `node-schedule` 2.1.1 has **no `cancelAllJobs`**: shutdown cancels `schedule.scheduledJobs` one by one.
- **HITL: only `src/agent/approval/ApprovalMiddleware.ts`** (single approval gate). It pauses **inside** the tool while the user decides, so the chat SSE stream stays a single one. Registry is `ApprovalBroker`, endpoint `POST /api/chats/approvals/:approvalId` unchanged. Check order: (0) missing `toolCallId` → error; (0.5) CLI tool with no live console → `TERMINAL_REQUIRED`; (1) **`USER`-role gate → `[BLOQUEADO_ROL]` for every `mutating` tool, before any shortcut and without relying on the tool validating the role**; (2) whole batch of session-closing commands → `[SESION_PROTEGIDA]`; (3) `readonly`, `autoApprove` or non-mutating `internal` → direct; (4) CLI with all read-only commands → direct; (5) declared `autonomous` and non-dangerous → direct; (5.1) dangerous **without** `approvalChannel` → explicit rejection, bypassing the broker (cron); (6) no `approvalChannel` → auto-approved with `Logger.warning`; (7) real HITL → `tool_approval_required` + wait. `ToolPolicy.autoApprove` marks **reversible** mutations (create/edit) so they skip confirmation; after 2 rejections of the same chat+tool, retries stop (reset by `resetApprovalAttempts(chatId)`).
- Cron (`autonomous`/channel-less): reversibles self-approve, command-dangerous block immediately, irreversibles without commands self-approve with audit. Never request approval from a broker with no emitter.
- Risk classification in `src/agent/security/CommandClassifier.ts` (blocklist: `reload`, `write erase`, `erase`, `format`, `delete`, `boot system`). Destructives never self-approve without an interactive channel; session closers (`exit`, `quit`, `logout`) are batch-blocked.
- Terminal tools (`src/agent/tools/TerminalTools.ts`) operate **only** the user's active console via `TerminalSessionHub`; they never open new connections and must not close the session.

## Sockets

- Registered in `src/app.ts`: `socket.auth` (cookie or handshake JWT; **no-JWT**: PT extension with Qt user-agent or `clientType=packet-tracer`, and `clientType=backend-agent`), `simulation.socket` (`tool_call`/`tool_result` bridge with Packet Tracer) and `terminal.socket` (SSH/Telnet/Serial consoles, `terminal:*` events).
- While the agent operates a console, the server emits `terminal:busy` and drops user keystrokes.

## Conventions

- Spanish comments; `@` imports → `src/`.
- New files in `src/agent/<tipo>/` always come in threes (`Agent.ts`, `Tool.ts`, `Promt.ts`).
