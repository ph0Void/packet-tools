# Desktop — Packet Tools (`@package/desktop`)

Electron packager (NSIS/AppImage/deb installers) for all of Packet Tools: Express backend, standalone Next frontend and seeded SQLite, with no Node required on the target machine.

Conventions: no comments in `main.js`/`scripts/` (removed on purpose); identifiers in English; user-facing log/error strings stay in Spanish.

## Command

From the monorepo root:

```
npm run build-desktop            # current platform (--win on Windows)
npm run build-desktop -- --linux # or --win / --mac
```

With `DESKTOP_OBFUSCATE=true` in the root `.env`, the pipeline also compiles the first-party code (backend and frontend) to V8 bytecode with bytenode before packaging (see `obfuscate.mjs` below). Default comes from `.example.env`.

It runs `packages/desktop/scripts/build.mjs` and leaves artifacts in `packages/desktop/dist/` (`*.exe` NSIS, `*.AppImage`, `*.deb`). There is intentionally no `build` script in this package: root `turbo build` must not pick it up; do not add one.

## Pipeline (`scripts/`)

1. `build.mjs` — orchestrator: downloads Electron if missing (`node_modules/electron/dist`), builds server (`tsc`) and web (standalone `next build`), runs `prepare.mjs`, `verify-native.mjs`, `obfuscate.mjs` (only when `DESKTOP_OBFUSCATE=true`), then `npx electron-builder -c.extraMetadata.version=<root version> -c.electronVersion=<installed version>`. Entry points: `runCommand`, `ensureElectron`, `resolvePlatformFlag`, `listArtifacts`.
2. `prepare.mjs` — wipes `.staging/` and assembles `.staging/resources/` (copied by `extraResources` to `<install>/resources/app`):
   ```
   .staging/resources/
   ├── build-info.json               # { name, version, serverPort, webPort, backendUrl }
   ├── node/                         # Node runtime (node.exe | bin/node)
   ├── server/
   │   ├── dist/                     # includes dist/desktop/Bootstrap.js and dist/package.json
   │   ├── migrations/               # copy of packages/server/prisma/migrations
   │   ├── package.json
   │   └── node_modules/             # production deps (npm ls --omit=dev --parseable)
   └── web/
       ├── node_modules/
       └── packages/web/{server.js,.next,public}
   ```
   Excludes `chromadb*`, `ffmpeg-static` and `fluent-ffmpeg`. `npm ls` may exit 1 on warnings (`extraneous`/`missing`) while still printing the full tree on stdout: the script parses stdout and ignores the status. On top of the `npm ls` tree, it adds the dependency closure of every package imported by `server/dist` (guards against hoisted-but-undeclared imports, e.g. `socket.io-client`). Key functions: `selectProductionDependencies`, `getImportedPackages`, `completeWithDistImports`, `getPackageNames`, `writeBuildInfo`, `locateWebServer`, `copyDirectory`.
3. `node-runtime.mjs` (called by `prepare.mjs`) — downloads the official Node distribution matching `process.versions.node` (verified against `SHASUMS256.txt`), caches it in `.cache/` and copies the binary to `resources/node/`. It is the backend runtime: Electron's Node is **not** used. Key functions: `prepareNodeRuntime`, `ensureDistribution`, `verifyChecksum`, `download`.
4. `verify-native.mjs` — checks that `better-sqlite3` and `serialport` load under the packaged Node (correct ABI) before packing.
5. `obfuscate.mjs` — only with `DESKTOP_OBFUSCATE=true`; otherwise exits 0 without touching anything. Over `.staging/resources` (never over `packages/server/dist`, which must stay readable for dev/tests/Docker):
   - compiles to `.jsc` with the **packaged Node** (`resources/node/node.exe`, same V8 as the runtime; a `.jsc` is not portable across versions) every `.js` in `server/dist` and in the standalone (`web/**/server.js` + `.next/server/**`), **except `**/*manifest*.js`** (Next reads them with `readFileSync` + `vm.runInNewContext` and stubs would break them);
   - each compiled `.js` is replaced by a 2-line stub (`require("bytenode"); module.exports = require("./X.jsc")`) — literal-extension `require`s resolve to the real `.jsc` — `*.js.map` files are deleted and `bytenode` is copied into `server/node_modules` and `web/node_modules`;
   - final smoke run with the packaged Node: `require()` of one backend stub and one pure turbopack chunk; if any `.jsc` is rejected the build aborts.
   - Dev flags: `--root <dir>` (another staging dir, e.g. fixtures) and `--force`. Key functions: `parseArgs`, `splitBatches`, `buildWorkerSource`, `runWorker`, `accumulate` (`{ compiled, skipped }`), `deleteSourceMaps`, `resolveBytenodeSource`, `copyBytenode`, `verifyResolution`, `pickBackendSmoke`, `pickFrontendSmoke`, `runSmoke`, `resolveNodeBinary`, `verifyCommonjsOutput`.
