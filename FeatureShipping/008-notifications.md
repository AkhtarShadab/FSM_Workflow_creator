# 008 — Notifications

> Status: **Detailed**
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §15 · Roadmap Wave 1
> Code today: bento tile in [`page.tsx`](../apps/web/src/app/page.tsx) (lines 140–147) with `cta="Soon"` and a decorative visual — no route, no data
> Depends on: [003](003-live-executors.md) · Blocks: [007](007-calendar.md) · Implement with: **ship-feature** (Composer/Grok)

---

## What

A durable in-app notification feed — bell with unread count, inbox page, mark read/clear — fed by run outcomes, human approvals, schedule fires, budget breaches, and credential failures.

## Why

Once [003](003-live-executors.md) makes runs asynchronous, the author no longer sits and watches a blocking request finish. A long run, a paused HUMAN state, or a budget halt can happen minutes after they navigated away, and nothing tells them. The tile already promises this, and [007](007-calendar.md)'s scheduled runs are unusable without it — a run that fires at 3am with no record of the outcome is worse than no scheduling at all.

## How

### Schema

```ts
notifications: {
  id: integer pk,
  projectId: integer? → projects (cascade),
  runId: integer? → runs (cascade),
  type: "run.succeeded" | "run.failed" | "run.interrupted" | "human.awaiting"
      | "schedule.fired" | "budget.exceeded" | "credential.failed",
  severity: "info" | "warning" | "error",
  title: text,                    // one line, no interpolated secrets
  body: text,                     // short detail
  linkPath: text?,                // e.g. /project/3/runs?run=42
  dedupeKey: text?,               // unique with readAt IS NULL — collapses repeats
  readAt: integer?,
  createdAt: integer,
}
```

Index on `(read_at, created_at desc)` for the unread badge; unique index on `dedupe_key` where `read_at is null`.

### Emission

One choke point so producers never touch the table directly:

```ts
// apps/web/src/lib/notifications/emit.ts
export async function notify(input: {
  type: NotificationType; severity?: Severity; title: string; body?: string;
  projectId?: number; runId?: number; linkPath?: string; dedupeKey?: string;
}): Promise<void>;
```

| Producer | Emits |
|----------|-------|
| Run supervisor ([003](003-live-executors.md)) | `run.succeeded` (info), `run.failed` (error), `run.interrupted` (warning), `human.awaiting` (warning) |
| Budget guard ([011](011-token-and-observability.md)) | `budget.exceeded` (error or warning depending on `onExceed`) |
| Discovery / executors ([005](005-credential-security.md)) | `credential.failed` (error) |
| Scheduler ([007](007-calendar.md)) | `schedule.fired` (info) |

Emission is best-effort: a failure here is logged and swallowed, never allowed to fail a run.

### Delivery to the client

Reuse the existing run SSE channel with a second, app-scoped stream at `GET /api/notifications/stream` so the bell updates live. Clients that cannot hold SSE fall back to polling `getUnreadCount()` every 60 s.

## UI implications

| Surface | Change |
|---------|--------|
| App shell header | Bell with unread count and a popover of the five most recent items |
| New `/notifications` route | Full inbox: filter by severity and project, mark read, mark all read, clear read |
| [`page.tsx`](../apps/web/src/app/page.tsx) | Notifications bento tile loses `cta="Soon"` and links to the inbox with a live count |
| [`runs-view.tsx`](../apps/web/src/components/runs/runs-view.tsx) | Deep-link target when a notification is clicked (highlight the referenced run) |

## File / API change map

| Phase | Touch | Change |
|-------|-------|--------|
| N1 | `src/db/schema.ts`, `migrations/*` | `notifications` table + indexes |
| N1 | `src/lib/notifications/emit.ts` (new) | `notify()` with dedupe |
| N1 | `src/app/notifications/actions.ts` (new) | `listNotifications`, `getUnreadCount`, `markRead`, `markAllRead`, `clearRead` |
| N2 | `src/components/notifications/notification-bell.tsx` (new), app shell | Bell, unread badge, recent popover |
| N2 | `src/app/notifications/page.tsx` (new) | Inbox with filters |
| N2 | `src/app/page.tsx` | Tile becomes live |
| N3 | `src/lib/run-supervisor.ts`, `src/lib/context/budget.ts`, discovery paths | Call `notify()` at the listed emission points |
| N3 | `src/app/api/notifications/stream/route.ts` (new) | SSE for live badge updates |
| N4 | `src/lib/notifications/sinks/webhook.ts` (new) | Optional outbound webhook per project |

## Edge cases & failure modes

| Case | Expected behavior |
|------|-------------------|
| Same failure repeats in a loop | `dedupeKey` collapses it into one unread row; a counter shows `×N` |
| Notification insert fails | Logged and swallowed; the run is never affected |
| Run or project deleted | Cascade removes its notifications; the inbox never shows orphans |
| Unread count very large | Badge caps at `99+` |
| Secret in an error message | `notify()` scrubs anything matching the key pattern before writing |
| Retention | Read notifications older than 30 days are pruned by a startup sweep |
| SSE unsupported | Falls back to 60 s polling; the badge is eventually consistent |
| Marking read in two tabs | Idempotent — `markRead` on an already-read row is a no-op |

## Open questions

1. Per-user streams once accounts exist (Q2) — the schema keeps `projectId` nullable to allow it later.
2. Should webhook sinks be per-project or global in the first pass?

## Implementation phases

| Phase | Scope | Size |
|-------|-------|------|
| N1 | Schema + `notify()` + query actions | 1 PR |
| N2 | Bell, inbox page, live tile | 1 PR |
| N3 | Emission wiring + SSE badge | 1 PR |
| N4 | Optional webhook sink | 1 PR |

## Test plan

**Vitest** — `src/lib/notifications/*.test.ts`

- `notify()` writes a row with the correct type, severity, and link path.
- Two identical `dedupeKey` emissions while unread produce one row with count 2.
- The same `dedupeKey` after the first is read produces a new row.
- A message containing a key-shaped string is scrubbed before persistence.
- `getUnreadCount` ignores read rows and caps rendering at `99+`.
- `markRead` is idempotent; `markAllRead` clears every unread row for the scope.
- A thrown DB error inside `notify()` is swallowed and logged, and the caller still resolves.
- The retention sweep deletes read rows older than 30 days and keeps unread ones.
- Severity mapping: `run.failed` → error, `human.awaiting` → warning, `run.succeeded` → info.

**Playwright** — `e2e/notifications.spec.ts` (`FSM_MOCK_PROVIDER=1`)

- Run a failing FSM → the bell shows 1 unread without a page reload.
- Click the notification → lands on the referenced run, highlighted.
- Mark read → the badge returns to zero and survives a reload.
- A HUMAN state pausing a run produces a `human.awaiting` notification linking to the approval card.
- The home tile shows a live count instead of `Soon`.

## Acceptance criteria

- [ ] Run outcomes, human pauses, budget breaches, and credential failures all produce notifications.
- [ ] The bell updates live and the count survives reloads.
- [ ] Repeated identical failures collapse rather than flooding the inbox.
- [ ] No notification ever contains secret material.
- [ ] The Notifications tile no longer says `Soon`.
- [ ] Vitest and Playwright suites above pass in CI.
