import { describe, expect, it } from "vitest";
import {
  assertToolAllowed,
  assertToolInAllowlist,
  deniedEmission,
  mintToolGrant,
  resolveAllowedTools,
  TEST_TOOL_GRANT_SECRET,
  ToolGrantError,
  TOOL_DENIED_SIGNAL,
  verifyToolGrant,
} from "./tool-grants";

describe("R4 tool grants", () => {
  const now = Date.now();
  const exp = now + 60_000;

  it("mints and verifies HMAC grant", () => {
    const prev = process.env.PLATFORM_SECRET;
    process.env.PLATFORM_SECRET = TEST_TOOL_GRANT_SECRET;
    const grant = mintToolGrant({
      runId: 42,
      stateId: "S1",
      toolName: "fetch_pages",
      exp,
    });
    expect(verifyToolGrant(grant, TEST_TOOL_GRANT_SECRET, now)).toBe(true);
    assertToolAllowed(grant, "fetch_pages");
    process.env.PLATFORM_SECRET = prev;
  });

  it("expired token fails verification", () => {
    const grant = mintToolGrant({
      runId: 1,
      stateId: "S1",
      toolName: "tool_a",
      exp: now - 1,
      secret: TEST_TOOL_GRANT_SECRET,
    });
    expect(verifyToolGrant(grant, TEST_TOOL_GRANT_SECRET, now)).toBe(false);
    expect(() => assertToolAllowed(grant, "tool_a")).toThrow(ToolGrantError);
  });

  it("deniedEmission returns ::AI.TOOL_DENIED", () => {
    const emission = deniedEmission("bad_tool");
    expect(emission.signal).toBe(TOOL_DENIED_SIGNAL);
    expect(emission.payload.toolName).toBe("bad_tool");
    expect(emission.payload.reason).toBe("not_in_allowlist");
  });

  it("empty allowlist denies all tools", () => {
    const allowed = resolveAllowedTools(
      { mode: "allowlist", allow: [] },
      ["fetch_pages", "search"]
    );
    expect(allowed).toEqual([]);
    expect(() => assertToolInAllowlist(allowed, "fetch_pages")).toThrow(
      ToolGrantError
    );
  });

  it("allowlist intersects inherit mask", () => {
    const allowed = resolveAllowedTools(
      { mode: "allowlist", allow: ["fetch_pages", "external"] },
      ["fetch_pages", "search"]
    );
    expect(allowed).toEqual(["fetch_pages"]);
    assertToolInAllowlist(allowed, "fetch_pages");
  });
});
