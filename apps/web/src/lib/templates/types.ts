import type { CanvasData } from "@/lib/fsm-types";

/** Per-state emitted signals for a dry run, consumed in visit order. */
export type SignalOverrides = Record<string, string[]>;

export interface RunScenario {
  id: string;
  name: string;
  description: string;
  overrides: SignalOverrides;
  /** What a correct engine run should produce (used by tests + the demo). */
  expect: {
    status: "succeeded" | "failed";
    finalStateId?: string;
    errorIncludes?: string;
  };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  summary: string;
  /** Fresh copy of the canvas each call. */
  build: () => CanvasData;
  /** Custom signals / skills the template needs registered to lint clean. */
  registry: {
    signals: Array<{ signal: string; description?: string }>;
    skills: string[];
  };
  scenarios: RunScenario[];
}
