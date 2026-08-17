import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
} from "./path-guard";

describe("resolveWorkspacePath", () => {
  let tmp: string;
  let previousRoot: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "code-index-"));
    previousRoot = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = tmp;
    fs.writeFileSync(path.join(tmp, "inside.ts"), "export const x = 1;");
  });

  afterEach(() => {
    if (previousRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previousRoot;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("allows paths inside the workspace root", () => {
    const result = resolveWorkspacePath("inside.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relativePath).toBe("inside.ts");
    }
  });

  it("rejects traversal outside the workspace", () => {
    expect(resolveWorkspacePath("../outside").ok).toBe(false);
    expect(resolveWorkspacePath("/etc/passwd").ok).toBe(false);
  });

  it("rejects missing paths", () => {
    const result = resolveWorkspacePath("missing.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exist/i);
    }
  });

  it("uses WORKSPACE_ROOT env when set", () => {
    expect(path.resolve(getWorkspaceRoot())).toBe(path.resolve(tmp));
  });
});
