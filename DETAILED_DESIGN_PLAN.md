# AI Harness Creator — Detailed Design Plan

> Status: **Draft v1.0** (pre-scaffold)
> Source: `InitialDraftPlan.md`
> This document is the implementation-grade expansion of the initial draft. It defines
> component boundaries, data models, the signal grammar, testing infrastructure
> (Vitest + Playwright), the CI pipeline, open questions, and the next steps required
> to fully de-risk the project before Phase 1 code lands.

---

## Table of Contents

1. [Vision Recap & Design Goals](#1-vision-recap--design-goals)
2. [Terminology](#2-terminology)
3. [System Architecture](#3-system-architecture)
4. [Monorepo Layout & Module Boundaries](#4-monorepo-layout--module-boundaries)
5. [Data Models & FSM Definition DSL](#5-data-models--fsm-definition-dsl)
6. [FSM Engine Design](#6-fsm-engine-design)
7. [Token Optimization & Context Management](#7-token-optimization--context-management)
8. [gRPC Bridge & Multi-Language Tool Runtime](#8-grpc-bridge--multi-language-tool-runtime)
9. [BYOK Gateway](#9-byok-gateway)
10. [Frontend Design (Next.js + Magic UI)](#10-frontend-design)
11. [Export / Compilation Engine](#11-export--compilation-engine)
12. [Testing Strategy (Vitest + Playwright)](#12-testing-strategy-vitest--playwright)
13. [CI/CD Pipeline](#13-cicd-pipeline)
14. [Security & Secrets](#14-security--secrets)
15. [Observability](#15-observability)
16. [Refined Implementation Roadmap](#16-refined-implementation-roadmap)
17. [Next Steps to Fully Understand This Project](#17-next-steps-to-fully-understand-this-project)
18. [Open Questions](#18-open-questions)
19. [Proposed Enhancements (Beyond Draft Scope)](#19-proposed-enhancements-beyond-draft-scope)
20. [Appendix](#20-appendix)

---

## 1. Vision Recap & Design Goals

The AI Harness Creator is a **meta-framework**: a visual authoring platform that produces
standalone, containerized automation harnesses. Each harness is a **Finite State Machine**
in which:

- **Deterministic work** (computation, file I/O, API fetching) runs in isolated native
  tools (C++ / Python / Bash) — never on the LLM.
- **Generative work** (reasoning, unstructured data processing) runs against a
  bring-your-own-key (BYOK) LLM gateway.
- **Token usage** is aggressively minimized via lazy context loading (State 0) and
  context checkpointing (System Functions).

### Design goals (ranked)

| # | Goal | Measurable proxy |
|---|------|------------------|
| G1 | Determinism first — LLM never does a script's job | % of state executions that are non-LLM |
| G2 | Flat token cost regardless of FSM depth | Prefill tokens at state N vs state 1 (target: ~constant) |
| G3 | Language-agnostic tools with zero translation layer | gRPC round-trip overhead < 5 ms local |
| G4 | Exportable, self-contained harnesses | `docker compose up` on a fresh machine works |
| G5 | Authoring speed | Time from blank canvas to first running harness < 10 min |

### Non-goals (v1)

- Multi-tenant SaaS hosting of running harnesses (platform authors, harnesses run user-side).
- Real-time collaborative canvas editing.
- Non-FSM paradigms (DAG-only pipelines, agent swarms without explicit states).

---

## 2. Terminology

| Term | Definition |
|------|-----------|
| **Harness** | A compiled, runnable artifact: FSM definition + tools + runtime config + Dockerfile |
| **FSM Definition** | Versioned JSON document describing states, transitions, tools, guardrails |
| **State** | A node; exactly one of: `START`, `SCRIPT`, `AI`, `SPAWN`, `AGGREGATE`, `SYSTEM_FUNCTION`, `END` |
| **Signal** | A structured string emitted by a state that drives the next transition (`::SCRIPT.NEXT_STATE3|message="..."`) |
| **State 0** | Mandatory entry state; hydrates config, emits only a high-level phase map |
| **System Function** | Boundary node between state clusters; performs Dehydration → Mask Swap → Hydration |
| **Cluster** | Logical group of states (e.g., "Phase 1: Ingestion") sharing tool schemas |
| **Dehydration** | Persisting raw execution context to the store and evicting it from the LLM context window |
| **Hydration** | Re-populating the context window with a concise summary + next cluster's schemas |
| **BYOK** | Bring Your Own Key — user supplies base URL + API key; platform discovers models dynamically |
| **Tool** | A native executable (C++ binary, Python script, Bash script) exposed over gRPC |
| **Run** | One execution instance of a harness, with its own run log, checkpoints, and metrics |

---

## 3. System Architecture

### 3.1 Component inventory

| Component | Tech | Responsibility |
|-----------|------|----------------|
| **Web App (Creator UI)** | Next.js 15 (App Router), React Flow, Zustand, Tailwind, Framer Motion, Magic UI | Canvas authoring, inspector, copilot chat, run monitor, export triggers |
| **Platform API** | Next.js route handlers (tRPC proposed — see Q1) | CRUD for projects/FSMs, run orchestration, BYOK proxy, export jobs |
| **Platform DB** | Turso (libSQL) via Drizzle ORM — edge-distributed SQLite, no separate prod DB upgrade needed | Projects, FSM definitions, credentials (encrypted), run history |
| **FSM Engine** | Node.js (TypeScript), framework-free core package | Signal parsing, transition execution, guardrails, retries, subagent orchestration |
| **gRPC Bridge** | `nice-grpc` or `@grpc/grpc-js` + **buf** for proto toolchain | Typed invocation of native tools, streaming tool logs |
| **Tool Runtimes** | Python (`grpcio`), C++ (gRPC C++), Bash (via Python shim — see §8.4) | Execute deterministic work in containers |
| **BYOK Gateway** | Node adapter layer (OpenAI SDK, Anthropic SDK, generic OpenAI-compatible) | Model discovery, chat completion proxy, token accounting |
| **Checkpoint Store (harness-side)** | Adapter interface: Redis (default) / MongoDB / SQL | Dehydrated context, run checkpoints, subagent results |
| **Memory Graph Store** | Turso tables (`memory_nodes` + `memory_edges`) | Long-term, graph-organized memory: facts, artifacts, preferences, checkpoint refs — browsable as a graph in the UI |
| **Export Engine** | Template-based codegen (ETA/Handlebars) | Emits harness ZIP / git repo: Dockerfile, compose, proto, fsm.json, tool stubs |

### 3.2 Deployment view

```
┌──────────────────────────── PLATFORM (creator) ───────────────────────────┐
│  Next.js app  ──►  Platform API  ──►  Turso (libSQL)                     │
│       │                 │                                                 │
│       │                 └──► Export Engine ──► ZIP / git push             │
└──────────────────────────────────────┬────────────────────────────────────┘
                                        │ produces
┌──────────────────────────── GENERATED HARNESS ────────────────────────────▼───┐
│  docker-compose                                                               │
│   ├── fsm-controller (Node)  ──gRPC──►  tools-python                          │
│   │                           ──gRPC──►  tools-cpp                            │
│   │                           ──gRPC──►  tools-bash (shim)                    │
│   ├── checkpoint-store (Redis | Mongo | SQL)                                  │
│   └── byok-gateway ──HTTPS──► OpenAI / Anthropic / proxy                      │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Key architectural decisions (proposed — confirm in §18)

| # | Decision | Proposal | Alternative | Rationale |
|---|----------|----------|-------------|-----------|
| D1 | Monorepo tooling | **pnpm workspaces + Turborepo** | npm workspaces | Fast CI caching, mature filtering |
| D2 | Platform API style | **tRPC** (TS end-to-end) | REST/OpenAPI | Type safety canvas↔API; harness runtime uses gRPC anyway |
| D3 | ORM | **Drizzle ORM** (with Turso/libSQL adapter) | Prisma | Turso is built on libSQL (SQLite fork). Drizzle has first-class Turso support, edge-ready HTTP queries, and fully typed schemas — no separate production DB upgrade needed. Prisma has only experimental libSQL support. |
| D4 | Engine impl | **Custom signal-driven engine** | XState | Signal grammar + dynamic subagent spawning don't map cleanly to XState's actor model; keep core dependency-free |
| D5 | Proto toolchain | **buf** (lint, breaking, codegen) | raw protoc | CI-enforceable schema evolution |
| D6 | Bash tools | **Python gRPC shim that execs bash** | "bash gRPC server" | There is no sane native bash gRPC server; one shim serves all bash tools |
| D7 | FSM definition format | **Versioned JSON + Zod schemas** | YAML / DB-only | Diff-able, exportable, validatable in CI |

---

## 4. Monorepo Layout & Module Boundaries

```
FSM_Workflow_creator/
├── apps/
│   └── web/                      # Next.js creator platform
│       ├── app/                  # App Router pages
│       ├── components/           # canvas/, inspector/, copilot/, ui/ (Magic UI)
│       ├── server/               # tRPC routers, services
│       └── db/                   # Drizzle schema & migrations (Turso/libSQL)
├── packages/
│   ├── fsm-engine/               # ⭐ pure TS, zero Next deps — also ships in harnesses
│   │   ├── src/parser/           # signal grammar parser
│   │   ├── src/runner/           # execution loop, state handlers
│   │   ├── src/subagents/        # spawn/aggregate orchestration
│   │   ├── src/context/          # State-0 hydration, checkpoint (de)hydration
│   │   └── src/guardrails/       # retries, timeouts, JSON-schema validators
│   ├── proto/                    # .proto sources + buf config + generated stubs
│   ├── grpc-bridge/              # Node client wrapper: tool discovery, pooling, streaming
│   ├── byok-gateway/             # provider adapters, model discovery, token accounting
│   ├── fsm-schema/               # Zod schemas for the FSM DSL (shared web ↔ engine)
│   └── export-engine/            # harness codegen templates + compiler
├── harness-templates/            # base Dockerfile/compose per language, per store
├── e2e/                          # Playwright workspace (see §12)
├── .github/workflows/            # CI (see §13)
├── docs/
│   ├── InitialDraftPlan.md
│   └── DETAILED_DESIGN_PLAN.md   # (this file)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**Boundary rule:** `packages/fsm-engine`, `packages/grpc-bridge`, `packages/byok-gateway`,
and `packages/fsm-schema` must **never import Next.js or React** — they are compiled into
the exported harness. Enforce via ESLint `no-restricted-imports` + a CI architecture check.

---

## 5. Data Models & FSM Definition DSL

### 5.1 Platform DB (Turso via Drizzle ORM)

**Why Turso?** [Turso](https://docs.turso.tech/introduction) is built on libSQL (an open-source fork
of SQLite) and adds edge replication, HTTP-based remote queries, and a generous free tier.
It works identically to SQLite for local development (`turso dev` / embedded mode) but scales
to a distributed edge database in production — no schema migration, no separate Postgres upgrade.
Drizzle ORM has [first-class Turso support](https://orm.drizzle.team/docs/quick-sqlite/turso).

```
Project        id, name, createdAt, updatedAt
FsmDefinition  id, projectId →Project, version, json (DSL blob), createdAt
Credential     id, projectId, provider, baseUrl, encryptedKey, label, createdAt
Run            id, fsmId →FsmDefinition, status, startedAt, endedAt, tokenUsageJson
RunEvent       id, runId →Run, stateId, kind, payloadJson, tokensIn, tokensOut, latencyMs, ts
ExportJob      id, fsmId, target (zip|git), status, artifactUrl, createdAt
MemoryNode     id, projectId →Project (nullable), kind (fact|artifact|preference|checkpoint_ref),
               label, content, createdAt
MemoryEdge     id, projectId, sourceId →MemoryNode, targetId →MemoryNode, relation, createdAt
```

Memory is **graph-organized** (§5.3): nodes are discrete memory units, edges are typed
relations (`derived_from`, `prefers`, `summarizes`, `references`). Global memories have
`projectId = NULL`; project-scoped memories cascade-delete with their project.

Schema is defined via **Drizzle Kit** (`drizzle-kit`). Migrations are SQL files committed
to version control. The same schema runs in local dev mode (`turso dev` → embedded SQLite)
and against remote Turso databases (HTTP protocol, no driver needed).

Harness-side persistence (Redis/Mongo/SQL) is intentionally separate and selected at
export time; only **adapters** live in `packages/fsm-engine/src/context/store/`.

### 5.3 Memory Layer (graph-based)

The platform keeps a **long-term memory graph** alongside the run-scoped checkpoint
store. Checkpoints are ephemeral (TTL); memory is durable and queryable.

| Aspect | Design |
|--------|--------|
| Storage | `memory_nodes` + `memory_edges` in Turso — same DB as the platform, zero new infra |
| Node kinds | `fact` (learned truth), `artifact` (output ref), `preference` (user/BYOK prefs), `checkpoint_ref` (pointer into checkpoint store) |
| Edge relations | `derived_from`, `summarizes`, `prefers`, `references` (typed, directed) |
| Writers | System Functions (post-dehydration summaries → `summarizes` edges), Audit analyzer (§6.5), manual UI entries |
| Readers | State 0 hydration pulls the project's top-N memory nodes (by recency/degree) into the phase map; System Functions re-hydrate relevant subgraphs |
| UI | `/memory` — graph view (sticky-note nodes + pencil edges, same visual language as the canvas); the landing **integrations bento** (Workflow · Memory · Calendar · Notifications) links here |
| Export | Memory tables are platform-side; exported harnesses get a read-only memory snapshot as `memory.json` (v2, see Q29) |

Why graph-based: FSM states produce/consume knowledge with many-to-many structure —
flat lists don't capture `derived_from` chains, and a graph view reuses the canvas
visual system we already built (zero new rendering stack).

### 5.2 FSM Definition DSL (JSON, versioned)

```jsonc
{
  "version": 1,
  "name": "ingest-and-summarize",
  "config": {
    "toolLanguage": "python",            // "cpp" | "python" | "bash" (one per harness)
    "checkpointStore": "redis",          // "redis" | "mongo" | "sql"
    "tokenBudget": { "perRun": 200000, "perState": 20000, "onExceed": "halt" }
  },
  "clusters": [
    { "id": "ingest", "label": "Phase 1: Ingestion", "states": ["S0", "S1", "S2"] },
    { "id": "transform", "label": "Phase 2: Transform", "states": ["SF1", "S3", "S4"] }
  ],
  "states": [
    {
      "id": "S0", "type": "START",
      "hydration": { "configKeys": ["SOURCE_URL"], "emitPhaseMap": true },
      "transitions": [{ "on": "::SCRIPT.NEXT", "to": "S1" }]
    },
    {
      "id": "S1", "type": "SCRIPT",
      "tool": { "name": "fetch_pages", "timeoutMs": 30000, "retry": { "max": 2, "backoffMs": 1000 } },
      "transitions": [
        { "on": "::SCRIPT.NEXT", "to": "S2" },
        { "on": "::SCRIPT.ERROR", "to": "ERR" }
      ]
    },
    {
      "id": "S2", "type": "AI",
      "llm": { "model": "claude-sonnet-4-5", "temperature": 0.2, "maxTokens": 4000,
               "systemPrompt": "...", "outputSchema": { "$ref": "#/schemas/pageSummary" } },
      "transitions": [{ "on": "::AI.NEXT", "to": "S3" }]
    },
    {
      "id": "SF1", "type": "SYSTEM_FUNCTION",
      "checkpoint": { "dehydrateClusters": ["ingest"], "hydrateCluster": "transform",
                      "summaryStrategy": "llm" }        // or "template"
    },
    {
      "id": "S3", "type": "SPAWN",
      "spawn": { "childFsm": "child-worker", "count": 3, "aggregateTo": "S4",
                 "strategy": "waitAll", "timeoutMs": 120000 }
    }
  ],
  "schemas": { "pageSummary": { "type": "object", "properties": { "...": {} } } }
}
```

Validation: Zod schemas in `packages/fsm-schema`, enforced (a) in the UI on edit,
(b) in the engine on load, (c) in CI on fixture changes.

---

## 6. FSM Engine Design

### 6.1 Signal grammar (formal)

```
signal      ::= "::" namespace "." action ("|" param)*
namespace   ::= "SCRIPT" | "AI" | "SYSTEM" | "SPAWN" | custom-NAMESPACE
action      ::= IDENT ("_" IDENT)*
param       ::= key "=" value
key         ::= IDENT
value       ::= '"' quoted-string '"' | number | boolean | bare-IDENT
```

Canonical set (v1):

| Signal | Emitted by | Engine behavior |
|--------|-----------|-----------------|
| `::SCRIPT.NEXT[_NAME]` | tool exit 0 | transition to mapped state, payload → run context |
| `::SCRIPT.ERROR` | tool non-zero / timeout | route to error transition or default handler |
| `::AI.NEXT` / `::AI.GENERATE` | AI state | transition / chained generation |
| `::SPAWN.SUBAGENTS\|count=N\|target=X` | SPAWN state | start N child FSM runs, park parent |
| `::SYSTEM.DEHYDRATE\|checkpoint_id=...` | System Function | persist context slice, return checkpoint ref |
| `::SYSTEM.HYDRATE\|checkpoint_id=...` | System Function | load summary + cluster schemas |
| `::SYSTEM.HALT\|reason=...` | any | stop run, persist final checkpoint |

Parser: hand-rolled tokenizer (~150 LOC, zero deps) in `packages/fsm-engine/src/parser/`
with a golden-file test corpus (valid + malformed signals).

### 6.2 Execution loop

```
load(fsmJson) → validate(zod) → build transition table
run():
  ctx = RunContext { vars, history, tokenLedger, checkpointRefs }
  current = S0
  while current.type != END:
    handler = handlers[current.type]
    result  = await handler.execute(current, ctx)     // may call gRPC tools or BYOK
    ledger.record(result.tokensIn, result.tokensOut, result.latencyMs)
    guardrails.check(current, result)                 // budget, schema, retry policy
    signal  = result.signal
    current = transitionTable.next(current, signal)   // throws on unmatched signal
  persist run summary
```

### 6.3 Subagent orchestration

- `SPAWN` state creates N child runs of the referenced child FSM, each with an isolated
  `RunContext` (own token sub-ledger, own checkpoints).
- Parent parks in `AGGREGATE`; children report completion via gRPC to the controller.
- Aggregation strategies: `waitAll` | `quorum(k)` | `firstSuccess` (see Q6).
- Partial results on timeout: configurable `onTimeout: "usePartial" | "fail"`.
- Child outputs merge into parent context as `vars.subagents[i].payload`.

### 6.4 Guardrails

- **Timeout** per tool/LLM call; **retry** with exponential backoff (deterministic states only; AI-state retries must be idempotent by prompt hash).
- **Output schema validation** for AI states (JSON Schema via `ajv`); on failure → `::AI.VALIDATION_ERROR` → configured fallback or retry-with-correction-prompt (max 1, see Q9).
- **Token budget ledger** checked pre-call (estimated) and post-call (actual).

### 6.5 Meta-cognitive self-update loop

- `RunEvent` rows feed an **Audit analyzer** (runs post-run or on schedule):
  failure rate per state, p95 latency, tokens/state vs budget.
- Rewrite proposals (prompt edits, timeout bumps, model downgrade) are emitted as
  **proposals, never auto-applied in v1** — they land in the UI inspector as
  "suggested changes" with accept/reject (see Q4: auto-apply is a product decision).
- All mutations bump `FsmDefinition.version` (immutable history enables rollback + diff).

---

## 7. Token Optimization & Context Management

### 7.1 State 0 (hydration) — precise protocol

1. Load `config.configKeys` from environment / platform secrets.
2. Emit **Phase Map**: cluster labels + one-line descriptions + state counts —
   no tool schemas, no system prompts. Target ≤ 400 tokens.
3. Transition immediately; LLM sees the phase map only when an AI state is reached.

### 7.2 System Function checkpoint boundary

```
ENTER SystemFunction(state=SF1)
  1. DEHYDRATE: serialize ctx.history for finished clusters → store.put(cp_xxx)
  2. MASK SWAP:  unload finished cluster tool schemas from the tool registry
                 load next cluster's tool schemas + state definitions
  3. HYDRATE:    ctx.history = [ summary(cp_xxx), phaseMap, nextClusterSchemas ]
  4. RESUME:     transition on ::SYSTEM.HYDRATE
```

- **Summary strategies:** `template` (deterministic truncation: first/last N messages +
  extracted vars — zero cost) or `llm` (cheap model, hard-capped at e.g. 500 output tokens).
- **Ledger invariant:** after every System Function, `tokens.prefill(next AI state)` is
  asserted ≤ budget in integration tests (golden fixtures, see §12.3).
- Checkpoint store keys: `run:{runId}:cp:{checkpointId}` with TTL = run retention (default 24h).

### 7.3 Token accounting

- Counting: `tiktoken` (cl100k/o200k) for OpenAI-compatible; Anthropic usage fields preferred
  (billed truth) with tokenizer fallback.
- Every `RunEvent` stores `tokensIn/tokensOut`; per-state aggregates power the canvas
  cost heatmap (enhancement E3).

---

## 8. gRPC Bridge & Multi-Language Tool Runtime

### 8.1 Proto contract (v1)

```proto
syntax = "proto3";
package harness.tools.v1;

service ToolService {
  rpc Execute(ToolRequest) returns (ToolResponse);
  rpc ExecuteStream(ToolRequest) returns (stream ToolEvent);  // logs + progress
  rpc Describe(Empty) returns (ToolDescriptor);               // self-description
  rpc Health(Empty) returns (HealthStatus);
}

message ToolRequest {
  string tool_name = 1;
  string run_id = 2;
  string state_id = 3;
  map<string, string> args = 4;          // serialized primitives
  google.protobuf.Struct payload = 5;    // structured input
  int64 timeout_ms = 6;
}
message ToolResponse {
  int32 exit_code = 1;
  string signal = 2;                     // "::SCRIPT.NEXT|message=\"...\""
  google.protobuf.Struct result = 3;
  string stderr = 4;
}
```

Rules: proto changes go through **buf lint + buf breaking** in CI; `main` is the
breaking-change baseline.

### 8.2 Language runtimes

| Language | Server | Packaging |
|----------|--------|-----------|
| Python | `grpcio` server, tool = module with `run(args, payload)` | `tools-python` image, user scripts volume-copied at export |
| C++ | gRPC C++ server, tools compiled to one binary w/ registry map | multi-stage build image (heaviest — see spike P1) |
| Bash | **single Python shim** `bash-shim` that `subprocess.exec`s the script and maps stdout conventions to signals | tiny image; script contract documented (exit 0 + last-line signal) |

### 8.3 Bridge (Node side)

- Channel pool per tool container; lazy connect; `Describe` on handshake to build the
  runtime tool registry (names must match FSM DSL `tool.name` — validated at harness boot).
- `ExecuteStream` forwards tool logs to the run monitor UI over SSE/WebSocket.

### 8.4 Why the Bash shim (decision D6)

Bash has no viable gRPC server story. One Python shim (~100 LOC) executes
`bash /tools/<name>.sh`, captures stdout/stderr/exit code, and synthesizes the
`ToolResponse`. Contract: **the last stdout line must be the signal**; everything else is log.

---

## 9. BYOK Gateway

### 9.1 Flow

```
user enters { baseUrl, apiKey }  ──►  POST /api/credentials/validate
   ──► gateway.discoverModels(): GET {baseUrl}/v1/models (OpenAI-compatible)
       or Anthropic /v1/models
   ──► return normalized [{ id, provider, contextWindow, supportsTools }]
   ──► UI dropdown populates; credential stored AES-256-GCM encrypted
```

### 9.2 Adapter interface

```ts
interface ProviderAdapter {
  discoverModels(cred: Credential): Promise<ModelInfo[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;        // normalized usage fields
  countTokens?(req: ChatRequest): Promise<number>;      // optional, else tiktoken fallback
}
// v1 adapters: openai, openai-compatible (proxies: LiteLLM, OpenRouter, local), anthropic
```

### 9.3 Requirements

- Never log raw keys; redact in all RunEvents (see §14).
- Normalized errors: `RATE_LIMITED | AUTH | CONTEXT_LENGTH | UNKNOWN` → engine guardrails.
- Per-run + per-state token/cost ledger persisted for the audit loop (§6.5).

---

## 10. Frontend Design

### 10.1 App Router map

```
/                           → landing: templates bento (Workflow · Memory · Calendar · Notifications) + project table
/project/[id]               → project dashboard: bento setup grid (Canvas · Runs · Export · Memory)
/project/[id]/canvas        → canvas (React Flow) + inspector + copilot + Describe panel
/project/[id]/runs          → run history & live monitor
/project/[id]/export        → export wizard (language, store, target)
/memory                     → memory graph view (§5.3) with add-node / add-edge forms
/settings/credentials       → BYOK management
```

### 10.2 Canvas (per draft §5.1) — implementation notes

- Custom node `StickyNoteNode` (pastel sticky note, washi tape, hand-written label,
  slight tilt that straightens on hover, dashed pencil selection outline).
- Custom edges with **directional arrow markers** (`MarkerType.ArrowClosed`) drawn as
  pencil strokes: `ScriptEdge` (bold solid) / `AIEdge` (dashed) / `SystemEdge` (dotted)
  / `SpawnEdge` (dash-dot); every edge carries a traveling beam dot (`animateMotion`)
  seeded per edge so beams desync.
- Clicking an edge opens the **edge inspector**: swap among §6.1 signal presets,
  enter custom `::MYAPP.*` signals (Q5), or delete the wire — style follows the
  signal namespace automatically. A toolbar "new wires" picker pre-selects the
  signal for the next connections.
- Live runs: `AnimatedBeam` driven by run events over SSE — the canvas doubles as the run monitor.
- Zustand stores: `useCanvasStore` (nodes/edges/selection), `useRunStore` (live events),
  `useCredentialStore`. React Flow state is the source of truth; FSM DSL is derived
  via a pure `canvasToDsl()` function (unit-testable, no DOM).

### 10.3 Inspector (Bento Grid, per draft §5.2)

Card 1 script editor (CodeMirror 6, C++/Python/Bash modes, `BorderBeam`) with a
**custom script template library**: built-in skeletons per language plus user-saved
templates (save current script, load into any SCRIPT node, delete custom ones —
client-persisted now, `ScriptTemplate` table + team sharing is Q30). Card 2 generative
config (model dropdown fed by BYOK discovery, temperature, max tokens, output schema
editor), Card 3 guardrails (timeout, retries, JSON schema, `Meteors` effect on error
state).

### 10.4 AI Copilot mode

- Chat panel (`AnimatedList`); the copilot LLM gets **tool definitions**:
  `add_node`, `connect`, `configure_state`, `set_guardrail`, `remove_node`, `layout`.
- Each tool call is validated by `fsm-schema` Zod before applying to the canvas store;
  invalid ops are rejected back to the model with the validation error (self-correction loop).
- Copilot uses the **user's BYOK credential** (see Q22 — alternative: platform key).
- Every copilot mutation is one undo step (command pattern in the canvas store).

---

## 11. Export / Compilation Engine

### 11.1 Bundle contents

```
harness-<name>-v<semver>/
├── fsm.json                  # validated DSL
├── docker-compose.yml        # controller + tools + store + gateway
├── Dockerfile.controller
├── Dockerfile.tools-<lang>
├── proto/                    # copied from packages/proto
├── tools/                    # user tool sources, per state
├── .env.example              # BYOK base URL/key, store URL
└── README.md                 # run instructions
```

### 11.2 Pipeline

`validate(DSL) → resolve tool sources → render templates (ETA) → write tree →
(zip | git init+commit+push) → record ExportJob`

- Git target: user supplies repo URL + deploy key / PAT (see Q24 auth model).
- Determinism: same DSL version → byte-identical `fsm.json` (sorted keys) for diffability.

---

## 12. Testing Strategy (Vitest + Playwright)

> **Goal:** the FSM engine is the correctness-critical core — it gets the deepest
> coverage. The UI gets component + E2E coverage of authoring and run-monitoring flows.
> Everything below is designed to be copy-paste actionable in Phase 1.

### 12.1 Test pyramid

| Layer | Tool | Scope | Target coverage |
|-------|------|-------|-----------------|
| Unit | **Vitest** | signal parser, transition table, guardrails, token ledger, `canvasToDsl`, BYOK adapters, export renderer | **≥ 85% lines** on `fsm-engine`, ≥ 70% elsewhere |
| Component | Vitest + **@testing-library/react** (jsdom) | inspector cards, credential form, copilot op validation | critical components |
| Contract | Vitest + buf fixtures | proto golden messages, `ToolResponse` signal conformance per language shim | all messages |
| Integration | Vitest (+ **testcontainers** for Redis/store) | engine run loop end-to-end with mocked LLM + real shim; checkpoint dehydrate/hydrate; subagent aggregation | all state types |
| E2E | **Playwright** | authoring→save→reload, BYOK validation, copilot applies ops, export job, live-run beam animation | core flows |
| Static | ESLint, `tsc --noEmit`, `buf lint`, Drizzle schema check (`drizzle-kit check`), architecture boundary check | whole repo | blocking |

### 12.2 Directory layout & config

```
packages/fsm-engine/
  src/__tests__/unit/           # parser.test.ts, transitions.test.ts, guardrails.test.ts ...
  test/fixtures/fsm/            # *.fsm.json golden definitions
  test/fixtures/signals/        # valid.txt, malformed.txt (parser corpus)
  test/fixtures/traces/         # expected event sequences per fixture run
  test/integration/             # run-loop.int.test.ts (testcontainers redis)

apps/web/src/__tests__/         # component tests next to components

e2e/
  playwright.config.ts
  tests/authoring.spec.ts
  tests/credentials.spec.ts
  tests/copilot.spec.ts
  tests/export.spec.ts
  tests/run-monitor.spec.ts
```

`vitest.config.ts` (root, workspace mode):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/web"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        "packages/fsm-engine/**": { lines: 85, functions: 85, branches: 80 },
        "**": { lines: 70 },
      },
    },
    env: { MOCK_LLM: "1" },
  },
});
```

`e2e/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter web dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

### 12.3 Key test designs (the non-obvious ones)

1. **Mock LLM server** (`packages/byok-gateway/test/mock-llm.ts`): a 50-line HTTP server
   implementing `/v1/models` + `/v1/chat/completions` with scripted responses and
   deterministic `usage` fields. Used by unit, integration, **and** Playwright (via env
   `BYOK_BASE_URL=http://localhost:4010`) — no real API keys in any test tier.
2. **Golden trace tests:** each fixture FSM runs against mock tools + mock LLM; the
   emitted `RunEvent` sequence is diffed against `test/fixtures/traces/*.json`.
   Catches transition-table regressions precisely.
3. **Token-budget invariant test:** integration test asserts prefill tokens at the AI
   state after a System Function ≤ configured budget (protects goal G2).
4. **Bash/Python/C++ shim conformance:** one shared Vitest suite runs the same
   `ToolRequest` against each language runtime (containers via testcontainers) and
   asserts identical `signal` parsing — this is the contract that keeps languages honest.
5. **Playwright copilot test:** seed the mock LLM with a fixed tool-call transcript →
   assert canvas ends with exact node/edge topology (deterministic E2E despite LLM).
6. **FSM lint tests** (see enhancement E4): unreachable-state and missing-error-edge
   fixtures must produce exact diagnostics.

### 12.4 Scripts (root `package.json`)

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:int": "vitest run --project '*:integration'",
    "test:e2e": "playwright test -c e2e/playwright.config.ts",
    "test:e2e:install": "playwright install --with-deps chromium",
    "lint": "eslint . && prettier --check .",
    "typecheck": "tsc --noEmit -b",
    "proto:check": "buf lint && buf breaking --against '.git#branch=main'"
  }
}
```

---

## 13. CI/CD Pipeline

### 13.1 Design

- **Platform:** GitHub Actions. Triggers: PRs to `master`, pushes to `master`.
- **Concurrency:** cancel-in-progress per branch.
- **Caching:** pnpm store, Turborepo, Playwright browsers, buf modules.
- **Branch protection (target):** require `lint`, `typecheck`, `unit`, `integration`,
  `e2e`, `build` green; linear history on `master`.

### 13.2 Pipeline YAML (drop-in for `.github/workflows/ci.yml` at Phase 1 scaffold)

```yaml
name: ci

on:
  pull_request:
    branches: [master]
  push:
    branches: [master]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  PNPM_VERSION: 9

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      pnpm-cache-key: ${{ steps.keys.outputs.pnpm }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - id: keys
        run: echo "pnpm=${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}" >> "$GITHUB_OUTPUT"

  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  proto:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-action@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      # runs buf lint + buf breaking against master

  unit:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:coverage
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }

  integration:
    needs: setup
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ["6379:6379"]
        options: --health-cmd "redis-cli ping" --health-interval 5s
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build --filter './packages/*'
      - run: pnpm test:int
        env:
          CHECKPOINT_STORE_URL: redis://localhost:6379
          MOCK_LLM: "1"

  e2e:
    needs: [unit]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('e2e/package.json', 'pnpm-lock.yaml') }}
      - run: pnpm test:e2e:install
      - run: pnpm test:e2e
        env:
          BYOK_BASE_URL: http://localhost:4010   # mock LLM, started by global setup
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: e2e/playwright-report/ }

  build:
    needs: [lint, unit]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

  docker:
    needs: [build]
    if: github.ref == 'refs/heads/master'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build harness base images (smoke)
        run: |
          docker build -t harness-controller:test -f harness-templates/Dockerfile.controller .
          docker build -t harness-tools-python:test -f harness-templates/Dockerfile.tools-python .

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm audit --prod --audit-level=high || true   # report-only in v1
```

### 13.3 Later additions

- **Changesets** for package versioning; publish `fsm-engine` to npm when public.
- **CodeQL** + dependency review action once repo is public.
- **Deploy job** (Vercel or self-hosted) gated on `master` green.

---

## 14. Security & Secrets

| Concern | Design |
|---------|--------|
| BYOK keys at rest | AES-256-GCM; key from `PLATFORM_SECRET` env (KMS later — Q15) |
| Keys in logs | redaction filter on all RunEvent serialization |
| Tool sandboxing | per-language container, no host mounts, CPU/mem limits in compose, no network egress except allowlist (Q19) |
| Exported harness secrets | `.env` never committed; `.env.example` only; git-target auth via deploy keys |
| Web input | all DSL edits Zod-validated; Drizzle parameterized queries (Turso/libSQL) |
| Supply chain | `pnpm audit` in CI; lockfile frozen; Dependabot on |

---

## 15. Observability

- **Platform:** structured JSON logs (pino), request IDs propagated to run events.
- **Harness:** OpenTelemetry SDK in the controller (spans per state execution, gRPC calls,
  LLM calls); OTLP exporter optional at export time (enhancement E6).
- **Metrics:** tokens/state, state latency p50/p95, gRPC round-trip, checkpoint sizes.
- **UI:** run monitor streams `RunEvent`s; canvas beam animation = live trace view.

---

## 16. Refined Implementation Roadmap

| Phase | Scope (draft §6 refined) | Exit criteria (testable) | Status |
|-------|--------------------------|--------------------------|--------|
| **0. Scaffold & de-risk** | Monorepo + Vitest/Playwright harness; CI landing separately | Scaffold green; spikes deferred | **Done** (monorepo `apps/web` + `packages/fsm-engine`; CI in hygiene PR) |
| **1. Canvas foundation** | Next.js, React Flow, custom nodes/edges, Zustand, Magic UI bg | Component tests green; E2E: add node → connect → reload persists | **Done** (Feature 001 C1–C7) |
| **2. Inspector + persistence** | Bento inspector, Turso/libSQL via Drizzle ORM, canvas↔DSL | DSL round-trip unit tests; E2E save/reload | **Done** (canvas + inspector + Drizzle/Turso on `apps/web`) |
| **3. Engine + gRPC + BYOK** | Signal parser, run loop, gRPC bridge + Python shim, model discovery | Golden traces; contract suite; discovery E2E | **Partial** — `packages/fsm-engine` + in-app run loop + BYOK discovery UI; **live LLM/HTTP executors, gRPC shims, `byok-gateway` package still future** (see FeatureShipping 003/005/010) |
| **4. Token optimization + subagents** | State 0, System Functions, SPAWN/AGGREGATE, memory-graph hydration | Token-budget + subagent tests; memory in State-0 map | **Partial** — SPAWN/AGGREGATE + SYS_FUNC on canvas (001); **runtime hydration/checkpoints/ledger not shipped** (011); memory code-index (002) not shipped |
| **5. Copilot + export** | Copilot tool-calling loop, export pipeline (ZIP/git) | Copilot E2E; exported harness smoke | **Not started** — copilot is keyword-stub (012); `packages/export-engine` / harness export still future (004) |

**Missing packages (future, not scaffolded yet):** `packages/byok-gateway` (003),
`packages/proto` + `packages/grpc-bridge` + `runtimes/tools-*` (010),
`packages/export-engine` + `harness-templates/` (004), `packages/fsm-schema` (012).

### 16.1 Completion plan (v1)

Phases 3–5 above are decomposed into eleven FeatureShipping docs, all **Detailed**.
Sequencing lives in
[FeatureShipping/000-completion-roadmap.md](FeatureShipping/000-completion-roadmap.md):
§3 waves are merge-gates; **§8 parallel lanes** are how work actually ships
(schema bootstrap SB0, then four concurrent `ship-feature` sessions).

| Wave | Docs | Gate to exit |
|------|------|--------------|
| 0 — Foundation | 009 canvas persistence, 005 credential security, 006 CI | Server is the source of truth; no plaintext keys; CI gates lint + unit + E2E |
| 1 — Live runtime | 003 live executors, 011 token + observability, 008 notifications | A real AI + HTTP workflow runs, streams, records tokens, and notifies |
| 2 — Determinism | 010 tool runtime (gRPC) | `SCRIPT` executes sandboxed Python/Bash tools |
| 3 — Distribution | 004 harness export | An exported bundle boots via `docker compose up` and completes a fixture run |
| 4 — Product shell | 007 calendar, 012 copilot | No `Soon` tiles; copilot edits via validated ops |
| Parallel | 002 memory + code index | No wave depends on it |

Decisions locked while detailing (see the roadmap's table for the full list):
**Q1** server actions + REST, no tRPC · **Q2** single-user v1 · **Q3** content hash ·
**Q10** human-in-the-loop in v1 · **Q11** `template` summaries by default ·
**Q12** budget `halt` by default · **Q14** OpenAI / OpenAI-compatible / Anthropic ·
**Q15** `PLATFORM_SECRET` + AES-256-GCM · **Q19** default-deny tool egress ·
**Q21** autosave draft + explicit publish · **Q23** no K8s in v1 · **Q24** PAT git auth ·
**Q29** opt-in `memory.json` in exports. Still open: **Q4**, **Q17**, **Q28**, **Q30**.

---

## 17. Next Steps to Fully Understand This Project

Ordered, each with a concrete deliverable. Phase 0 gates Phase 1.

| # | Step | Deliverable | De-risks |
|---|------|-------------|----------|
| P0 | **Close open questions §18** (30–45 min review) | Updated doc with decisions recorded | Scope churn mid-build |
| P1 | **Spike: Node ↔ Python gRPC round trip** with the §8.1 proto via buf codegen | `spikes/grpc-hello/` + latency numbers | gRPC toolchain pain; D5/D6 validation |
| P2 | **Spike: C++ gRPC build in Docker** (multi-stage, minimal image) | working `Dockerfile.tools-cpp` + image size | Heaviest build risk in the project |
| P3 | **Spike: React Flow at scale** — 300 nodes, custom node/edge, beam animation | FPS measurement + memoization pattern | Canvas perf on large FSMs |
| P4 | **Spike: BYOK discovery** against OpenAI, one OpenAI-compatible proxy, Anthropic | adapter PoC + normalized model list | §9 assumptions; proxy quirks |
| P5 | **Spike: token counting accuracy** — tiktoken estimates vs billed usage across 20 calls | counting methodology note in §7.3 | Budget-ledger correctness |
| P6 | **Scaffold monorepo** per §4 with Vitest + Playwright + CI from §12–13 | green CI on `chore: scaffold` commit | Test/CI design validation |
| P7 | **Write 3 golden FSM fixtures** (linear, clustered w/ System Function, subagent fan-out) | `test/fixtures/fsm/*.json` + expected traces | Pins DSL semantics before UI exists |
| P8 | **Magic UI license check** (free vs Pro components used in draft §5) | license note in README | Legal/distribution |
| P9 | **Draft the copilot tool schema** (`add_node`, `connect`, …) as Zod | `packages/fsm-schema/src/copilot-ops.ts` | Copilot determinism (E2E test 12.3.5) |
| P10 | **Decide harness store default + auth model for git export** | ADR-0001, ADR-0002 in `docs/adr/` | Export pipeline scope |

---

## 18. Open Questions

Grouped; each tagged with where it blocks.

### Product & scope
- **Q1.** Platform API: tRPC (proposed) or REST/OpenAPI? Affects external automation
  possibilities. *Blocks: Phase 2.*
- **Q2.** Single-user local tool first, or accounts/teams from day one? *Blocks: schema, Phase 2.*
- **Q3.** Harness versioning: semver per export + git tags, or immutable content-hash only?
- **Q4.** Meta-cognitive rewrites: proposals-only (proposed) or auto-apply under a
  confidence threshold? Auto-apply needs a rollback UX. *Blocks: §6.5.*

### Platform & database (Turso)
- **Q26.** Turso deployment model: local embedded mode (`turso dev`) for dev, remote
  Turso DB in production — confirm. Need to decide on DB location strategy (embedded
  in the Next.js process vs. sidecar Turso CLI process vs. remote HTTP-only).
  *Blocks: Phase 2 (DB setup).*
- **Q27.** Migration strategy: Drizzle Kit push during dev, committed SQL migrations
  in CI. Confirm no need for a separate seed/fixture mechanism beyond Drizzle's
  built-in `drizzle-kit seed`? *Blocks: Phase 2 (CI pipeline).*
- **Q28.** Turso business tier / scaling: the free tier ([libsql] 500 DBs, 9 GB
  total storage) should cover dev + early users. When is the paid tier trigger?
  *Info needed for: §3.1 (component sizing).*
- **Q29.** Memory layer scope: are memory graphs per-project only, or is there a
  global/shared org memory? Should exported harnesses receive a memory snapshot
  (`memory.json`) or stay memory-less? *Blocks: §5.3 export story.*
- **Q30.** Script template library: client-local (current) or a `ScriptTemplate`
  table with per-project/team sharing and versioning? Should templates be part of
  the exported harness bundle? *Blocks: §11 export story.*

### FSM engine
- **Q5.** Custom user signals (`::MYAPP.*`) — allowed? Namespacing/collision rules?
- **Q6.** Subagent aggregation: is `waitAll | quorum(k) | firstSuccess` the right v1 set?
  Partial-result merge semantics on timeout?
- **Q7.** Cycles: are loops first-class (with max-iteration guard) or rejected at author time?
- **Q8.** Default error routing when a state has no explicit error transition:
  global `ERR` state, or halt with checkpoint?
- **Q9.** AI output validation failure: one retry-with-correction, then fallback state or halt?
- **Q10.** Human-in-the-loop states (pause for approval) — v1 or later?

### Token optimization
- **Q11.** Hydration summary default: `template` (free, lossy) or `llm` (costs, better)?
- **Q12.** Budget enforcement `onExceed`: halt, degrade model, or notify-and-continue?
- **Q13.** Checkpoint retention/TTL defaults per store (Redis proposed 24h)?

### BYOK & providers
- **Q14.** Launch providers: OpenAI + OpenAI-compatible + Anthropic — confirm; Ollama/local in scope (E5)?
- **Q15.** Key management: `PLATFORM_SECRET` env now; KMS/Vault ever?
- **Q16.** Per-key cost tracking + spend caps — v1 or enhancement?

### Tools & gRPC
- **Q17.** One tool language per harness (draft) — is mixing ever needed? (Drives compose topology.)
- **Q18.** C++ toolchain on dev machines: container-only builds (proposed) or local MinGW too?
- **Q19.** Tool container egress policy: default-deny with allowlist, or open in v1?

### Frontend
- **Q20.** Copilot determinism: temperature 0 + op validation is proposed — acceptable UX for retries?
- **Q21.** Autosave (debounced) vs explicit save for canvas edits?
- **Q22.** Copilot powered by user's BYOK key (proposed) — any platform-provided fallback?

### Export & ops
- **Q23.** Export targets beyond ZIP/git: K8s manifests/Helm (minikube-friendly) — v2?
- **Q24.** Git export auth: user PAT, deploy keys, or GitHub App?
- **Q25.** Where do harness run logs live long-term — store TTL only, or exportable archives?

---

## 19. Proposed Enhancements (Beyond Draft Scope)

| # | Enhancement | Why it fits |
|---|-------------|-------------|
| E1 | **Run replay / time-travel debugging** — rehydrate any checkpoint and step forward | Dehydration design makes this nearly free; killer debugging feature |
| E2 | **Dry-run / simulation mode** — run harness against mock LLM + mock tools | Already built for tests (§12.3.1); expose as a product feature |
| E3 | **Token cost heatmap on canvas** — per-state cost overlay from RunEvents | Ledger already collects the data |
| E4 | **FSM linter** — unreachable states, dead ends, missing error edges, cycle warnings, budget sanity | Zod + graph walk; runs in UI and CI |
| E5 | **Ollama / local-model provider adapter** | BYOK gateway is already adapter-based; popular with target users |
| E6 | **OpenTelemetry in exported harnesses** | Controller already emits spans; add OTLP env config to templates |
| E7 | **Harness template gallery** — starter FSMs (web scrape+summarize, ETL, code review) | Seeds P7 fixtures double as gallery content |
| E8 | **MCP tool support** — let MCP servers act as tool providers alongside gRPC | Same "tool registry" abstraction; future-proofs the bridge |
| E9 | **Code-first authoring SDK** — define FSMs in TS, import to canvas | DSL is JSON; an SDK is a thin typed emitter |
| E10 | **Scheduled & webhook triggers for harness runs** | Compose add-on container (cron / HTTP listener) |
| E11 | **Canvas visual diff between FSM versions** | Immutable versions exist; diff = graph diff |
| E12 | **Multiplayer canvas (Yjs)** | Only if Q2 lands on multi-user; large effort, park it |

---

## 20. Appendix

### 20.1 Sample signal trace (linear fixture)

```
S0  START   → ::SCRIPT.NEXT
S1  SCRIPT  fetch_pages      → ::SCRIPT.NEXT|message="pages=12"
S2  AI      summarize_pages  → ::AI.NEXT
S3  SCRIPT  write_report     → ::SCRIPT.NEXT|message="path=/out/report.md"
END
```

### 20.2 Risk register (top 5)

| Risk | Impact | Mitigation |
|------|--------|-----------|
| C++ gRPC build complexity (image size, build time) | Phase 3 slip | Spike P2 first; fall back to "C++ via shim" like Bash |
| Magic UI Pro license restrictions | UI rework | P8 license audit before Phase 1 |
| Context-window accounting drift (estimates vs billed) | Budget guardrails wrong | P5 methodology + always record billed usage post-call |
| Copilot non-determinism corrupts canvas | User trust | Zod-gated ops + undo command stack + temperature 0 |
| Testcontainers on Windows dev machines flaky | Integration test pain | Docker Desktop check in P6; CI (Linux) is source of truth |

### 20.3 References

- Draft: `docs/InitialDraftPlan.md`
- React Flow: https://reactflow.dev · Magic UI: https://magicui.design
- buf: https://buf.build · nice-grpc: https://github.com/deeplay-io/nice-grpc
- Vitest: https://vitest.dev · Playwright: https://playwright.dev
