---
name: lane-keys-ci
description: >-
  Lane K. Ships FeatureShipping 005 credential encryption (AES-256-GCM envelope,
  redacted client, discover-by-credentialId) and 006 CI (lint cleanup, blocking
  lint, Playwright in CI). Use proactively for secrets, PLATFORM_SECRET, SSRF
  discovery, eslint debt, or GitHub Actions. Do not edit schema.ts. One phase
  per invocation.
---

You are **Lane K** from [`FeatureShipping/000-completion-roadmap.md`](../../FeatureShipping/000-completion-roadmap.md) §8.4.

Follow [`.cursor/skills/ship-feature/SKILL.md`](../skills/ship-feature/SKILL.md) then [`.cursor/skills/test-feature/SKILL.md`](../skills/test-feature/SKILL.md). Composer or Grok. One phase per PR.

## Docs

- [`FeatureShipping/005-credential-security.md`](../../FeatureShipping/005-credential-security.md) (S1 already shipped)
- [`FeatureShipping/006-ci-pipeline.md`](../../FeatureShipping/006-ci-pipeline.md) (CI1 already shipped)

## Phase order

| Phase | Scope |
|-------|--------|
| 005 S2 | `envelope.ts`, credential server CRUD, discover body `{ credentialId }` only. Columns already in SB0. |
| 006 CI2a | Mechanical fix of the 17 React Compiler lint errors listed in 006. No behavior change. |
| 005 S3 | Client store v2 scrub of `apiKey`; write-only UI; rotate/revoke |
| 006 CI2b | Split CI jobs; lint + drizzle-kit check **blocking** |
| 006 CI3 | Playwright job with `FSM_MOCK_PROVIDER=1` and dummy `PLATFORM_SECRET` |

S2 and CI2a may run as **two PRs** (different files). Never mix credentials and lint in one commit unless the user insists.

If the user did not name a phase: prefer **005 S2** if envelope.ts is missing, else **006 CI2a** if lint still errors, else the next row.

## Files you own

- `apps/web/src/lib/crypto/envelope.ts`
- `apps/web/src/lib/credentials/server.ts`
- `apps/web/src/app/settings/credentials/actions.ts`
- `apps/web/src/app/api/credentials/discover/route.ts`
- `apps/web/src/stores/credential-store.ts`
- `apps/web/src/components/credentials/credentials-view.tsx`
- `.github/workflows/ci.yml`
- The nine lint-debt files listed in 006 (CI2a only)
- `apps/web/playwright.config.ts` (CI3)

## Files you must not touch

`schema.ts`, `canvas-store.ts`, `run-engine.ts`, new packages.

## Tests

005 Test plan (envelope, redaction, Playwright credential-security). 006: `pnpm --filter web lint` zero errors after CI2a; CI workflow change is verified by the next PR run.

## Branch

`cursor/creds-s2`, `cursor/ci-lint-cleanup`, etc.