6. `env.mjs` — minimal root-`.env` parser (`parseEnv`, `loadRootEnv`) plus installed-Electron version reader (`readElectronVersion`), dependency-free.

## Runtime (`main.js`)

- Dev (`!app.isPackaged`): opens `ELECTRON_START_URL` or `http://localhost:3090` (turbo dev runs everything).
- Production (`startProduction`): pins the name `Packet Tools` (`app.setName` + `app.setPath("userData", ...)`; otherwise it would land in `%APPDATA%\@package\desktop` because of the workspace name); creates `userData`, `userData/uploads/documents` and `userData/logs`; generates/reads `userData/.jwt-secret` (64 hex) and uses `userData/packet_tool_database.db`.
- Checks that 7531/3090 are free (`isPortAvailable`) and spawns children with the packaged Node (`resources/app/node/...`, never `fork` nor `process.execPath`): `Bootstrap.js` (migrations+seed, exit 0, 120 s) → `dist/app.js` (health `/api/health`, 60 s) → `web/**/server.js` (`PORT`/`HOSTNAME`, 90 s) → 1200x800 window. Helpers: `readBuildInfo`, `getJwtSecret`, `resolveNode`, `launchChild`, `waitForExit`, `waitForHttp`, `locateWebServer`, `resolveIcon`, `createWindow`, `killChildren`, `failWithError`.
- On exit it kills the children (`before-quit`/`will-quit`/`exit`) so no orphans remain; any failure shows `dialog.showErrorBox` with the cause plus the log tail and exits 1.

## Ports

- Backend `7531`, web `3090` (`build-info.json`). The web bakes `NEXT_PUBLIC_BACKEND_URL` at build time; do not change it at runtime.
- **The UI is served and opened via `localhost`, never `127.0.0.1`**: the web compiles `NEXT_PUBLIC_BACKEND_URL=http://localhost:7531` and the session cookie is host-only (no `domain`). If the page lived on `127.0.0.1`, the browser would not send the cookie to the backend and chat SSE (401 "Autenticación requerida") and Socket.IO (NavBar "Desconectado", terminal stuck on "Conectando…") would fail. The web server's `HOSTNAME=::` is dual-stack so `localhost` works over IPv4 and IPv6.

## Gotchas

- **Version alignment**: `scripts/build.mjs` stamps the installer with the **root** `package.json` version (`-c.extraMetadata.version`), and `build-info.json` uses the same so the app reports what is installed. All four `package.json` files are currently **1.2.1** — keep them aligned before shipping a build.
- **Node ABI, not Electron's**: the backend runs on the packaged Node (`resources/app/node/`), so `better-sqlite3` uses the Node prebuild from `node_modules` and Visual Studio Build Tools are **not** needed. If `node_modules` was installed with another Node version, `verify-native.mjs` catches it; re-run `npm install` with the current Node.
- **`.cache/`**: downloaded Node distribution; gitignored, reused across builds. `packages/desktop/dist` and `.staging` are also gitignored and regenerated every build — never edit them by hand.
- **Network required**: downloading Electron, the Node distribution, electron-builder binaries (NSIS/winCodeSign) and `next/font` sources.
- **Cross-platform**: NSIS only builds on Windows; `.deb`/AppImage need Linux (or Docker/WSL).
- **Do not run `electron-builder` standalone**: it depends on `.staging/resources` already prepared by the pipeline.
- **Obfuscation (`DESKTOP_OBFUSCATE`)**: `bytenode` is a devDependency of this package (never packed); the compile worker resolves it by absolute path from the monorepo node_modules. Moving `packages/server` to ESM would break `obfuscate.mjs` (bytenode only compiles CJS) — the contract lives in `packages/server/AGENTS.md`. A `.jsc` is pinned to the exact V8 of the build machine's `process.versions.node`: on Node upgrades, rebuild (the script's own smoke test detects it). `.next/static` (client JS) is **not** obfuscated: unavoidable.
- **Never commit runtime data**: `userData/` (database, `.jwt-secret`, `uploads/`, `logs/`) lives outside the repo by design; likewise `packages/server/.packet_tool_database.db` and `packages/server/uploads/` are gitignored and must stay untracked before any public push.
