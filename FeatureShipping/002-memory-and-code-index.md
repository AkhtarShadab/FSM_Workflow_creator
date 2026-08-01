# 002 — Memory & Code Index

> Status: **Detailed**  
> Relates to: [DETAILED_DESIGN_PLAN.md](../DETAILED_DESIGN_PLAN.md) §5.3  
> Code today: [`apps/web/src/db/schema.ts`](../apps/web/src/db/schema.ts) (`memory_nodes` / `memory_edges`), [`apps/web/src/components/memory/memory-view.tsx`](../apps/web/src/components/memory/memory-view.tsx)  
> Implement with: **ship-feature** on Composer/Grok · Detail updates: **detail-feature** on high-end models

---

## 1. Problem

Current memory is a **graph of small records in Turso** (facts, artifacts, preferences, checkpoint refs). That fits long-term harness knowledge, but not **code-intensive projects** (e.g. a LAN codebase that may exceed 50GB):

- Storing full file blobs in SQLite is not viable.
- AI states need a way to **traverse code** by meaning without dumping the repo into context.
- The Memory UI is only a sticky-note React Flow graph — fine for facts, poor for millions of symbols.

Calendar and Notifications remain out of scope.

---

## 2. Goals & non-goals

### Goals

- Split memory into **Graph memory** (existing) and **Code index memory** (new).
- Index symbols with three fields per function (and analogous for classes/types):
  1. **Intent** — what the symbol does (short natural-language summary)
  2. **Identity** — signature / params / return (stable identity string)
  3. **File location** — path + optional start/end line
- Support incremental indexing and AI retrieval that never loads 50GB into the LLM.
- Specify a **two-mode Memory studio** UI (Graph + Code Index).

### Non-goals

- Embedding the entire file contents in Turso.
- Calendar / Notifications.
- Replacing the checkpoint store (Redis/etc.) — checkpoints stay ephemeral.

---

## 3. Proposed model

### 3.1 Two memory layers

| Layer | Storage | Unit | Writers | Readers |
|-------|---------|------|---------|---------|
| **Graph memory** | Turso `memory_nodes` / `memory_edges` | fact / artifact / preference / checkpoint_ref | UI, SYS_FUNC summaries, audit | State 0 phase map, AI hydration |
| **Code index** | Symbol table (Turso or sidecar SQLite) + optional embedding/chunk store on disk | `CodeSymbol` | Indexer job | AI tools (`memory.search_code`), VALIDATE helpers |

Large blobs (raw files, embeddings) live **outside** the platform DB (workspace disk / object store). DB holds metadata + pointers only.

### 3.2 Code symbol record (B1)

```ts
interface CodeSymbol {
  id: string;
  projectId: number;
  kind: "function" | "class" | "method" | "type" | "module";
  intent: string;           // (i) natural-language purpose
  identity: string;         // (ii) e.g. "connect(host: str, port: int) -> Socket"
  filePath: string;         // (iii) repo-relative path
  startLine?: number;
  endLine?: number;
  language?: string;
  hash: string;             // content hash for staleness
  embeddingRef?: string;    // optional vector id / file offset
  chunkRef?: string;        // optional body snippet pointer (not full file)
  indexedAt: string;        // ISO
}
```

### 3.3 Indexing pipeline

1. Author opts in per project: root path(s), ignore globs (`node_modules`, `.git`, build dirs, binaries).
2. Walker enumerates source files by language allowlist.
3. Extractor (tree-sitter / language parsers) emits candidate symbols.
4. Intent writer: deterministic stub from docstring/name, optional cheap LLM batch for intent enrichment (BYOK, budget-capped).
5. Upsert by `(projectId, filePath, identity)` using `hash` for incremental skip.
6. On file change: re-index that file only; mark deleted symbols stale/removed.

Never index binary blobs or files over a size threshold (configurable; default e.g. 1MB text).

### 3.4 AI traversal

AI / SCRIPT tools request retrieval, not raw trees:

- `search_by_intent(query, k)`
- `search_by_path(prefix)`
- `lookup_identity(identityOrPartial)`
- `expand_neighbors(symbolId)` (same-file / import graph later)

Returned payloads are **symbol cards** (intent + identity + location ± small chunk). The model then requests specific files via SCRIPT/HTTP only when needed.

State 0 may include a **code-index TOC** (top packages + symbol counts), not the full index.

### 3.5 Schema delta (illustrative)

```sql
-- platform DB (metadata only)
CREATE TABLE code_symbols (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  intent TEXT NOT NULL,
  identity TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  language TEXT,
  hash TEXT NOT NULL,
  embedding_ref TEXT,
  chunk_ref TEXT,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX code_symbols_project_path ON code_symbols(project_id, file_path);
CREATE INDEX code_symbols_project_identity ON code_symbols(project_id, identity);
```

Embeddings: separate store or `embedding_ref` into a local vector index under `.fsm-index/`.

---

## 4. UI proposal — Memory studio (B2)

Replace “graph-only” as the sole UX with a **two-mode** studio at `/memory` (and project-scoped `/project/[id]/memory` when wired).

### Mode switch

Top-level tabs: **Graph** | **Code Index**

### Graph mode (keep)

- Current sticky-note React Flow for facts / preferences / artifacts / checkpoint_refs ([`memory-view.tsx`](../apps/web/src/components/memory/memory-view.tsx)).
- Add/edge forms remain; improve filters by kind.

