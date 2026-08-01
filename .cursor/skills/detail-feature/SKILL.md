---
name: detail-feature
description: >-
  Expands a FeatureShipping stub into a detailed, implementation-ready design
  doc using a high-end model. Use when the user asks to detail, deepen, or
  fully specify a FeatureShipping feature before coding, or when ship-feature
  is blocked because the doc is not yet Detailed.
---

# Detail feature

Produce a **Detailed** FeatureShipping document. Prefer a **high-end model** (Claude Opus, GPT-5.x class, or the strongest model available in the session). Do not use this skill for product code — that is `ship-feature` (Composer/Grok).

## Instructions

1. **Confirm target**
   - Identify `FeatureShipping/NNN-*.md` (create from [FeatureShipping/README.md](../../../FeatureShipping/README.md) template if missing).
   - Read [DETAILED_DESIGN_PLAN.md](../../../DETAILED_DESIGN_PLAN.md) sections that the feature deltas against.
   - Skim related code paths listed in the stub so the detail is grounded.

2. **Expand to Detailed status**
   Rewrite/extend the doc so it includes all of:
   - Problem, goals & non-goals
   - Proposed model (DSL/types, runtime algorithms, mermaid where useful)
   - UI implications with concrete component paths
   - **File / API change map** (paths + what changes per phase)
   - **Edge cases & failure modes**
   - Open questions (only unresolved decisions)
   - Numbered **implementation phases** small enough for one Composer/Grok session each
   - **Acceptance criteria** checkboxes for Vitest + Playwright

3. **Quality bar**
   - An implementer should not need to invent schema fields or API shapes.
   - Prefer explicit TypeScript/JSON shapes and signal names.
   - Cross-link existing files; do not rewrite the whole platform plan.
   - Set doc status line to `> Status: **Detailed**`.

4. **Hand-off**
   - Do not create an implementation branch.
   - Summarize phases and recommend which phase to ship first with `ship-feature` on Composer/Grok.
   - Remind the user: implementation → `ship-feature`; tests → `test-feature`.

## Examples

- User: “Detail the workflow canvas feature with a high-end model” → expand `001-workflow-canvas.md` to Detailed; stop before coding.
- User: “Make memory/code-index ready to implement” → expand `002-memory-and-code-index.md` with schema, indexer API, UI file map.
