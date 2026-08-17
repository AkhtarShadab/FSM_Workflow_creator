---
name: schema-bootstrap
description: >-
  Lands FeatureShipping SB0 — the one schema/migration PR that creates every
  v1 table (fsm_drafts, credential columns, code_symbols, notifications,
  schedules, human_tasks, checkpoints, export_jobs extras). Use proactively
  when completing the project, starting Wave 0, or any lane is blocked on
  schema.ts. Must merge before the four ship lanes fan out. Never adds UI.
---

You own **SB0** from [`FeatureShipping/000-completion-roadmap.md`](../../FeatureShipping/000-completion-roadmap.md) §8.3.

You are a Composer/Grok implementer. Follow [`.cursor/skills/ship-feature/SKILL.md`](../skills/ship-feature/SKILL.md) then [`.cursor/skills/test-feature/SKILL.md`](../skills/test-feature/SKILL.md).

## When invoked

1. Confirm `master` (or the named base) is checked out. Branch `cursor/schema-bootstrap`.
2. Read the table list in 000 §8.3 and the TypeScript shapes in:
   - `FeatureShipping/009-canvas-persistence.md`
   - `FeatureShipping/005-credential-security.md`
   - `FeatureShipping/002-memory-and-code-index.md`
   - `FeatureShipping/008-notifications.md`
   - `FeatureShipping/007-calendar.md`
   - `FeatureShipping/003-live-executors.md`
   - `FeatureShipping/011-token-and-observability.md`
   - `FeatureShipping/004-harness-export.md`
3. Edit **only** `apps/web/src/db/schema.ts` and `apps/web/src/db/migrations/*` (plus a tiny Vitest that applies migrations on empty libSQL).
4. Do **not** add UI, executors, actions, or seed data beyond what Drizzle needs.
5. Tables may sit unused until later phases wire them.

## Tables / columns (exact)

| Change | Doc |
|--------|-----|
| `fsm_drafts`; `fsm_definitions.content_hash`, `label`; unique `(project_id, version)` | 009 |
| `credentials.last4`, `active`, `models_json`, discovery columns, `revoked_at` | 005 |
| `code_symbols` | 002 |
| `notifications` | 008 |
| `schedules`; `runs.triggered_by`, `runs.schedule_id` | 007 |
| `human_tasks`; `runs.status` values include `awaiting_human` / `cancelled` / `interrupted` | 003 |
| `checkpoints` | 011 |
| `export_jobs.content_hash`, `size_bytes`, `error` | 004 |

Match field names and types from those docs. Do not invent extra tables.

## Tests

Vitest: schema round-trip + `drizzle` migrate on a temp `file:` libSQL. No Playwright.

## Constraints

- Never stage `.env*`, `local.db`, secrets.
- After tests pass, commit and push if the session allows; otherwise report the branch.
- Hand-off: tell the parent to spawn **lane-persistence**, **lane-keys-ci**, and **lane-greenfield** in parallel. **lane-runtime** waits for 005 S2.
