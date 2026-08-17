# Lane subagents

Project-level agents that implement the parallel v1 plan in
[`FeatureShipping/000-completion-roadmap.md`](../../FeatureShipping/000-completion-roadmap.md) §8.

| Agent | Invoke when | First phase |
|-------|-------------|-------------|
| [schema-bootstrap](schema-bootstrap.md) | Completing the project, starting v1, schema/migrations | SB0 (must land first) |
| [lane-persistence](lane-persistence.md) | Canvas save/publish/versions/run history | 009 P1 |
| [lane-keys-ci](lane-keys-ci.md) | Credentials encryption, lint, GitHub Actions, Playwright CI | 005 S2 + 006 CI2a |
| [lane-greenfield](lane-greenfield.md) | New packages: proto, export-engine, fsm-schema, code-index | 010 G1 / 004 X1 / 012 CP1 / 002 M1 |
| [lane-runtime](lane-runtime.md) | Live runs, SSE, executors, token ledger, SCRIPT wiring | 003 E1 (after 005 S2) |
| [ship-dispatcher](ship-dispatcher.md) | "complete the project", pick next phases, fan out lanes | Reads §8.5 / §8.6 |

Parent agent: use **ship-dispatcher** first. It names the next one-phase jobs; spawn those lane agents in parallel. Do not implement all lanes in one conversation.

Skills each lane follows: [ship-feature](../skills/ship-feature/SKILL.md) then [test-feature](../skills/test-feature/SKILL.md). Composer or Grok. One phase per PR.
