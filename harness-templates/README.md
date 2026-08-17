# {{name}}

Standalone harness for `{{name}}` ({{version}}).

The controller runs the exported FSM with `@fsm/engine`. SCRIPT states
execute in the `tools-{{toolLanguage}}` service.

## Run

1. Copy `.env.example` to `.env` and fill the BYOK placeholders
   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PLATFORM_SECRET`).
   Do not commit real secrets.
2. `docker compose up --build`
3. The `controller` service loads `fsm.json` and executes it via `@fsm/engine`.
4. Tool files under `tools/` are mounted into `tools-{{toolLanguage}}`.

## Layout

- `manifest.json` — name, semver, contentHash, generatorVersion
- `fsm.json` — canonical DSL (sorted keys)
- `docker-compose.yml` — controller + tools-{{toolLanguage}}
- `Dockerfile.controller` / `Dockerfile.tools-{{toolLanguage}}`
- `controller/` — stub that imports `@fsm/engine`
- `tools/` — one file per SCRIPT state
- `proto/` — placeholder for the tool-runtime proto
