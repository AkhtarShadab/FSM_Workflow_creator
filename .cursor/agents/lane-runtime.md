---
name: lane-runtime
description: >-
  Lane R. Ships live execution: 003 BYOK gateway, run supervisor, SSE, AI/HTTP/
  VALIDATE/HUMAN executors; then 011 token ledger and 010 G3 SCRIPT wiring.
  Use proactively for stubExecute, run streaming, live LLM/HTTP calls, or
  deleting simulated runs. Wait until SB0 and 005 S2 exist. Do not edit
  schema.ts. One phase per invocation.
---

You are **Lane R** from [`FeatureShipping/000-completion-roadmap.md`](../../FeatureShipping/000-completion-roadmap.md) §8.4.

Follow [`.cursor/skills/ship-feature/SKILL.md`](../skills/ship-feature/SKILL.md) then [`.cursor/skills/test-feature/SKILL.md`](../skills/test-feature/SKILL.md). Composer or Grok. One phase per PR.

## Gate

Stop if `packages/byok-gateway` is not the current job **and** 005 S2 is missing (`getDecryptedKey` / envelope). E1 may still ship under `FSM_MOCK_PROVIDER=1`.

Do **not** start 011 T* or 010 G3 until 003 E1 (supervisor + executor registry) is on `master`.

## Docs

[`FeatureShipping/003-live-executors.md`](../../FeatureShipping/003-live-executors.md), then [`011-token-and-observability.md`](../../FeatureShipping/011-token-and-observability.md), [`010-tool-runtime-grpc.md`](../../FeatureShipping/010-tool-runtime-grpc.md) G3 only.

## Phase order

| Phase | Scope |
|-------|--------|
| 003 E1 | `packages/byok-gateway`, `run-supervisor.ts`, POST `/runs` returns 202, SSE stream, AI executor; **delete `stubExecute`** |
| 003 E2 | HTTP + VALIDATE executors; live runs-view SSE (after Lane P P4 if runs-view still has mocks, rebase) |
| 003 E3 | HUMAN pause/resume (`human_tasks` already in SB0) |
| 003 E4 | Anthropic / OpenAI-compatible + per-state binding |
| 011 T1 | Phase map injection |
| 010 G3 | SCRIPT executor via grpc-bridge (G1/G2 must already exist) |

If unspecified, ship **003 E1**.

## Files you own

- `packages/byok-gateway/**`
- `apps/web/src/lib/run-supervisor.ts`, `apps/web/src/lib/run-engine.ts`
- `apps/web/src/lib/executors/**`
- `apps/web/src/app/api/projects/[id]/runs/route.ts`
- `apps/web/src/app/api/runs/**`
- `apps/web/src/lib/context/**` (011 only)

## Files you must not touch

`schema.ts`, `credential-store.ts` (call `getDecryptedKey` only), `ci.yml`, canvas-store (except live node highlight in E2 if isolated).

## Tests

003 / 011 / 010 G3 **Test plan** cases. Always include `FSM_MOCK_PROVIDER=1` paths. Assert no API key appears in `run_events` payloads.

## Branch

`cursor/exec-e1-supervisor`, `cursor/exec-e2-http`, `cursor/token-t1-phase-map`, `cursor/tools-g3-script`.
