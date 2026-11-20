# Demo: water network inspection → crew dispatch

A 5–7 minute walkthrough showing how this FSM workflow creator could orchestrate AI inspection and field-worker workflows at a water utility.

The workflow ships as a built-in template (`water-inspection-triage`) with 9 runnable scenarios.

## The one-line pitch

> Inspection AI is only useful once its findings safely become field work. This tool turns that pipeline into an explicit, testable state machine:
> - specialist AI models run in parallel,
> - context is compressed before the expensive reasoning step,
> - guardrails stop runaway AI retries,
> - a supervisor stays in the loop for critical calls,
> - every failure lands in a visible escalation queue instead of disappearing.

## Setup (2 minutes, do this before the call)

1. Start the app.

   ```bash
   pnpm install
   ```

   ```bash
   pnpm dev
   ```

2. Open http://localhost:3000, click **New Harness**, set **Start from** to **Water network inspection → crew dispatch**, then **Create & open canvas**.
   - On an existing project, use the **Templates** button in the canvas toolbar instead.
3. Open **Runs** and press **Run engine** once, so the history panel isn't empty.

> Canvases are stored in the browser's localStorage. Set up the demo in the **same browser** you will present from.

## The workflow (14 states)

```
Shift start → Pull inspection batch (HTTP) → Validate records (VALIDATE)
  → Specialist AI inspectors (SPAWN ×3, parallel)
      ├─ defects  : PACP-style defect coding from CCTV frames
      ├─ leaks    : acoustic leak-signature analysis
      └─ quality  : drinking-water lab-result threshold checks
  → Merge findings (AGGREGATE) → Checkpoint context (SYS_FUNC: dehydrate raw footage)
  → Risk triage (AI, schema-checked, self-correct ≤2)
      ├─ routine  → Schedule routine work (SCRIPT) ─────────────┐
      └─ CRITICAL → Supervisor sign-off (HUMAN)                  │
             ├─ approve → Raise urgent work order (HTTP → CMMS) ─┤→ Notify field crew → Crew dispatched
             ├─ edit    → back to Risk triage                     │
             ├─ reject  → Closed: no action                       │
             └─ timeout → Escalation hold                         │
  any ::*.ERROR (bad data, CMMS down, AI schema failure) ─────────→ Escalation hold
```

## Click-by-click script

| # | Do | Say |
|---|----|-----|
| 1 | Open the **Canvas**. Point at the **Lint clean** badge. | "Every state is independently verifiable, and the linter guarantees every work step has an error route. Nothing can silently dead-end." |
| 2 | Click **Specialist AI inspectors**. Switch the **Child** chips (defects / leaks / quality) and open the Tools and Skills tabs. | "One fan-out, three different specialist models. Each has its own tools, skills and model. They run in parallel, capped at 3 concurrent." |
| 3 | Click **Checkpoint context**. | "Raw footage and acoustic logs are dehydrated here. The triage model sees a compact summary, so token cost stays flat however much data the crews upload." |
| 4 | Click **Risk triage**. Show the system prompt, output schema and the dashed self-loop. | "The AI must return a schema-valid triage. If it doesn't, it gets two re-prompts, and then a hard stop." |
| 5 | Click **Supervisor sign-off**. | "Critical calls never auto-dispatch a crew. A human approves, sends back with notes, or rejects." |
| 6 | **Runs** → scenario **Routine finding** → Run engine. | Show the path chips. "No human needed for low-severity work." |
| 7 | Scenario **Critical defect, supervisor approves**. | "Critical goes through sign-off, then a CMMS work order, then crew notified. ✓ as expected." |
| 8 | Scenario **Supervisor sends back, then approves**. | "The run history shows Risk triage → Supervisor twice: the human loop is first-class." |
| 9 | Scenario **AI output malformed, self-corrects**. | Point at **Risk triage ×3**. "It recovered by itself within the guardrail." |
| 10 | Scenario **AI keeps failing → guardrail stops it**. | "It fails fast with `maxIterations=2` instead of burning tokens in a loop." |
| 11 | Scenario **Work-order system down**. | Amber banner: "Routed to Escalation hold via ::HTTP.ERROR. Outages become a visible ops queue, not lost jobs." |
| 12 | Click any row in **Run history**. | "Every run is persisted with its events, so you can replay and audit." |
| 13 | **Export**. Pick Python + Redis and show the compose preview. | "The same definition compiles to a standalone harness. The DSL and registry download as JSON." |

## All scenarios

| Scenario | Overrides (signal per visit) | Expected end |
|----------|------------------------------|--------------|
| Routine finding | — | Crew dispatched |
| Critical defect, supervisor approves | triage `TRIAGE.CRITICAL`, review `HUMAN.APPROVE` | Crew dispatched |
| Supervisor sends back, then approves | triage CRITICAL ×2, review `EDIT` then `APPROVE` | Crew dispatched (2 triage passes) |
| False positive rejected | triage CRITICAL, review `REJECT` | Closed: no action |
| AI output malformed, self-corrects | triage `AI.GENERATE` ×2 then `AI.NEXT` | Crew dispatched (triage ×3) |
| AI keeps failing → guardrail stops it | triage `AI.GENERATE` ×3 | **Run fails**: `maxIterations=2` |
| Bad inspection data | validate `VALIDATE.ERROR` | Escalation hold |
| Work-order system down | CRITICAL, APPROVE, work order `HTTP.ERROR` | Escalation hold |
| Nobody signs off in time | CRITICAL, review `HUMAN.TIMEOUT` | Escalation hold |

**Custom branches…** in the scenario menu lets you steer any branching state live, if an interviewer asks "what if…?".

## Be upfront about what is real vs. simulated

- **Real:**
  - the state machine engine (transition allowlist, parallel spawn pool, aggregation envelopes, retries, timeouts, self-loop caps)
  - lint and DSL compile
  - persisted run history
- **Simulated:**
  - AI, HTTP, SCRIPT and HUMAN executors are stubs.
  - Scenarios script which signal each state emits, which is how branches are exercised without live models or a CMMS. Live executors are Feature 003 in `FeatureShipping/`.
- **Endpoints:** `example-utility.com` URLs are placeholders.

## Questions you may get

- **"How would this plug into our models?"**
  - Each specialist is a SPAWN profile with its own child FSM, model and credential.
  - Your vision or acoustic model is a tool in its tool pack, or an EXTERNAL_AI endpoint.
- **"How do you stop hallucinated severity from dispatching crews?"**
  - Schema-checked output with a capped self-correction loop.
  - Mandatory HUMAN sign-off on the critical branch.
  - Lint guarantees error routes exist.
- **"Cost?"**
  - The SYS_FUNC checkpoint dehydrates raw media before the expensive triage step.
  - SPAWN `maxConcurrency` caps parallel spend.
- **"Audit and compliance?"**
  - Every run, path and emitted signal is persisted and replayable.
  - The workflow itself is a versioned JSON DSL.
