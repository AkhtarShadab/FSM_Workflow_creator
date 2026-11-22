import {
  DEFAULT_SELF_LOOP_MAX_ITERATIONS,
  defaultNodeData,
  edgeTypeForSignal,
  type CanvasData,
  type FSMStateType,
  type StateNode,
  type StateNodeData,
  type TransitionEdge,
  type TransitionEdgeKind,
} from "@/lib/fsm-types";
import type { WorkflowTemplate } from "./types";

/**
 * Water-utility inspection → triage → crew dispatch.
 *
 * Field crews / CCTV crawlers / sensors produce inspection records. The
 * harness validates them, fans out to specialist AI inspectors in parallel,
 * merges their findings, checkpoints the context (raw footage is dehydrated
 * so the triage model only sees a summary), triages risk, keeps a supervisor
 * in the loop for critical findings, and raises a work order for the crew.
 *
 * Endpoints use example-utility.com placeholders — swap for the real asset
 * system / CMMS when wiring live executors (Feature 003).
 */

const node = (
  id: string,
  type: FSMStateType,
  label: string,
  x: number,
  y: number,
  patch: Partial<StateNodeData> = {}
): StateNode => {
  const base = defaultNodeData(type, label);
  return {
    id,
    type: "stateCircle",
    position: { x, y },
    data: { ...base, ...patch, stateType: type, label },
  };
};

let edgeSeq = 0;
const edge = (
  source: string,
  target: string,
  signal: string,
  kind: TransitionEdgeKind = source === target ? "self-loop" : "transition",
  maxIterations?: number
): TransitionEdge => ({
  id: `wi-e${++edgeSeq}-${source}-${target}`,
  source,
  target,
  type: edgeTypeForSignal(signal),
  label: signal,
  data: {
    signal,
    kind,
    ...(kind === "self-loop"
      ? { maxIterations: maxIterations ?? DEFAULT_SELF_LOOP_MAX_ITERATIONS }
      : {}),
  },
});

export const TRIAGE_CRITICAL = "::TRIAGE.CRITICAL";

const SKILLS = ["pacp-defect-coding", "acoustic-leak-detection", "drinking-water-compliance"];

