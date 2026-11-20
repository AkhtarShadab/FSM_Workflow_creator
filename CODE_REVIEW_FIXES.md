# Code Review Fixes

A full review of `master` at `d2a0d95`, covering `packages/fsm-engine` and `apps/web`, read against the behaviour specified in
[FeatureShipping/001-workflow-canvas.md](FeatureShipping/001-workflow-canvas.md) and
[DETAILED_DESIGN_PLAN.md](DETAILED_DESIGN_PLAN.md).

- **Fixed:** 20 defects, listed below. Each fix has a regression test where one is practical.
- **Not fixed:** a further set of issues and recommendations for the maintainer, listed at the end.

**Verification:**

| Check | Before | After |
|-------|--------|-------|
| Unit tests | 57 | 76 (19 new) |
| `tsc --noEmit` (web) | ✅ | ✅ |
| `tsc --noEmit` (engine) | ❌ | ✅ |
| `next build` | ✅ | ✅ |
| ESLint problems | 18 | 17 (no new ones) |

All 7 new engine tests fail on the old code and pass with the fixes. The edge inspector, tool pack and Runs error display were also checked by hand in the running app.

New test files:
- [`packages/fsm-engine/src/engine.test.ts`](packages/fsm-engine/src/engine.test.ts), `regressions` block
- [`apps/web/src/lib/code-review-fixes.test.ts`](apps/web/src/lib/code-review-fixes.test.ts)

---

## A. Engine (`packages/fsm-engine`)

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| A1 | High | **`guardrails.timeoutMs` was not enforced.** `runState` only aborted the executor's `AbortSignal`. An executor that ignored the signal hung the run forever. | The executor is raced against the abort signal (`raceAbort`), so a timeout always settles. |
| A2 | High | **A parent abort made `runState` throw.** If the run was aborted mid-execute, `runState` retried, then `clock.sleep(…, abortSignal)` rejected outside the `try`. The rejection escaped as an exception instead of returning `reason: "aborted"`. | Aborts are detected after a failure and during backoff. `runState` now always returns `{ ok:false, reason:"aborted" }` and never burns retries. |
| A3 | Medium | **SPAWN envelopes had the wrong status.** When `firstSuccess` or `quorum` was reached, the pool aborted the remaining children, but they were labelled `timeout` instead of `cancelled` (§3.8 envelope contract). | Each child tracks whether *its own* timer fired, and which children the pool cancelled. |
| A4 | Medium | **One hung child hung the whole SPAWN.** A child that ignored its signal never settled, so `runSpawn` never resolved. | Children are raced against their abort signal. |
| A5 | Low | **A parent signal that was already aborted was ignored.** `runSpawn` still scheduled every child. | Returns with every envelope `cancelled` when `cancelOnParentHalt` is set. |
| A6 | Medium | **Router edges could hijack transitions.** A SYS_FUNC router-head wire uses the same signal as the SYS_FUNC's own emission (`::SYSTEM.HYDRATE`). Router wires are structural, not flow (§10.5), but the resolver could pick one and jump to the head's component. | `resolveTransition` and the disabled-state skip prefer non-router edges. Router edges are a fallback only. |
| A7 | Low | **`runFsm` ignored aborts between states.** Execution continued after an abort fired. | Checks the abort signal at every step and returns `error: "Run aborted"`. |
| A8 | Low | **The heterogeneous worker count disagreed with the UI.** The engine used `count` while the canvas chip and lint use `profiles.length` (`spawnWorkerCount`). | Heterogeneous mode runs one child per profile. `count` is clamped to an integer ≥ 0. |
| A9 | Low | **`pnpm --filter @fsm/engine typecheck` always failed.** `tsconfig` declares `types: ["node"]`, but `@types/node` was not a dependency. One test also returned a payload of the wrong type. | Added `@types/node` as a dev dependency and cast the deliberately malformed test payload. CI should also run this step; see follow-up 11. |
| A10 | Low | **The minimal schema check missed basic types.** It didn't handle `integer` or `null`, and it accepted `NaN` as a `number`. | Added the missing cases. |

