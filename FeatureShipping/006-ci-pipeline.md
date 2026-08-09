# 006 — CI Pipeline

> Status: **Design**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §§12–13  
> Code today: Vitest (+ Playwright scripts) locally; GitHub Actions workflow landing in hygiene PR  
> Expand with: **detail-feature** (high-end) · Implement with: **ship-feature** (Composer/Grok)

---

## What

A reliable GitHub Actions pipeline that gates PRs on install, typecheck, unit tests, and (later) Playwright E2E.

## How

- Workflow on `pull_request` / `push`: pnpm install (cache), `tsc --noEmit`, `pnpm --filter web test`, `pnpm --filter @fsm/engine test`
- Lint optional/non-blocking until noise is cleaned up
- Playwright job optional until browsers + app server are cheap to boot in CI

## Why

The PR train ships real tests, but nothing runs them automatically. CI is the gate that keeps FeatureShipping phases honest.

---

## Goals & non-goals

### Goals

- Required typecheck + unit tests on every PR
- pnpm caching for fast feedback
- Path to enable Playwright without blocking the initial pipeline

### Non-goals

- Deploy/preview environments in v1
- Matrix across multiple OS images

---

## Open questions

1. Should Playwright run on `master` only, nightly, or every PR once stable?
2. Separate lint-cleanup PR before making eslint required?

---

## Suggested implementation phases

| Phase | Scope |
|-------|--------|
| CI1 | Typecheck + unit tests workflow (hygiene baseline) |
| CI2 | Make lint required after cleanup |
| CI3 | Playwright job with cached browsers |
