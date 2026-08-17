# 004 — Harness Export

> Status: **Detailed**
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §11 · Roadmap Wave 3
> Code today: [`export-wizard.tsx`](../apps/web/src/components/export/export-wizard.tsx) — selectors are UI-only, the compose panel is a static string, only `fsm.json` downloads; `export_jobs` is never written
> **Parallel:** X1 starts immediately. X2 waits for [009](009-canvas-persistence.md) P3. X4 waits for [010](010-tool-runtime-grpc.md) G2.

---

## What

Turn a published FSM version into a standalone, runnable harness: a deterministic file tree delivered as a ZIP download or pushed to a git remote, that boots with `docker compose up` and executes the workflow outside the platform.

## Why

"Exportable harnesses" is the product's stated end goal — the reason to author on this canvas rather than in a notebook. Today the wizard's own footer admits it: "full ZIP/git export lands in Phase 5". Users can download the DSL, but there is no controller, no compose file, no tool packaging, and nothing to run. Until an exported bundle actually boots, the platform is a diagram editor.

## How

### Generator

`packages/export-engine` is a pure function — no filesystem, no network — so it is trivially snapshot-testable and reusable by CI:

```ts
export interface ExportOptions {
  name: string; version: string;            // semver for the artifact
  contentHash: string;                      // from the published version (009)
  toolLanguage: "python" | "bash";
  includeMemory: boolean;                   // Q29 → default false
  targets: ("compose" | "git")[];
}
export interface GeneratedFile { path: string; contents: string; mode?: number }
export function generateHarness(dsl: FsmDsl, opts: ExportOptions): GeneratedFile[];
```

### Bundle layout (design plan §11.1)

```
harness-<name>-v<semver>/
├── manifest.json           # name, semver, contentHash, generatorVersion, createdAt
├── fsm.json                # canonical DSL (sorted keys)
├── docker-compose.yml      # controller + tools + optional store
├── Dockerfile.controller
├── Dockerfile.tools-<lang>
├── controller/             # Node runner importing @fsm/engine + executors
├── proto/                  # copied from packages/proto (010)
├── tools/                  # user tool sources, one file per SCRIPT state
├── memory.json             # only when includeMemory
├── .env.example            # BYOK base URL/key placeholders — never real secrets
└── README.md               # run instructions
```

The controller reuses `@fsm/engine` plus the [003](003-live-executors.md) executors, so exported runs and platform runs share one implementation. Tool containers come from [010](010-tool-runtime-grpc.md), which is why export sits downstream of it.

### Determinism

Same published version → byte-identical tree. `fsm.json` uses the canonical serializer from [009](009-canvas-persistence.md); templates carry no timestamps or random ids; `manifest.json` records `contentHash` and `generatorVersion` so a regenerated bundle is diffable. A golden-snapshot test enforces this.

### Delivery

**ZIP** streams straight from the route handler (`Content-Disposition: attachment`) built in memory with `jszip`. Nothing is written to local disk — the platform's filesystem is ephemeral, so a persisted artifact path would break on the next deploy. `export_jobs` records metadata only (`target`, `status`, `contentHash`, `sizeBytes`), and `artifact_url` stays null unless object storage is configured later.

**Git** (Q24 → **user PAT**) uses `isomorphic-git` to init, commit the tree, and push to a user-supplied remote. The PAT is stored through the [005](005-credential-security.md) envelope, never echoed back, and scrubbed from error messages.

### Secrets

Generated bundles contain **no credentials, ciphertext, or key material** — only `.env.example` placeholders with the variable names the controller expects. A generator unit test asserts this by scanning every emitted file.

## UI implications

Rework [`export-wizard.tsx`](../apps/web/src/components/export/export-wizard.tsx) into four steps: **Version** (pick a published version, show its hash) → **Options** (tool language, include memory, semver) → **Target** (ZIP or git remote) → **Result** (download link or commit URL, plus an export history table from `export_jobs`). The current static compose panel is replaced by a real preview rendered from `generateHarness` output.

## File / API change map

