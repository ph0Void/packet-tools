import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

process.env.NODE_ENV = "production";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
