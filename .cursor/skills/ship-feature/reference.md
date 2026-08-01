# ship-feature reference

## Model routing

| Stage | Skill | Model |
|-------|-------|-------|
| Detail the FeatureShipping doc | `detail-feature` | High-end |
| Implement a phase | `ship-feature` | **Composer or Grok** |
| Test + push | `test-feature` | **Composer or Grok** |

## FeatureShipping doc template

```markdown
# NNN — Title

> Status: **Detailed**
> Relates to: DETAILED_DESIGN_PLAN.md §…
> Code today: paths…

## 1. Problem
## 2. Goals & non-goals
## 3. Proposed model
## 4. UI implications
## 5. File / API change map
## 6. Edge cases & failure modes
## 7. Open questions
## 8. Suggested implementation phases
## 9. Acceptance criteria
```

## Branch naming

| Pattern | Example |
|---------|---------|
| `cursor/<short-feature-slug>` | `cursor/canvas-tool-chaining` |
| Prefer phase id in slug when useful | `cursor/memory-m1-code-symbols` |

## Related skills

- Before coding: **detail-feature** (high-end) if doc is not Detailed.
- After implementation: **test-feature** (Composer/Grok).
