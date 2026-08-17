# 013 — State Catalog Segregation & Signal Registry

> Status: **Detailed**
> Relates to: [001](001-workflow-canvas.md) §3.1 / §3.6, [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §§5–6, Q5
> Code today: [`fsm-types.ts`](../apps/web/src/lib/fsm-types.ts) `PALETTE_GROUPS` / `SIGNAL_PRESETS` / `STATE_CATALOG`; [`registry.ts`](../apps/web/src/lib/registry.ts); [`registry-view.tsx`](../apps/web/src/components/registry/registry-view.tsx)
> Depends on: 001 Complete · Implement with: **ship-feature** then **test-feature** (Composer/Grok)
> Pairs with: [014](014-run-contract.md) (retry, verify, resume, tool grants, per-state memory)

---

## What

Make the canvas a real FSM catalog: states grouped by role, every built-in type carrying its own success/error signals, and a documented procedure to register **new states** and **new signals** (including engine-owned `::STATE.*` and `::TRANSITION.*`) without colliding with reserved namespaces.

## Why

Today the palette is three buckets (Flow / Work / Control) with eleven hard-coded types. Work mixes deterministic tools, generative models, and human gates. Edges default to `::SCRIPT.NEXT` even from START. The registry can add `::MYAPP.*` strings, but it cannot add a state type to the palette, cannot register STATE/TRANSITION lifecycle signals, and does not reserve built-in namespaces. Authors cannot express “this state succeeded” independently of “the SCRIPT tool exited 0”, so success conditions for transitions (014) have nothing to attach to.

## How

### 1. Palette segregation (built-in)

Replace `PALETTE_GROUPS` with five groups. Built-in types stay closed; only **Custom** grows at runtime.

| Group | Types | Role |
|-------|-------|------|
| **Flow** | `START`, `END` | Enter / terminal success. `ERR` is **not** a new type — it is an `END` node with `terminal: "error"` (inspector toggle). |
| **Work** | `SCRIPT`, `HTTP`, `VALIDATE` | Deterministic, independently verifiable. |
| **Generative** | `AI`, `EXTERNAL_AI`, `HUMAN` | Model or human judgment. |
| **Control** | `SYSTEM_FUNCTION`, `SPAWN`, `AGGREGATE` | Routing, fan-out, merge. |
| **Custom** | `registry.customStates[]` | Project-registered types (see §3). |

Each built-in type declares a **signal kit** (success + failure + optional extras). Kits are the only legal default edges when connecting FROM that type.

```ts
export interface StateSignalKit {
  success: string;   // default outgoing success edge
  failure: string;   // default onError.signal
  extras?: string[]; // optional (AI.GENERATE, HUMAN.EDIT, …)
}

export const STATE_SIGNAL_KITS: Record<FSMStateType, StateSignalKit> = {
  START:            { success: "::STATE.SUCCESS", failure: "::STATE.FAIL" },
  END:              { success: "::STATE.EXIT",    failure: "::STATE.FAIL" },
  SCRIPT:           { success: "::SCRIPT.NEXT",   failure: "::SCRIPT.ERROR" },
  HTTP:             { success: "::HTTP.NEXT",     failure: "::HTTP.ERROR" },
  VALIDATE:         { success: "::VALIDATE.NEXT", failure: "::VALIDATE.ERROR" },
  AI:               { success: "::AI.NEXT",       failure: "::AI.ERROR", extras: ["::AI.GENERATE", "::AI.VALIDATION_ERROR", "::AI.TOOL_DENIED"] },
  EXTERNAL_AI:      { success: "::EXTERNAL_AI.NEXT", failure: "::EXTERNAL_AI.ERROR" },
  HUMAN:            { success: "::HUMAN.APPROVE", failure: "::HUMAN.REJECT", extras: ["::HUMAN.EDIT", "::HUMAN.TIMEOUT"] },
  SPAWN:            { success: "::SPAWN.SUBAGENTS", failure: "::SPAWN.ERROR" },
  AGGREGATE:        { success: "::STATE.SUCCESS", failure: "::STATE.FAIL" },
  SYSTEM_FUNCTION:  { success: "::SYSTEM.HYDRATE", failure: "::SYSTEM.HALT", extras: ["::SYSTEM.DEHYDRATE"] },
};
```

`DEFAULT_SIGNALS` is derived from `STATE_SIGNAL_KITS[type].success`. START no longer emits `::SCRIPT.NEXT`.

### 2. Canonical signal namespaces

Grammar unchanged (`::NAMESPACE.ACTION`). Namespaces split into **reserved** (engine/platform) and **project** (registry).

| Namespace | Owner | When emitted | Drawn as edge by default? |
|-----------|-------|--------------|---------------------------|
| `SCRIPT` `HTTP` `VALIDATE` `AI` `EXTERNAL_AI` `HUMAN` `SPAWN` `SYSTEM` | Platform | Executor / engine | Yes — author wires these |
| **`STATE`** | Engine | Lifecycle of *any* state | No — optional observability edges |
| **`TRANSITION`** | Engine | Resolver / verifier | No — optional; `VERIFY_FAIL` may be wired to ERR |
| `MYAPP` / other | Project registry | Custom executors | Yes, after register |

#### 2.1 `::STATE.*` (new)

| Signal | Meaning |
|--------|---------|
| `::STATE.ENTER` | State entered; payload `{ stateId, attempt }` |
| `::STATE.EXIT` | State left after a taken transition |
| `::STATE.RETRY` | Guardrail retry scheduled; payload `{ attempt, reason }` |
| `::STATE.SUCCESS` | Success condition passed (014 R2); safe to take the success edge |
| `::STATE.FAIL` | Success condition failed or executor error after retries exhausted |

Engine always records these as `run_events`. Authors may wire `::STATE.SUCCESS` / `::STATE.FAIL` as edges (useful for START/AGGREGATE/custom). Wiring `ENTER`/`EXIT`/`RETRY` is allowed but lint-warns (`LIFECYCLE_EDGE`).

#### 2.2 `::TRANSITION.*` (new)

| Signal | Meaning |
|--------|---------|
| `::TRANSITION.TAKEN` | Resolver picked `{ on, to }` |
| `::TRANSITION.BLOCKED` | Emission matched no allowlisted edge |
| `::TRANSITION.VERIFY_FAIL` | 014 LLM/schema verifier rejected the hop |

Default unmatched-signal policy remains halt (`transition_error`). Authors may add an edge `on: "::TRANSITION.VERIFY_FAIL"` to a recovery state; otherwise 014 routes to `onError`.

#### 2.3 Add `::AI.ERROR` and `::SPAWN.ERROR`

`BUILTIN_SIGNALS` today has `::AI.VALIDATION_ERROR` but not `::AI.ERROR`. Add both plus `::SPAWN.ERROR` and the STATE/TRANSITION set. `::AI.TOOL_DENIED` is owned by [014](014-run-contract.md) R4 but is reserved here so 013 lint accepts it.

### 3. Procedure: adding a signal

This is the product contract (UI copy on `/settings/registry` + lint).

1. **Name** `::NAMESPACE.ACTION` matching `/^::[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/`.
2. **Namespace check**
   - If `NAMESPACE` ∈ `RESERVED_NAMESPACES` → reject (`SIGNAL_RESERVED`). You cannot register `::STATE.FOO` or `::AI.MYTHING`.
   - If the exact string is already in `BUILTIN_SIGNALS` → reject (`SIGNAL_BUILTIN`).
3. **Register** via Registry UI or `registerSignal()`. Description is required (min 8 chars) so the edge inspector can show a hint.
4. **Use** on an edge / `successSignals` / `onError`. Lint `UNKNOWN_SIGNAL` if the string is neither builtin nor registered.
5. **Publish** — registry JSON is stored on the FSM draft (`extensions.registry`) and frozen into the published version (009). Export (004) copies it into `registry.json`.
6. **Delete** — blocked while any canvas edge or HTTP `successSignals` still references it (`SIGNAL_IN_USE`).

```ts
export const RESERVED_NAMESPACES = new Set([
  "SCRIPT", "HTTP", "VALIDATE", "AI", "EXTERNAL_AI",
  "HUMAN", "SPAWN", "SYSTEM", "STATE", "TRANSITION",
]);
```

Q5 **locked**: custom `::MYAPP.*` (and any non-reserved namespace) is allowed. Collision rule = exact-string uniqueness across builtin + registry. No prefix hijacking of reserved namespaces.

### 4. Procedure: adding a state type

Custom states are **palette entries**, not forks of `FSMStateType`. Built-in union stays closed for TypeScript exhaustiveness.

```ts
export type PaletteGroupId = "flow" | "work" | "generative" | "control" | "custom";

export interface CustomStateType {
  id: string;                    // slug, unique, not a builtin type name
  label: string;
  group: PaletteGroupId;         // default "custom"; may appear under Work if author chooses
  executorKind: "script" | "http" | "ai" | "none";
  defaultSignals: string[];      // must be known (builtin or registered)
  successCondition?: SuccessCondition; // 014 shape; default { kind: "signal" }
  inspectorSchema?: string;      // JSON Schema for extra config
  description: string;
}
```

Procedure:

1. Open Registry → **States** → New.
2. Pick `executorKind` (maps to an existing executor; `none` is VALIDATE-like).
3. Declare `defaultSignals` (at least one success + one failure). Register any custom signals first (§3).
4. Optional `successCondition` (schema / predicate / llm_verify) — stored on the type as the default for new nodes.
5. Save. Palette **Custom** (or chosen group) shows the type. Dropping it onto the canvas creates a node with `stateType` of the executor kind and `data.customTypeId = id`.
6. Lint `CUSTOM_TYPE_UNKNOWN` if `customTypeId` is set but missing from registry. Lint `CUSTOM_TYPE_SIGNAL_MISMATCH` if the node’s edges use signals outside the type’s kit ∪ registered extras.

Non-goal: a fully user-written executor WASM/plugin. Custom types reuse SCRIPT/HTTP/AI/none executors.

### 5. Success condition (authoring surface)

Every node (builtin + custom) gains `successCondition` on `StateNodeData`. Evaluation is 014; 013 only authors and lints it.

```ts
export type SuccessCondition =
  | { kind: "signal" } // default: executor emission is the success signal
  | { kind: "schema"; schema: string } // Ajv against output payload
  | { kind: "predicate"; expr: string } // JSONLogic over { payload, emission }
  | {
      kind: "llm_verify";
      credentialId: string;
      modelId: string;          // high-end judge, not the worker model
      rubric: string;           // what “done” means
      onFail: "retry" | "error_signal";
    };
```

Inspector: new **Success** card under Guardrails. Lint `VERIFY_MISSING_CREDENTIAL` when `llm_verify` has an empty `credentialId`. Lint `PREDICATE_EMPTY` when kind is predicate and `expr` is blank.

---

## UI implications

| Surface | Change |
|---------|--------|
| [`canvas-toolbar.tsx`](../apps/web/src/components/canvas/canvas-toolbar.tsx) | Five groups; Custom section lists `registry.customStates` |
| [`inspector-cards.tsx`](../apps/web/src/components/inspector/inspector-cards.tsx) | Success card; END `terminal` toggle; signal kit shown read-only with “change via Registry” |
| Edge inspector | Presets grouped by namespace including STATE / TRANSITION; custom signals from registry with descriptions |
| [`registry-view.tsx`](../apps/web/src/components/registry/registry-view.tsx) | Three tabs: Signals, States, Skills. Signal form: name + description + reserved-namespace error. State form: §4 fields. In-use blocking on delete. |
| Palette tooltips | Match `STATE_CATALOG` + kit success/failure |

---

## File / API change map

| Phase | Touch | Change |
|-------|-------|--------|
| F1 | `apps/web/src/lib/fsm-types.ts` | `PALETTE_GROUPS` five buckets; `STATE_SIGNAL_KITS`; `SuccessCondition`; `customTypeId?`; `terminal?` on END; START default `::STATE.SUCCESS`; add builtin signals |
| F1 | `apps/web/src/lib/registry.ts` | `RESERVED_NAMESPACES`; `registerSignal` rejects reserved; `BUILTIN_SIGNALS` union with kits + STATE/TRANSITION; `CustomStateType` gains `group`, `executorKind`, `description` |
| F1 | `apps/web/src/lib/canvas-to-dsl.ts` | Emit `successCondition`, `customTypeId`, `extensions.registry`; lint reserved + unknown |
| F1 | `packages/fsm-schema` (if present) | Share `SignalSchema` + reserved list with copilot ops |
| F2 | `registry-view.tsx`, `registry-store.ts` | States tab; required description; delete-in-use; persist registry onto draft via 009 save path if `saveDraft` exists — else keep zustand persist **and** write `extensions.registry` on publish |
| F2 | `inspector-cards.tsx`, `canvas-toolbar.tsx` | Success card; five-group palette; custom types droppable |
| F2 | `apps/web/src/components/canvas/edge-inspector` (or existing edge popover) | Grouped presets + registry hints |

Do **not** edit `schema.ts` or `run-supervisor.ts` in 013. Runtime evaluation is 014.

---

## Edge cases & failure modes

| Case | Behavior |
|------|----------|
| Register `::AI.FOO` | Reject `SIGNAL_RESERVED` |
| Register `::SCRIPT.NEXT` | Reject `SIGNAL_BUILTIN` |
| Custom signal used on edge then deleted | Delete disabled; `SIGNAL_IN_USE` |
| Custom type id equals `AI` | Reject `CUSTOM_TYPE_COLLIDES_BUILTIN` |
| Draft has `customTypeId` after registry wipe | Lint error; run refuses to start (014) |
| START still has old `::SCRIPT.NEXT` edges | Lint warning `START_LEGACY_SIGNAL`; run still honors the authored edge (no silent rewrite) |
| `llm_verify` authored but 014 not merged | Lint warning `VERIFY_RUNTIME_PENDING`; publish allowed; run treats as `kind: "signal"` until 014 R2 |

---

## Open questions

None — locked in [000](000-completion-roadmap.md) §6 (Q5, Q31–Q34).

---

## Suggested implementation phases

| Phase | Scope | Size |
|-------|-------|------|
| **F1** | Types, kits, reserved namespaces, builtin STATE/TRANSITION signals, DSL emit + lint | 1 PR |
| **F2** | Registry States tab, five-group palette, Success inspector card, grouped edge presets | 1 PR |

Ship F1 first. F2 stacks on F1.

---

## Test plan

### Vitest (F1)

- `STATE_SIGNAL_KITS` covers every `FSMStateType`.
- `registerSignal("::STATE.FOO")` throws `SIGNAL_RESERVED`.
- `registerSignal("::MYAPP.DONE", "ok done")` succeeds; duplicate is idempotent.
- `registerCustomState` with id `AI` throws.
- `lintCanvas` unknown `::FOO.BAR` → `UNKNOWN_SIGNAL`; registered custom is clean.
- `canvasToDsl` includes `successCondition` and `extensions.registry`.
- START default signal is `::STATE.SUCCESS` (not `::SCRIPT.NEXT`).

### Vitest (F2)

- `signalInUse(canvas, "::MYAPP.DONE")` true when an edge uses it.
- Palette groups contain `generative` and `custom`.

### Playwright

- **F1:** canvas toolbar shows Flow / Work / Generative / Control (even if Custom empty).
- **F2:** Registry → add `::MYAPP.DONE` with description → canvas edge picker lists it → delete blocked while edge exists → remove edge → delete succeeds.
- **F2:** Registry → add custom state “Review Gate” (`executorKind: none`) → appears under Custom → drop onto canvas.

---

## Acceptance criteria

- [ ] Palette is five segregated groups; Work no longer contains AI/HUMAN.
- [ ] Every built-in type has a documented success + failure signal kit.
- [ ] `::STATE.*` and `::TRANSITION.*` are reserved, listed in presets, and rejected as custom registrations.
- [ ] Adding a custom signal is a three-field form (name, description, submit) with reserved-namespace errors.
- [ ] Adding a custom state adds a palette item that drops a node with `customTypeId`.
- [ ] Success condition is authorable on every node; evaluation deferred to 014.
- [ ] Named Vitest + Playwright cases above are green.
