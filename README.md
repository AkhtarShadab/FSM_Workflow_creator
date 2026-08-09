# FSM Workflow Creator (AI Harness Creator)

A meta-framework and visual authoring platform for building, optimizing, compiling, and
deploying **self-updating, language-agnostic automation harnesses** modeled as
**Finite State Machines (FSMs)** — with strict separation between deterministic code
execution (C++ / Python / Bash tools over gRPC) and generative AI reasoning (BYOK LLM
gateway), engineered for minimal token consumption.

## Status

**Shipped scaffold + canvas authoring.** Monorepo with `apps/web` (Next.js creator UI)
and `packages/fsm-engine` (signal parser / run loop — on Feature 001 branches/PRs).
Feature **001 Workflow Canvas** is **Complete** (phases C1–C7) on branches/PRs — C1
merged to `master`; C2–C7 in open PRs. Feature **002 Memory & Code Index** is
**Detailed** (not shipped). See [FeatureShipping/](FeatureShipping/) for the
detail → ship → test workflow.

## Documentation

| Doc | Contents |
|-----|----------|
| [InitialDraftPlan.md](InitialDraftPlan.md) | Original concept: FSM engine, signal transitions, token optimization, Magic UI canvas, roadmap |
| [DETAILED_DESIGN_PLAN.md](DETAILED_DESIGN_PLAN.md) | Implementation-grade design: architecture decisions, monorepo layout, FSM DSL, signal grammar, gRPC/proto contracts, BYOK gateway, **testing strategy (Vitest + Playwright)**, **CI pipeline**, open questions, and de-risking next steps |
| [FeatureShipping/](FeatureShipping/) | Per-feature design deltas (canvas, memory/code index, live executors, export, …). Workflow: **detail-feature** (high-end) → **ship-feature** (Composer/Grok) → **test-feature** (Composer/Grok) |

## Highlights

- **FSM-native workflows** — explicit signal-driven transitions (`::SCRIPT.NEXT`, `::SPAWN.SUBAGENTS`, `::SYSTEM.DEHYDRATE`), not brittle linear chains
- **Deterministic ≠ generative** — heavy work runs in native tools via gRPC; the LLM only reasons
- **Flat token cost at any FSM depth** — State 0 lazy hydration + System Function context checkpointing
- **Visual authoring** — Next.js + React Flow + Magic UI canvas, bento-grid inspector, AI copilot mode
- **Exportable harnesses** — compile to a standalone Docker bundle or push directly to Git

## Next up

- Land open canvas PRs, then ship Feature 002 (M1+)
- Detail next FeatureShipping stubs (live executors, credential security, harness export)
- Remaining design-plan packages (`byok-gateway`, `export-engine`, gRPC shims) still future work — see [DETAILED_DESIGN_PLAN.md §16](DETAILED_DESIGN_PLAN.md)
