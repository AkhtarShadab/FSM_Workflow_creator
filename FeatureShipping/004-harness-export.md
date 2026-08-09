# 004 — Harness Export

> Status: **Design**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §11  
> Code today: DSL export helpers in `apps/web`; no `packages/export-engine` yet  
> Expand with: **detail-feature** (high-end) · Implement with: **ship-feature** (Composer/Grok)

---

## What

An export wizard that turns a saved FSM DSL into a **runnable harness** — Docker Compose bundle and/or git push of a generated project.

## How

- New `packages/export-engine`: DSL → template files (controller, compose, env stubs, README)
- UI wizard: choose ZIP download vs git remote; pin version/content hash
- Smoke path: generated harness boots with mock LLM/tools in CI later

## Why

Exportable harnesses are the stated end goal of the product. Authoring without a deployable artifact leaves the loop incomplete.

---

## Goals & non-goals

### Goals

- ZIP export of a standalone compose bundle
- Optional git push (auth model TBD — see design-plan Q24)
- Deterministic codegen from DSL

### Non-goals

- K8s/Helm manifests (v2)
- Live multiplayer export coordination

---

## Open questions

1. Default harness store: local ZIP only vs platform-hosted git?
2. Are memory snapshots included in the bundle (`memory.json`) or omitted?

---

## Suggested implementation phases

| Phase | Scope |
|-------|--------|
| X1 | Template package + ZIP download from DSL |
| X2 | Wizard UI + version metadata |
| X3 | Git push path + CI smoke of generated compose |