### Code Index mode (primary for large repos)

```
┌─────────────────────────────────────────────────────────────┐
│ Search…          [kind ▾] [path ▾] [stale only]  [Re-index] │
├──────────┬────────────────────────────┬─────────────────────┤
│ File     │ Symbol list                │ Detail              │
│ tree /   │ intent · identity          │ Intent              │
│ packages │ path:line                  │ Identity (params)   │
│          │                            │ Location            │
│          │                            │ Refs / chunk preview│
├──────────┴────────────────────────────┴─────────────────────┤
│ Indexed: 184k symbols · 12.4k files · last run 2m ago · 94% │
└─────────────────────────────────────────────────────────────┘
```

- **Left:** package / folder navigator (virtualized).
- **Center:** searchable symbol list (virtualized); columns intent + identity + path.
- **Right:** detail pane for the three required fields + hash/stale badge.
- **Top:** search + filters; **Start index** / **Re-index** actions.
- **Status bar:** symbol count, file count, last indexed, coverage %.

### Empty / onboarding

1. Empty Code Index → wizard: select root path(s), ignore globs, language allowlist, optional “enrich intents with BYOK”.
2. Progress stream for first index (file N of M).
3. Link from project bento “Memory” into studio with project filter applied.

### Visual direction

- Do **not** reuse sticky notes for symbols (too dense).
- Use a dense IDE-like layout (tree + list + detail) that matches coding workflows.
- Graph mode keeps the existing hand-drawn sticky language for soft knowledge.

---

## 5. File / API change map

| Phase | Touch | Change |
|-------|-------|--------|
| M1 | `apps/web/src/db/schema.ts` | Add `codeSymbols` table + types |
| M1 | `apps/web/src/db/migrations/*` | Drizzle generate/migrate |
| M1 | `apps/web/src/app/memory/actions.ts` (or `code-index/actions.ts`) | `upsertSymbols`, `searchByIntent`, `searchByPath`, `lookupIdentity`, `getIndexStats` |
| M2 | `apps/web/src/components/memory/memory-view.tsx` | Shell with Graph / Code Index tabs; Graph embeds current view |
| M2 | `apps/web/src/components/memory/code-index-view.tsx` (new) | Tree + list + detail + status bar (empty/mock data OK) |
| M2 | `apps/web/src/app/memory/page.tsx` | Pass project filter; tab routing via query `?mode=index` |
| M3 | `apps/web/src/lib/code-index/` (new) | Walker, ignore globs, TS extractor, hash, upsert batch |
| M3 | Code Index UI | Start index wizard + progress |
| M4 | Enrichment job module | Optional BYOK intent rewrite; stale-by-hash |
| M5 | Engine/tool adapters later | `memory.search_code` tool; State 0 TOC snippet |
| M6 | Virtualization | Large list perf; Playwright fixture repo |

**Locked defaults:**

- First extractor language: **TypeScript/TSX**.
- Max file size indexed as text: **1 MiB**.
- Default ignore: `node_modules`, `.git`, `.next`, `dist`, `build`, `*.min.js`, binaries.
- Intent without LLM: docstring or name-derived; enrichment opt-in.
- Symbol table in **same Turso/libSQL** for M1; embeddings deferred (`embedding_ref` nullable).

---

## 6. Edge cases & failure modes

| Case | Expected behavior |
|------|-------------------|
| Root path missing / unreadable | Wizard error; no partial corrupt index write |
| File > 1 MiB | Skip + count in `skippedLarge` stats |
| Binary / null bytes | Skip |
| Re-index same hash | No-op upsert |
| File deleted | Remove symbols for that path |
| Concurrent re-index | Single-flight lock per project |
| Empty intent after extract | Fallback = `kind + identity` |
| Search with empty query | Recent symbols capped (e.g. 50) |
| 50GB tree | Stream indexer; virtualize UI |
| Project delete | Cascade delete `code_symbols` |

---

## 7. Open questions

1. Per-project sidecar SQLite vs Turso-only for huge indexes long-term?
2. Exported harness: frozen `code-index.json` vs re-index at run site?
3. Cross-project shared index for monorepos?

---

## 8. Suggested implementation phases

| Phase | Scope | Model lane |
|-------|--------|------------|
| M1 | Schema + search/CRUD actions | Composer/Grok via `ship-feature` |
| M2 | Memory studio tabs + Code Index shell | Composer/Grok |
| M3 | TS indexer MVP + wizard/progress | Composer/Grok |
| M4 | Intent enrichment + staleness | Composer/Grok |
| M5 | AI retrieval tools + State 0 TOC | Composer/Grok |
| M6 | Virtualization + E2E polish | Composer/Grok |

Detail/revise this doc with **detail-feature** (high-end) only.

---

## 9. Acceptance criteria

- [ ] Graph memory behavior unchanged for existing node kinds.
- [ ] Code symbol records persist intent, identity, file location; no full 50GB corpus in Turso.
- [ ] Incremental re-index updates only changed files (hash check).
- [ ] Memory UI offers Graph and Code Index modes; Code Index shows tree + list + detail.
- [ ] Search by intent substring and by path prefix returns expected symbols (Vitest).
- [ ] Playwright: open Memory → Code Index → run index on fixture repo → see ≥1 symbol with three fields.
- [ ] AI retrieval helper returns bounded card payloads (max k, max chars).
