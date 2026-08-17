import fs from "node:fs";
import path from "node:path";

export const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
]);

export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Max text file size indexed as source (1 MiB). */
export const MAX_FILE_BYTES = 1 * 1024 * 1024;

export interface WalkResult {
  files: string[];
  skippedLarge: number;
}

export function walkSourceFiles(rootDir: string): WalkResult {
  const files: string[] = [];
  let skippedLarge = 0;

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      if (entry.name.endsWith(".min.js")) continue;

      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE_BYTES) {
        skippedLarge += 1;
        continue;
      }

      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue;

      files.push(full);
    }
  }

  walk(rootDir);
  return { files, skippedLarge };
}