function build(): CanvasData {
  edgeSeq = 0;
  const g = { timeoutMs: 30000, retryMax: 2, retryBackoffMs: 1000 };

  const nodes: StateNode[] = [
    node("wi_start", "START", "Shift start", 0, 260, {
      description: "Hydrate the phase map for today's inspection batch.",
    }),
    node("wi_fetch", "HTTP", "Pull inspection batch", 240, 260, {
      description: "New CCTV / field inspection records from the asset system.",
      http: {
        method: "GET",
        urlTemplate: "https://assets.example-utility.com/api/inspections?status=new",
        headers: { Accept: "application/json" },
        successSignals: ["::HTTP.NEXT"],
      },
      guardrails: { ...g, timeoutMs: 15000 },
    }),
    node("wi_validate", "VALIDATE", "Validate records", 480, 260, {
      description: "Reject records missing asset id, footage or segment length.",
      validate: {
        kind: "schema",
        schema: JSON.stringify({
          type: "object",
          required: ["asset_id", "video_url", "segment_m"],
        }),
      },
      verify: { kind: "schema" },
      onError: { signal: "::VALIDATE.ERROR" },
    }),
    node("wi_spawn", "SPAWN", "Specialist AI inspectors", 720, 260, {
      description: "Defect coding, leak acoustics and water quality run in parallel.",
      spawn: {
        mode: "heterogeneous",
        count: 3,
        maxConcurrency: 3,
        strategy: "waitAll",
        cancelOnParentHalt: true,
        aggregateTo: "wi_merge",
        profiles: [
          {
            id: "defects",
            childFsm: "pacp-defect-coder",
            toolPack: ["extract_frames", "classify_defects"],
            skillPack: ["pacp-defect-coding"],
            timeoutMs: 120000,
          },
          {
            id: "leaks",
            childFsm: "leak-acoustic-analyzer",
            toolPack: ["fetch_acoustic_logs", "detect_leak_signature"],
            skillPack: ["acoustic-leak-detection"],
            timeoutMs: 60000,
          },
          {
            id: "quality",
            childFsm: "water-quality-checker",
            toolPack: ["fetch_lab_results", "check_thresholds"],
            skillPack: ["drinking-water-compliance"],
            timeoutMs: 30000,
          },
        ],
      },
      guardrails: { ...g, timeoutMs: 180000, retryMax: 0 },
    }),
    node("wi_merge", "AGGREGATE", "Merge findings", 960, 260, {
      description: "One envelope per inspector (ok / error / timeout).",
      aggregate: { fromSpawnId: "wi_spawn", strategy: "waitAll" },
    }),
    node("wi_checkpoint", "SYSTEM_FUNCTION", "Checkpoint context", 1200, 260, {
      description: "Dehydrate raw footage + logs; hydrate a compact summary for triage.",
      systemFunction: {
        summaryStrategy: "template",
        enabledStateIds: [],
        disabledStateIds: [],
        rewire: [],
        heads: [
          { id: "findings-in", label: "Findings in", direction: "in", componentRef: "wi_merge" },
          { id: "summary-out", label: "Summary out", direction: "out", componentRef: "wi_triage" },
        ],
      },
    }),
    node("wi_triage", "AI", "Risk triage", 1440, 260, {
      description: "Severity + priority per asset; critical findings need sign-off.",
      ai: {
        credentialId: "",
        model: "claude-sonnet-4-5",
        temperature: 0.1,
        maxTokens: 1500,
        systemPrompt:
          "You are a water-network asset engineer. Given merged inspector findings, " +
          "return JSON {asset_id, severity: low|medium|high|critical, defect_codes, " +
          "recommended_action, rationale}. Emit ::TRIAGE.CRITICAL for critical or " +
          "public-health risks, otherwise ::AI.NEXT.",
        outputSchema: JSON.stringify({
          type: "object",
          required: ["asset_id", "severity", "recommended_action"],
        }),
      },
      onError: { signal: "::AI.VALIDATION_ERROR" },
    }),
    node("wi_review", "HUMAN", "Supervisor sign-off", 1700, 120, {
      description: "Human-in-the-loop for critical findings before crews roll.",
      human: {
        prompt:
          "Critical finding on {{asset_id}}. Approve the urgent work order, send it back " +
          "for re-triage with notes, or reject as a false positive.",
        approvalSignals: ["::HUMAN.APPROVE", "::HUMAN.EDIT", "::HUMAN.REJECT"],
        assignTo: "network-ops-supervisor",
        timeoutMs: 2 * 60 * 60 * 1000,
        onTimeout: { signal: "::HUMAN.TIMEOUT" },
      },
    }),
    node("wi_schedule", "SCRIPT", "Schedule routine work", 1700, 400, {
      description: "Low/medium findings go into the planned-maintenance queue.",
      script: {
        toolName: "schedule_routine_work",
        language: "python",
        code:
          "def run(args, payload):\n" +
          "    window = 'next_planned' if payload.get('severity') == 'low' else 'within_14_days'\n" +
          "    return {'signal': '::SCRIPT.NEXT', 'window': window}\n",
      },
    }),
    node("wi_workorder", "HTTP", "Raise urgent work order", 1960, 120, {
      description: "Create the job in the CMMS with asset, defect codes and photos.",
      http: {
        method: "POST",
        urlTemplate: "https://cmms.example-utility.com/api/work-orders",
        headers: { "Content-Type": "application/json" },
        bodyTemplate:
          '{"asset_id":"{{payload.asset_id}}","priority":"urgent","codes":"{{payload.defect_codes}}"}',
        successSignals: ["::HTTP.NEXT"],
      },
    }),
    node("wi_notify", "SCRIPT", "Notify field crew", 2220, 260, {
      description: "Push the job + location to the on-call crew's mobile app.",
      script: {
        toolName: "notify_field_crew",
        language: "python",
        code:
          "def run(args, payload):\n" +
          "    # push notification to on-call crew app\n" +
          "    return {'signal': '::SCRIPT.NEXT', 'notified': True}\n",
      },
    }),
    node("wi_done", "END", "Crew dispatched", 2480, 260),
    node("wi_closed", "END", "Closed: no action", 1960, -120),
    node("wi_hold", "END", "Escalation hold", 1200, 700, {
      description: "Ops desk picks up data, system or approval-timeout failures.",
    }),
  ];

  const edges: TransitionEdge[] = [
    edge("wi_start", "wi_fetch", "::SCRIPT.NEXT"),
    edge("wi_fetch", "wi_validate", "::HTTP.NEXT"),
    edge("wi_fetch", "wi_hold", "::HTTP.ERROR"),
    edge("wi_validate", "wi_spawn", "::VALIDATE.NEXT"),
    edge("wi_validate", "wi_hold", "::VALIDATE.ERROR"),
    edge("wi_spawn", "wi_merge", "::SPAWN.SUBAGENTS"),
    edge("wi_spawn", "wi_hold", "::SCRIPT.ERROR"),
    edge("wi_merge", "wi_checkpoint", "::SCRIPT.NEXT"),
    edge("wi_checkpoint", "wi_triage", "::SYSTEM.HYDRATE"),
    edge("wi_triage", "wi_schedule", "::AI.NEXT"),
    edge("wi_triage", "wi_review", TRIAGE_CRITICAL),
    edge("wi_triage", "wi_triage", "::AI.GENERATE", "self-loop", 2),
    edge("wi_triage", "wi_hold", "::AI.VALIDATION_ERROR"),
    edge("wi_review", "wi_workorder", "::HUMAN.APPROVE"),
    edge("wi_review", "wi_triage", "::HUMAN.EDIT"),
    edge("wi_review", "wi_closed", "::HUMAN.REJECT"),
    edge("wi_review", "wi_hold", "::HUMAN.TIMEOUT"),
    edge("wi_schedule", "wi_notify", "::SCRIPT.NEXT"),
    edge("wi_schedule", "wi_hold", "::SCRIPT.ERROR"),
    edge("wi_workorder", "wi_notify", "::HTTP.NEXT"),
    edge("wi_workorder", "wi_hold", "::HTTP.ERROR"),
    edge("wi_notify", "wi_done", "::SCRIPT.NEXT"),
    edge("wi_notify", "wi_hold", "::SCRIPT.ERROR"),
  ];

  return { nodes, edges };
}

