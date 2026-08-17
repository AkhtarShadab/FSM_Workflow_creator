/**
 * R4 — Tool capability grants (FeatureShipping 014).
 * HMAC-SHA256 mint/verify; denied tools emit ::AI.TOOL_DENIED.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const TOOL_DENIED_SIGNAL = "::AI.TOOL_DENIED";

/** Test-only secret; production uses PLATFORM_SECRET env. */
export const TEST_TOOL_GRANT_SECRET = "test-tool-grant-secret-for-vitest";

export type ToolAccessMode = "inherit" | "allowlist" | "deny_all";

export interface ToolAccess {
  mode: ToolAccessMode;
  allow: string[];
}

export interface ToolGrant {
  token: string;
  toolName: string;
  runId: number;
  stateId: string;
  exp: number;
}

export interface MintToolGrantParams {
  runId: number;
  stateId: string;
  toolName: string;
  exp: number;
  secret?: string;
}

export interface DeniedEmission {
  signal: typeof TOOL_DENIED_SIGNAL;
  payload: {
    toolName: string;
    reason: string;
  };
}

function grantSecret(secret?: string): string {
  return secret ?? process.env.PLATFORM_SECRET ?? TEST_TOOL_GRANT_SECRET;
}

function grantPayload(runId: number, stateId: string, toolName: string, exp: number): string {
  return `${runId}|${stateId}|${toolName}|${exp}`;
}

function signGrantPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function mintToolGrant(params: MintToolGrantParams): ToolGrant {
  const secret = grantSecret(params.secret);
  const payload = grantPayload(
    params.runId,
    params.stateId,
    params.toolName,
    params.exp
  );
  return {
    token: signGrantPayload(payload, secret),
    toolName: params.toolName,
    runId: params.runId,
    stateId: params.stateId,
    exp: params.exp,
  };
}

export function verifyToolGrant(
  grant: ToolGrant,
  secret?: string,
  nowMs = Date.now()
): boolean {
  if (grant.exp <= nowMs) return false;
  const expected = signGrantPayload(
    grantPayload(grant.runId, grant.stateId, grant.toolName, grant.exp),
    grantSecret(secret)
  );
  const a = Buffer.from(grant.token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assertToolAllowed(grant: ToolGrant, toolName: string): void {
  if (!verifyToolGrant(grant)) {
    throw new ToolGrantError(toolName, "invalid_or_expired_grant");
  }
  if (grant.toolName !== toolName) {
    throw new ToolGrantError(toolName, "tool_name_mismatch");
  }
}

export class ToolGrantError extends Error {
  readonly toolName: string;
  readonly reason: string;

  constructor(toolName: string, reason: string) {
    super(`Tool denied: ${toolName} (${reason})`);
    this.name = "ToolGrantError";
    this.toolName = toolName;
    this.reason = reason;
  }
}

export function deniedEmission(toolName: string, reason = "not_in_allowlist"): DeniedEmission {
  return {
    signal: TOOL_DENIED_SIGNAL,
    payload: { toolName, reason },
  };
}

/**
 * Resolve effective tool names for a state access config.
 * Empty allowlist under allowlist mode denies all tools.
 */
export function resolveAllowedTools(
  access: ToolAccess,
  inheritTools: string[]
): string[] {
  if (access.mode === "deny_all") return [];
  if (access.mode === "inherit") return [...inheritTools];
  if (access.allow.length === 0) return [];
  const inheritSet = new Set(inheritTools);
  return access.allow.filter((name) => inheritSet.has(name));
}

export function assertToolInAllowlist(allow: string[], toolName: string): void {
  if (allow.length === 0 || !allow.includes(toolName)) {
    throw new ToolGrantError(toolName, "not_in_allowlist");
  }
}
