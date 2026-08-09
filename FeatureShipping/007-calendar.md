# 007 — Calendar

> Status: **Design**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) (product shell / bento tiles)  
> Code today: "Soon" Calendar tile in the web UI  
> Expand with: **detail-feature** (high-end) · Implement with: **ship-feature** (Composer/Grok)

---

## What

A Calendar surface for scheduling harness runs and viewing timed automation windows — the product already promises this via a bento "Soon" tile.

## How

- Stub → Detailed design later: event model (one-shot / cron), linkage to FSM project + trigger payload
- UI: calendar month/week list bound to scheduled runs; create/edit from inspector or tile
- Backend: schedule store (Turso) + runner wake-up (cron worker / external scheduler)

## Why

Already surfaced in the UI as a coming feature; scheduling is a natural companion to exportable harnesses and notifications.

---

## Goals & non-goals

### Goals

- Schedule harness runs (cron + one-shot)
- Calendar UI replacing the "Soon" tile

### Non-goals

- Full external calendar sync (Google/Outlook) in v1
- Multiplayer schedule editing

---

## Open questions

1. Does scheduling live in-platform only, or also inside exported harnesses?
2. Timezone model: project-local vs user-local?

---

## Suggested implementation phases

| Phase | Scope |
|-------|--------|
| Cal1 | Data model + CRUD API |
| Cal2 | Calendar UI tile |
| Cal3 | Runner wake-up integration |
