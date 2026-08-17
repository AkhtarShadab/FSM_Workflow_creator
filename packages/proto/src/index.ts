/**
 * Hand-written TypeScript mirrors of `harness.tools.v1` (tools.proto).
 * G1 does not require buf; `pnpm generate` uses buf when present and
 * otherwise keeps these types as the source of truth.
 */

export interface ToolRequest {
  toolName: string;
  runId: string;
  stateId: string;
  args: Record<string, string>;
  payload: unknown;
  timeoutMs: number;
}

export interface ToolResponse {
  exitCode: number;
  signal: string;
  result: unknown;
  stderr: string;
}

export type ToolEvent =
  | { kind: "log"; line: string }
  | { kind: "progress"; pct: number }
  | { kind: "done"; response: ToolResponse };

export interface ToolDescriptor {
  name: string;
  language: string;
  argSchema?: object;
  description?: string;
}

export interface DescribeResponse {
  tools: ToolDescriptor[];
}

export type ServingStatus = "serving" | "not_serving" | "unknown";

export interface HealthStatus {
  status: ServingStatus;
}
