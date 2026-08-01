# test-feature reference

## Model routing

| Stage | Skill | Model |
|-------|-------|-------|
| Detail docs | `detail-feature` | High-end |
| Implement | `ship-feature` | Composer or Grok |
| Test + push | `test-feature` | **Composer or Grok** |

## Expected scripts (`apps/web/package.json`)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Add these when missing; install `vitest`, `@playwright/test`, and related types as devDependencies.

## Vitest layout

```
apps/web/
  vitest.config.ts
  src/lib/canvas-to-dsl.test.ts
  src/**/__tests__/*.test.ts
```

Use the same path aliases as `tsconfig` (`@/`). Prefer happy-dom or node environment for pure tests.

## Playwright layout

```
apps/web/
  playwright.config.ts
  e2e/
    smoke.spec.ts
    <feature>.spec.ts
```

- `baseURL`: local Next dev server (start via `webServer` in Playwright config when practical).
- Keep one happy-path spec per FeatureShipping feature slice.

## Commit message examples

- `test: cover canvasToDsl spawn v2 fields and SPAWN inspector E2E`
- `test: add code symbol search unit tests and memory index smoke E2E`

## Do not commit

- `apps/web/local.db`
- `.env`, `.env.local`
- `.mcp.json`
- Playwright `test-results/` / `playwright-report/` (should be gitignored)
