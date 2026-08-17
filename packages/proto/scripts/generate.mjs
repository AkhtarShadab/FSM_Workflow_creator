#!/usr/bin/env node
/**
 * Optional buf codegen. G1 ships hand-written types in src/index.ts so a
 * missing buf binary does not fail the package.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const result = spawnSync("buf", ["generate"], {
  cwd: root,
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.warn(
    "[@fsm/proto] buf generate skipped (buf not installed or failed); using hand-written types in src/index.ts",
  );
  process.exit(0);
}
