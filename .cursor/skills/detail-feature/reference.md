# detail-feature reference

## When to use which skill

| Need | Skill | Model |
|------|-------|-------|
| Full design depth | `detail-feature` | High-end |
| Code on `cursor/…` | `ship-feature` | Composer or Grok |
| Vitest + Playwright + push | `test-feature` | Composer or Grok |

## Status values

| Status | Meaning |
|--------|---------|
| Design | Stub / outline; not ready to code |
| Detailed | Implementation-ready; `ship-feature` allowed |
| In progress | A phase is being coded |
| Shipped | Acceptance criteria met for scoped phases |

## Minimum Detailed checklist

- [ ] File/API change map with real repo paths
- [ ] Types or JSON shapes for new fields
- [ ] Phases ≤ ~1 PR each
- [ ] Acceptance criteria testable by `test-feature`
- [ ] Edge cases listed (empty input, concurrency, missing credentials, etc.)
