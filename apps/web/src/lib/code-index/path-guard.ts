import fs from "node:fs";
import path from "node:path";

/** Workspace root for local path indexing — paths must resolve under this directory. */
export function getWorkspaceRoot(): string {
  if (process.env.WORKSPACE_ROOT) {
    return path.resolve(process.env.WORKSPACE_ROOT);
  }

  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(process.cwd());
}

export type WorkspacePathResult =
  | { ok: true; path: string; relativePath: string }
  | { ok: false; error: string };

/**
 * Resolve a user-supplied path and ensure it stays inside the workspace.
 * Rejects traversal (`..`), absolute paths outside the root, and symlink escapes.
 */
export function resolveWorkspacePath(input: string): WorkspacePathResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Path is required" };
  }

  const root = getWorkspaceRoot();
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);

  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "Path must be inside the workspace" };
  }

  if (!fs.existsSync(candidate)) {
    return { ok: false, error: "Path does not exist" };
  }

  try {
    const real = fs.realpathSync(candidate);
    const realRelative = path.relative(root, real);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return { ok: false, error: "Path resolves outside the workspace" };
    }
    return { ok: true, path: real, relativePath: realRelative };
  } catch {
    return { ok: false, error: "Path is not readable" };
  }
}