export const waterInspectionTemplate: WorkflowTemplate = {
  id: "water-inspection-triage",
  name: "Water network inspection → crew dispatch",
  summary:
    "Validate inspection records, run specialist AI inspectors in parallel, checkpoint context, triage risk, keep a supervisor in the loop, and dispatch field crews.",
  build,
  registry: {
    signals: [
      {
        signal: TRIAGE_CRITICAL,
        description: "Triage found a critical / public-health risk — needs sign-off",
      },
    ],
    skills: SKILLS,
  },
  scenarios: [
    {
      id: "routine",
      name: "Routine finding",
      description: "Low/medium severity → planned maintenance → crew notified.",
      overrides: {},
      expect: { status: "succeeded", finalStateId: "wi_done" },
    },
    {
      id: "critical-approved",
      name: "Critical defect, supervisor approves",
      description: "Critical finding → supervisor approves → urgent CMMS work order → crew.",
      overrides: { wi_triage: [TRIAGE_CRITICAL], wi_review: ["::HUMAN.APPROVE"] },
      expect: { status: "succeeded", finalStateId: "wi_done" },
    },
    {
      id: "sent-back",
      name: "Supervisor sends back, then approves",
      description: "Supervisor asks for re-triage with notes; second pass approved.",
      overrides: {
        wi_triage: [TRIAGE_CRITICAL, TRIAGE_CRITICAL],
        wi_review: ["::HUMAN.EDIT", "::HUMAN.APPROVE"],
      },
      expect: { status: "succeeded", finalStateId: "wi_done" },
    },
    {
      id: "false-positive",
      name: "False positive rejected",
      description: "Supervisor rejects the AI's critical call — nothing is dispatched.",
      overrides: { wi_triage: [TRIAGE_CRITICAL], wi_review: ["::HUMAN.REJECT"] },
      expect: { status: "succeeded", finalStateId: "wi_closed" },
    },
    {
      id: "self-heal",
      name: "AI output malformed, self-corrects",
      description: "Triage output fails its schema twice, re-prompts (self-loop ≤2), then passes.",
      overrides: { wi_triage: ["::AI.GENERATE", "::AI.GENERATE", "::AI.NEXT"] },
      expect: { status: "succeeded", finalStateId: "wi_done" },
    },
    {
      id: "loop-cap",
      name: "AI keeps failing → guardrail stops it",
      description: "Third malformed output exceeds the self-loop cap; the run halts instead of burning tokens.",
      overrides: { wi_triage: ["::AI.GENERATE", "::AI.GENERATE", "::AI.GENERATE"] },
      expect: { status: "failed", errorIncludes: "maxIterations=2" },
    },
    {
      id: "bad-data",
      name: "Bad inspection data",
      description: "Record missing footage/asset id → validation fails → escalation hold.",
      overrides: { wi_validate: ["::VALIDATE.ERROR"] },
      expect: { status: "succeeded", finalStateId: "wi_hold" },
    },
    {
      id: "cmms-down",
      name: "Work-order system down",
      description: "Approved critical job but the CMMS call fails → escalation hold.",
      overrides: {
        wi_triage: [TRIAGE_CRITICAL],
        wi_review: ["::HUMAN.APPROVE"],
        wi_workorder: ["::HTTP.ERROR"],
      },
      expect: { status: "succeeded", finalStateId: "wi_hold" },
    },
    {
      id: "approval-timeout",
      name: "Nobody signs off in time",
      description: "Supervisor approval times out → escalation hold (no silent dispatch).",
      overrides: { wi_triage: [TRIAGE_CRITICAL], wi_review: ["::HUMAN.TIMEOUT"] },
      expect: { status: "succeeded", finalStateId: "wi_hold" },
    },
  ],
};
