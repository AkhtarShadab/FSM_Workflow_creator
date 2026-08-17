# FSM Workflow Creator (AI Harness Creator)

A meta-framework and visual authoring platform for building, optimizing, compiling, and
deploying **self-updating, language-agnostic automation harnesses** modeled as
**Finite State Machines (FSMs)** — with strict separation between deterministic code
execution (C++ / Python / Bash tools over gRPC) and generative AI reasoning (BYOK LLM
gateway), engineered for minimal token consumption.

## Status

**Authoring works end to end; the runtime does not yet.** Monorepo with `apps/web`
(Next.js creator UI) and `packages/fsm-engine` (signal parser, resolver, mask, spawn
pool). Feature **001 Workflow Canvas** is **Complete** (C1–C7, merged to `master`)
with Vitest + Playwright coverage.

What is still simulated: state executors return fixed signals instead of calling
models or tools, the canvas is persisted only in `localStorage`, BYOK keys are not
encrypted at rest, and export produces a JSON file rather than a runnable harness.

[FeatureShipping/000-completion-roadmap.md](FeatureShipping/000-completion-roadmap.md)
is the ordered plan to v1 — five waves, eleven feature docs, all **Detailed** and
ready for `ship-feature`.

## Documentation

| Doc | Contents |
|-----|----------|
| [InitialDraftPlan.md](InitialDraftPlan.md) | Original concept: FSM engine, signal transitions, token optimization, Magic UI canvas, roadmap |
| [DETAILED_DESIGN_PLAN.md](DETAILED_DESIGN_PLAN.md) | Implementation-grade design: architecture decisions, monorepo layout, FSM DSL, signal grammar, gRPC/proto contracts, BYOK gateway, **testing strategy (Vitest + Playwright)**, **CI pipeline**, open questions, and de-risking next steps |
| [FeatureShipping/](FeatureShipping/) | Per-feature design deltas, each with a file/API change map, phases, and named test cases. Start at [000-completion-roadmap.md](FeatureShipping/000-completion-roadmap.md). Workflow: **detail-feature** (high-end) → **ship-feature** (Composer/Grok) → **test-feature** (Composer/Grok) |

## Highlights

- **FSM-native workflows** — explicit signal-driven transitions (`::SCRIPT.NEXT`, `::SPAWN.SUBAGENTS`, `::SYSTEM.DEHYDRATE`), not brittle linear chains
- **Deterministic ≠ generative** — heavy work runs in native tools via gRPC; the LLM only reasons
- **Flat token cost at any FSM depth** — State 0 lazy hydration + System Function context checkpointing
- **Visual authoring** — Next.js + React Flow + Magic UI canvas, bento-grid inspector, AI copilot mode
- **Exportable harnesses** — compile to a standalone Docker bundle or push directly to Git

## Next up

**Wave 0 — foundation** (nothing downstream can land first):

1. [009 Canvas persistence](FeatureShipping/009-canvas-persistence.md) — server-side drafts, published versions, real run history
2. [005 Credential security](FeatureShipping/005-credential-security.md) — AES-256-GCM keys, no plaintext in the browser
3. [006 CI pipeline](FeatureShipping/006-ci-pipeline.md) — blocking lint, Playwright in CI

Then Wave 1 makes runs real ([003](FeatureShipping/003-live-executors.md),
[011](FeatureShipping/011-token-and-observability.md),
[008](FeatureShipping/008-notifications.md)), Wave 2 adds the gRPC tool runtime
([010](FeatureShipping/010-tool-runtime-grpc.md)), Wave 3 ships exportable harnesses
([004](FeatureShipping/004-harness-export.md)), and Wave 4 finishes the shell
([007](FeatureShipping/007-calendar.md), [012](FeatureShipping/012-copilot.md)).
[002 Memory & code index](FeatureShipping/002-memory-and-code-index.md) runs in
parallel at any time.
