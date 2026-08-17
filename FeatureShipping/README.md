# FeatureShipping

Per-feature design docs that capture **deltas** against [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md).
These are the source of truth for what to implement next — not a rewrite of the full platform plan.

## Model routing (required)

| Stage | Who | Skill | Model preference |
|-------|-----|-------|------------------|
| 1. Plan / discuss | User + any model | — | Plan mode OK |
| 2. **Detailed feature doc** | Agent expands `FeatureShipping/NNN-*.md` | **detail-feature** | **High-end** (Claude Opus / GPT-5.x / strongest available) |
| 3. **Implement phase** | Agent codes on `cursor/…` branch | **ship-feature** | **Composer or Grok** |
| 4. **Test + push** | Agent adds Vitest/Playwright | **test-feature** | **Composer or Grok** |

Do not implement from a thin sketch. Status on the doc must be at least **Detailed** (via `detail-feature`) before `ship-feature` runs.

## How to use

1. Discuss / approve a feature (plan mode or chat).
2. Capture or create a numbered stub under this folder.
3. Run **detail-feature** (high-end model) to produce the full design (APIs, file map, edge cases, phases).
4. Run **ship-feature** (Composer/Grok) for one implementation phase.
5. Run **test-feature** (Composer/Grok) for Vitest + Playwright, commit, and push.

## Doc template

Every feature doc should include:

1. **Problem** — why the current product/docs are insufficient
2. **Goals & non-goals**
3. **Proposed model** — DSL / schema / runtime behavior
4. **UI implications** — reference existing files; design-only until shipped
5. **File / API change map** — concrete paths the implementer will touch (required for Detailed status)
6. **Edge cases & failure modes**
7. **Open questions**
8. **Suggested implementation phases** — for `ship-feature`
9. **Test plan** — named Vitest and Playwright cases, for `test-feature`
10. **Acceptance criteria**

Every doc opens with concise **What / How / Why**. Design-status stubs may stop there
plus goals and open questions, then expand to Detailed via **detail-feature**.

## Index

Sequencing lives in [000-completion-roadmap.md](000-completion-roadmap.md):
**§3 waves are merge-gates**; **§8 is the parallel ship plan** (schema bootstrap, four lanes, file ownership, first four `ship-feature` prompts).

| Doc | Feature | Wave | Status |
|-----|---------|------|--------|
| [000-completion-roadmap.md](000-completion-roadmap.md) | Ordered plan to v1: waves, dependency graph, locked decisions | — | **Living** |
| [001-workflow-canvas.md](001-workflow-canvas.md) | Workflow canvas: states, tool chaining, SYS_FUNC maps, multi-BYOK, subagents, engine, registry | — | **Complete** (C1–C7) |
| [002-memory-and-code-index.md](002-memory-and-code-index.md) | Graph memory + code-index memory + Memory studio UI | parallel | **Detailed** |
| [003-live-executors.md](003-live-executors.md) | Real AI / HTTP / VALIDATE / HUMAN executors, SSE run streaming | 1 | **Detailed** |
| [004-harness-export.md](004-harness-export.md) | Deterministic codegen → ZIP / git runnable harness | 3 | **Detailed** |
| [005-credential-security.md](005-credential-security.md) | AES-256-GCM credential storage; SSRF-safe discovery | 0 | **Detailed** (S1 shipped) |
| [006-ci-pipeline.md](006-ci-pipeline.md) | Blocking lint, Playwright in CI, migration drift check | 0 | **Detailed** (CI1 shipped) |
| [007-calendar.md](007-calendar.md) | Cron / one-shot scheduled runs + calendar UI | 4 | **Detailed** |
| [008-notifications.md](008-notifications.md) | In-app notifications for runs / schedules / budgets | 1 | **Detailed** |
| [009-canvas-persistence.md](009-canvas-persistence.md) | Server-side drafts, published versions, real run history | 0 | **Detailed** |
| [010-tool-runtime-grpc.md](010-tool-runtime-grpc.md) | Python / Bash tools over gRPC, sandboxed | 2 | **Detailed** |
| [011-token-and-observability.md](011-token-and-observability.md) | State 0 hydration, SYS_FUNC checkpoints, token ledger, budgets | 1 | **Detailed** |
| [012-copilot.md](012-copilot.md) | Zod-validated tool-calling copilot replacing stub mode | 4 | **Detailed** |

## Naming

- Files: `NNN-short-kebab-slug.md` (monotonic `NNN`)
- Branches (via ship-feature): `cursor/<short-feature-slug>`

## Skills

| Skill / agent | Path |
|---------------|------|
| detail-feature | [`.cursor/skills/detail-feature/`](../.cursor/skills/detail-feature/) |
| ship-feature | [`.cursor/skills/ship-feature/`](../.cursor/skills/ship-feature/) |
| test-feature | [`.cursor/skills/test-feature/`](../.cursor/skills/test-feature/) |
| Parallel lanes | [`.cursor/agents/`](../.cursor/agents/README.md) — `ship-dispatcher`, then `schema-bootstrap` / `lane-persistence` / `lane-keys-ci` / `lane-greenfield` / `lane-runtime` |
