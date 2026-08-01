---
name: ship-feature
description: >-
  Implements one phase of a Detailed FeatureShipping doc on a new cursor/
  branch using Composer or Grok. Use when the user asks to ship, implement, or
  build a feature after detail-feature; refuse to invent design if the doc is
  still only a Design stub.
---

# Ship feature

Implement **one** phase of a FeatureShipping design doc. Prefer **Composer or Grok** for this skill. Do not invent product design — if the doc is not **Detailed**, stop and tell the user to run `detail-feature` with a high-end model first.

## Instructions

1. **Gate on Detailed docs**
   - Confirm target `FeatureShipping/NNN-*.md`.
   - Status must be **Detailed** (or In progress) and include a file/API change map + phases.
   - If status is only Design / missing file map → do not code; invoke hand-off to `detail-feature`.

2. **Pick phase**
   - Read **Suggested implementation phases**; implement only the phase the user named (ask if unclear).
   - Stay inside that phase’s file map.

3. **Branch**
   - Create and check out `cursor/<short-feature-slug>` from `master` (or user-named base).
   - Call `SetActiveBranch` with the new branch and absolute repo path.

4. **Implement (Composer / Grok)**
   - Follow patterns in `apps/web` (and `packages/*` when present).
   - Prefer extending existing types (`fsm-types.ts`, Drizzle schema, stores) over parallel systems.
   - Match TypeScript/JSON shapes from the FeatureShipping doc exactly unless a blocker forces a small documented deviation (note it in the summary).
   - Do not edit Cursor plan files under `.cursor/plans/` unless asked.

5. **Git hygiene**
   - Do **not** commit or push unless the user explicitly asks.
   - Never stage `.env*`, `local.db`, `.mcp.json`, or secrets.

6. **Wrap up**
   - Summarize landed vs deferred.
   - Next step: run `test-feature` (Composer/Grok) for Vitest + Playwright + push.

## Examples

- User: “Implement phase C1 with Composer” → verify `001` is Detailed → branch `cursor/canvas-dsl-spawn-v2` → types + `canvasToDsl` only.
- User: “Ship memory M1 on Grok” → verify `002` is Detailed → branch `cursor/code-symbols-schema` → Drizzle + actions only.
