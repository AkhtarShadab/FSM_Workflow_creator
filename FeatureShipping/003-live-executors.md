# 003 — Live Executors

> Status: **Design**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §§6, 8–9  
> Code today: in-app run loop under `apps/web` / `packages/fsm-engine` (simulated / stubbed executors)  
> Expand with: **detail-feature** (high-end) · Implement with: **ship-feature** (Composer/Grok)

---

## What

Replace stubbed run executors so `AI` / `HTTP` (and related) states perform **real** inference and HTTP calls during a harness run, streaming results into `run_events`.

## How

- Server-side BYOK gateway route(s) that hold credentials and call providers securely
- Map DSL state types → executor adapters (AI streaming, HTTP fetch with timeouts/retries)
- Emit structured run events (start / token / tool / error / complete) into the existing event store
- Keep the canvas run UI wired to the same event stream

## Why

Runs are currently simulated. Live executors are the core product value — without them the authoring canvas cannot validate real harnesses.

---

## Goals & non-goals

### Goals

- Real AI_INFERENCE + HTTP execution on the server
- Streaming progress into `run_events`
- Reuse multi-BYOK credentials / per-state model bindings from Feature 001

### Non-goals

- Full gRPC tool runtime (separate phase)
- Harness Docker export (004)
- Credential encryption redesign beyond what 005 covers (coordinate boundaries)

---

## Open questions

1. Stream transport: SSE vs WebSocket vs polled `run_events`?
2. Does the gateway live in `apps/web` routes first, or a new `packages/byok-gateway` immediately?

---

## Suggested implementation phases

| Phase | Scope |
|-------|--------|
| E1 | Server AI executor + event streaming for one provider |
| E2 | HTTP executor + retries / error signals |
| E3 | Multi-provider + per-state credential/model binding end-to-end |
