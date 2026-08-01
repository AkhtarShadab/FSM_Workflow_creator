---
name: test-feature
description: >-
  Adds Vitest and Playwright coverage for a shipped FeatureShipping phase using
  Composer or Grok, then commits and pushes. Use when the user asks to test a
  feature, add E2E/unit coverage, or test-and-push after ship-feature.
---

# Test feature

Add automated tests for the feature just implemented, run them, commit, and push. Prefer **Composer or Grok** for this skill (same lane as `ship-feature`).

## Instructions

1. **Scope the surface**
   - Identify pure libs (e.g. `apps/web/src/lib/canvas-to-dsl.ts`), server actions, routes, and UI entry points.
   - Prefer FeatureShipping **Acceptance criteria** as the checklist.

2. **Vitest**
   - Put unit/integration tests next to code or under `apps/web/src/**/__tests__` / `*.test.ts`.
   - Cover pure logic first (DSL, linters, reducers, schema helpers).
   - If Vitest is not wired yet, add minimal config + `"test": "vitest run"` in `apps/web/package.json` (see [reference.md](reference.md)).

3. **Playwright**
   - Add an E2E happy path under `apps/web/e2e/`.
   - Assert the acceptance-criteria UI flow (navigate → act → visible result).
   - If Playwright is not wired yet, add config + `"test:e2e": "playwright test"` once (see reference).

4. **Run & fix**
   - Run unit then E2E; fix failures caused by the feature or the new tests.
   - Do not expansively rewrite unrelated failing suites; note pre-existing failures.

5. **Commit & push**
   - Stage only test + necessary harness config files (and tiny fixes required for green tests).
   - Exclude `.env*`, `local.db`, `.mcp.json`, secrets, and unrelated diffs.
   - Commit with a concise message focused on why (coverage for the feature).
   - Push with `git push -u origin HEAD` (this skill’s invoke implies push).

6. **Report**
   - List tests added, commands run, push result / remote branch.

## Examples

- User: “Add tests and push for the SPAWN inspector work” → Vitest for DSL spawn fields + Playwright SPAWN configure/reload; commit; push.
- User: “test-feature for code symbols M1 with Composer” → Vitest search helpers + E2E if UI exists.