| Phase | Touch | Change |
|-------|-------|--------|
| X1 | `packages/export-engine/` (new) | `generateHarness`, template set, `manifest.json`, determinism helpers |
| X1 | `harness-templates/` (new) | Controller, compose, Dockerfiles, README templates |
| X2 | `apps/web/src/app/api/projects/[id]/export/route.ts` (new) | Streaming ZIP; writes an `export_jobs` row |
| X2 | `src/components/export/export-wizard.tsx` | Four-step wizard on real data; export history (`export_jobs` columns already in SB0) |
| X3 | `src/lib/export/git-push.ts` (new) | `isomorphic-git` push with a PAT from the 005 envelope |
| X4 | `.github/workflows/ci.yml` | Smoke job: generate from a fixture → `docker compose up` → assert the run completes |

## Edge cases & failure modes

| Case | Expected behavior |
|------|-------------------|
| Export before any publish | Wizard blocks with "Publish a version first" and links to the canvas |
| DSL fails validation | Export refuses; lint errors are listed inline |
| SCRIPT states but no tool language chosen | Blocked with a clear prompt; mixed languages are rejected in v1 (Q17) |
| Tool source missing for a SCRIPT state | Emit a placeholder file **and** fail the export with `TOOL_SOURCE_MISSING` |
| Bundle over 50 MB | Warn and continue; log the size to `export_jobs` |
| Git push rejected (auth/protected branch) | `export_jobs.status = failed` with a sanitized message; the PAT never appears in it |
| Git remote unreachable | Timeout at 60 s, retry once, then fail |
| `includeMemory` with a large graph | Cap at the most recent N nodes; note the truncation in `manifest.json` |
| Deploy during export | ZIP streaming is request-scoped; a dropped request just needs a retry — nothing half-written persists |
| Regenerating the same version | Byte-identical output; `export_jobs` shows a repeat with the same hash |

## Open questions

1. Object storage for artifact retention (S3/R2), or download-only forever?
2. Should the controller image be published to a registry, or always built locally from the bundle?

## Implementation phases

| Phase | Scope | Size |
|-------|-------|------|
| X1 | Export engine package + templates + golden snapshots | 1 PR |
| X2 | ZIP route + `export_jobs` + rebuilt wizard | 1 PR |
| X3 | Git push target with PAT auth | 1 PR |
| X4 | CI compose smoke of a generated bundle | 1 PR |

## Test plan

**Vitest** — `packages/export-engine/src/*.test.ts`

- Golden snapshot of the full file tree for three fixtures: linear, SYS_FUNC-clustered, SPAWN fan-out.
- Determinism: two `generateHarness` calls on the same DSL produce byte-identical output.
- `fsm.json` is canonical — key order is stable regardless of input ordering.
- `manifest.json` carries the source `contentHash` and the generator version.
- Every SCRIPT state produces a `tools/<name>.<ext>` file with the authored source.
- A SCRIPT state with empty source raises `TOOL_SOURCE_MISSING`.
- No emitted file contains a key-shaped secret or ciphertext (scan all files; property-based over seeded credentials).
- `.env.example` lists exactly the variables the generated controller reads.
- `includeMemory: false` (default) omits `memory.json`; `true` includes it and records truncation.
- `docker-compose.yml` references only services the bundle defines, and the tool service matches `toolLanguage`.

**Integration** — `packages/export-engine/src/smoke.test.ts` (CI job X4)

- Generate from the linear fixture, `docker compose up -d`, run the controller against `FSM_MOCK_PROVIDER=1`, assert exit code 0 and a completed trace; tear down.

**Playwright** — `e2e/export.spec.ts`

- Export before publishing → blocked with the publish prompt.
- Publish, then export as ZIP → download event fires and the archive contains `manifest.json`, `fsm.json`, and `docker-compose.yml`.
- Export history lists the job with its status and content hash.
- Re-export the same version → the history shows a second row with an identical hash.
- Git target with a bad remote → a sanitized failure message that contains no token.

## Acceptance criteria

- [ ] A published version exports to a ZIP containing the full bundle layout.
- [ ] Regenerating the same version is byte-identical.
- [ ] The generated bundle boots via `docker compose up` and completes a fixture run in CI.
- [ ] No secret material appears in any generated file.
- [ ] `export_jobs` records every attempt with status, hash, and size.
- [ ] Git push works with a PAT and fails safely without leaking it.
- [ ] Vitest, smoke, and Playwright suites above pass in CI.
