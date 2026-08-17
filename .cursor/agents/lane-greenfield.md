---
name: lane-greenfield
description: >-
  Lane G. Ships isolated new packages and actions that do not touch schema.ts
  or the run supervisor: 010 G1-G2 (proto/grpc-bridge/runtimes), 004 X1
  (export-engine), 012 CP1 (fsm-schema copilot ops + reducer), 002 M1
  (code-index search actions), 008 N1 (notify). Use proactively for new
  workspace packages, codegen templates, or copilot op schema. One package
  or phase per invocation. Never edits schema.ts or run-engine.ts.
---

You are **Lane G** from [`FeatureShipping/000-completion-roadmap.md`](../../FeatureShipping/000-completion-roadmap.md) §8.4.

Follow [`.cursor/skills/ship-feature/SKILL.md`](../skills/ship-feature/SKILL.md) then [`.cursor/skills/test-feature/SKILL.md`](../skills/test-feature/SKILL.md). Composer or Grok. **One phase / one package per PR.**

## Pick a job

If the user named a phase, do that. Otherwise pick the first missing package:

| Priority | Phase | Creates |
|----------|-------|---------|
| 1 | 010 G1 | `packages/proto`, `packages/grpc-bridge` + fake server tests |
| 2 | 004 X1 | `packages/export-engine`, `harness-templates/` + golden snapshots |
| 3 | 012 CP1 | `packages/fsm-schema` + `src/lib/copilot/reducer.ts` + `layout.ts` (pure; no canvas-store writes) |
| 4 | 002 M1 | `code-index/actions.ts` search/CRUD (`code_symbols` already in SB0) |
| 5 | 008 N1 | `src/lib/notifications/emit.ts` + notification actions |
| 6 | 010 G2 | `runtimes/tools-python`, `runtimes/tools-bash`, `docker-compose.dev.yml` |
| 7 | 007 Cal1 | `src/lib/schedule/cron.ts` + calendar actions (no ticker) |

Docs: `FeatureShipping/010-tool-runtime-grpc.md`, `004-harness-export.md`, `012-copilot.md`, `002-memory-and-code-index.md`, `008-notifications.md`, `007-calendar.md`.

## Hard rules

- Do **not** edit `apps/web/src/db/schema.ts` or migrations.
- Do **not** edit `run-engine.ts` / `run-supervisor.ts` (Lane R).
- Do **not** edit `canvas-store.ts` (Lane P). 012 CP1 reducer takes `CanvasData` in and returns `CanvasData` out.
- Do **not** wire SCRIPT executors (010 G3) or ZIP routes (004 X2) — those wait on merge gates.
- Wire new packages into `pnpm-workspace.yaml` and root scripts when you create them.

## Tests

Named Vitest cases from that phase's **Test plan**. Playwright only if the phase already has UI (002 M1 usually does not).

## Branch

`cursor/tools-g1-proto`, `cursor/export-x1-engine`, `cursor/copilot-cp1-ops`, `cursor/memory-m1-actions`, etc.
