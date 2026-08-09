# 008 — Notifications

> Status: **Design**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) (product shell / bento tiles)  
> Code today: "Soon" Notifications tile in the web UI  
> Expand with: **detail-feature** (high-end) · Implement with: **ship-feature** (Composer/Grok)

---

## What

In-app (and later channel) notifications for harness run outcomes, schedule fires, budget breaches, and credential/discovery failures — replacing the "Soon" Notifications tile.

## How

- Notification model: type, severity, project/run refs, read state
- UI inbox / bell in the shell; optional deep-link to run inspector
- Emission points: run complete/fail, calendar trigger, token budget exceed, BYOK errors
- Future: email / webhook / Slack-style sinks (out of v1 stub)

## Why

Already promised in the UI. Authors need durable signals when long runs finish or schedules fire without watching the canvas.

---

## Goals & non-goals

### Goals

- Persist and list in-app notifications
- Emit on key run / schedule / budget events
- Mark read / clear

### Non-goals

- Mobile push
- Full external channel matrix in v1

---

## Open questions

1. Per-user vs per-project notification streams once accounts exist (Q2)?
2. Retention / TTL defaults?

---

## Suggested implementation phases

| Phase | Scope |
|-------|--------|
| N1 | Schema + API + inbox UI |
| N2 | Emit from run engine + calendar |
| N3 | Optional webhook sink |