## B. Web libraries (`apps/web/src/lib`, API routes)

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| B1 | **High (security)** | **SSRF guard bypass.** `new URL("http://[::ffff:127.0.0.1]")` normalises the hostname to `[::ffff:7f00:1]`. `isPrivateAddress` only understood the dotted form, so it called that address public. The same applied to `[::ffff:a9fe:a9fe]` (`169.254.169.254`, cloud metadata), IPv4-compatible `::a.b.c.d`, NAT64 `64:ff9b::/96` and `fe80::/10` beyond `fe80*`. | IPv6 literals are fully expanded and the embedded IPv4 address is re-checked. Unparseable literals fail closed. |
| B2 | **High (security)** | **Redirects bypassed the SSRF guard.** Discovery `fetch` followed redirects, so a public host could 30x the server to an internal address. The guard only checks the initial URL. | Discovery uses `redirect: "manual"`, and a 3xx response is an error. |
| B3 | Medium | **IPv6 hosts could never be discovered.** `dns.lookup` was called with a bracketed hostname, which always returns `ENOTFOUND`. | Added `bareHostname()`. |
| B4 | Medium | **`…/v1` base URLs produced `/v1/v1/models`.** A base URL of `https://api.openai.com/v1` (the usual way it's written, and the EXTERNAL_AI default) led to a 404. | `normalizeBase` strips a trailing `/v1`. |
| B5 | Medium | **`MASK_NO_PATH_TO_END` raised false errors.** Mask reachability stored one target per `(from, signal)`, so a second edge with the same signal overwrote the first. | Keeps every target. A rewire row replaces all targets for its `(from, on)`, matching the engine. |
| B6 | Low | **False `MISSING_ERROR_EDGE` warnings on HUMAN states.** A HUMAN state's error route is `::HUMAN.REJECT` / `::HUMAN.TIMEOUT`, which the generic `.ERROR` regex doesn't match. | An edge on the state's own `onError.signal`, or on HUMAN `onTimeout.signal`, counts as an error route. |
| B7 | Medium | **Runs could stay `running` forever.** If the engine or a DB insert threw, `startProjectRun` never updated the row. | Wrapped in `try`/`catch` so the row is marked `failed`. Events are inserted in one batch, and the engine error is persisted as an `ERROR` event. |
| B8 | Low | **`canvasToEngine` mapping inconsistencies.** It didn't normalise edges, unlike `canvasToDsl` and lint, so legacy self-loops had no kind or cap. Predicate-mode VALIDATE states were gated by the unused `schema` field. SPAWN children ignored the SPAWN guardrail timeout that the DSL emits. | Fixed all three. Moved the mapping into a pure [`canvas-to-engine.ts`](apps/web/src/lib/canvas-to-engine.ts) module so it can be tested without the DB. |
| B9 | Low | **`POST /api/projects/:id/runs` wrote orphan rows for unknown projects.** It accepted any finite number, and SQLite doesn't enforce foreign keys by default. | Requires a positive integer ID and returns 404 for unknown projects. Requires `nodes` and `edges` to be arrays. |

## C. UI (`apps/web/src/components`, stores)

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| C1 | **High (crash)** | **Clicking an edge broke the edge inspector.** `EdgeInspectorPanel` called `useCanvasStore(...updateEdgeData)` *after* `if (!edge) return null`, which violates the Rules of Hooks. Selecting an edge changed the hook count and React threw. | Moved the hook above the early return. |
| C2 | High | **The SPAWN tool pack and skill pack couldn't hold more than one item.** The textarea was controlled by `list.join(", ")` and re-parsed on every keystroke, so a typed comma or space was stripped immediately. | Added a `ListTextarea` that keeps a local draft. |
| C3 | Medium | **Heterogeneous SPAWN lint errors couldn't be fixed.** The inspector only edits `profiles[0]`, so `SPAWN_PROFILE_MISMATCH` could only be cleared by setting `count = 1`. | Added `syncHeterogeneousProfiles`, which keeps one profile per child. Count and quorum `k` are clamped to valid ranges. |
| C4 | Medium | **Export wizard choices were ignored.** The tool language and checkpoint store selections never reached `fsm.json`, which was always `python`/`redis`. | `canvasToDsl` accepts `toolLanguage` and `checkpointStore`. Also moved the wizard's `Section` component out of render; it was remounting every section, including the animations, on each click. |
| C5 | Medium | **The Runs view hid the engine error.** A failed run (no allowlisted edge, self-loop cap, missing START) only showed "failed". | The error is shown as an event. |
| C6 | Low | **Edge ID collisions.** IDs were `e-src-tgt-<ms>`, so two edges added between the same pair in one millisecond collided (Conditions "Add", re-targeting, Copilot). Credential and template IDs had the same problem. | Added a counter or random suffix. |
| C7 | Low | **A stale edge selection survived node deletion.** `removeNode` didn't clear a selected edge that it deleted. | Clears the selection. |
| C8 | Low | **Copilot gaps.** It couldn't add HTTP, VALIDATE, HUMAN or EXTERNAL_AI states, and "connect" read a stale node list from the render closure. | Added the missing types, and "connect" reads live store state. |

---

## Recommended follow-ups (not changed here)

These are design decisions or larger changes that belong to the maintainer.

1. **DNS rebinding, a TOCTOU gap in the SSRF guard.** The discover route resolves DNS, then `fetch` resolves it again. Pin the vetted IP with an undici `Agent` `connect.lookup` hook.
2. **The SSRF guard blocks local LLM proxies.** The default base URL for "OpenAI-compatible proxy" is `http://localhost:4000`, so discovery for it always fails. Consider a dev-only allowlist env var such as `DISCOVERY_ALLOW_PRIVATE=1`.
3. **API keys are stored in plaintext.** They live in `localStorage` (`fsm-credential-store`) and are posted to the server on every discovery. This is known (§14 and FeatureShipping 005), but it is the largest remaining security gap.
4. **The Runs page is partly mock.** "Run history" is hard-coded `MOCK_RUNS`, not the `runs` table. The **Stop** button is always disabled while a run is in flight, so it does nothing.
5. **AGGREGATE re-pairing leaves a stale back-reference.** Picking a SPAWN that was already paired with another AGGREGATE leaves that AGGREGATE's `fromSpawnId` stale. Lint catches it; the inspector could clear it.
6. **Re-targeting a condition drops data.** The Conditions card re-targets with remove + add, which drops `sourceHandle`/`targetHandle` and changes the edge ID.
7. **SYS_FUNC enable map must list END.** With an enable map, END must be listed explicitly or it is treated as disabled (lint `MASK_NO_PATH_TO_END` and the engine both enforce this). Consider always-enabling `START`/`END`, or documenting it in the card.
8. **Lint is non-blocking in CI with 17 problems.** Most are `react-hooks` compiler rules in the Magic UI components (`Math.random` in render, `setState` in effects). Fix them, then make lint blocking.
9. **Docs drift.**
   - `apps/web/README.md` is still `create-next-app` boilerplate.
   - The root README said C2–C7 were "in open PRs", but PRs #3 and #4 are merged. The status line is updated in this change.
10. **Playwright isn't run in CI.** The C1 crash was reachable from any edge click. An E2E smoke test of "click edge → inspector opens" would have caught it.
11. **Run the engine typecheck in CI.** Add this step to `.github/workflows/ci.yml` before the engine unit tests. It now passes, but it was left out of this change because it edits a workflow file:
    ```yaml
          - name: Typecheck fsm-engine
            if: hashFiles('packages/fsm-engine/package.json') != ''
            run: pnpm --filter @fsm/engine typecheck
    ```
