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
9. **Acceptance criteria** — for `test-feature`

## Index

| Doc | Feature | Status |
|-----|---------|--------|
| [001-workflow-canvas.md](001-workflow-canvas.md) | Workflow canvas: states, tool chaining, SYS_FUNC maps, multi-BYOK, subagents, engine, registry | **Complete** (C1–C7) — Round 2: SYS_FUNC router heads, SPAWN/AGGREGATE cardinality, HUMAN + self-loops, richer connection kinds |
| [002-memory-and-code-index.md](002-memory-and-code-index.md) | Graph memory + code-index memory + Memory studio UI | Detailed |

Calendar and Notifications are deferred to later FeatureShipping docs.

## Naming

- Files: `NNN-short-kebab-slug.md` (monotonic `NNN`)
- Branches (via ship-feature): `cursor/<short-feature-slug>`

## Skills

| Skill | Path |
|-------|------|
| detail-feature | [`.cursor/skills/detail-feature/`](../.cursor/skills/detail-feature/) |
| ship-feature | [`.cursor/skills/ship-feature/`](../.cursor/skills/ship-feature/) |
| test-feature | [`.cursor/skills/test-feature/`](../.cursor/skills/test-feature/) |
