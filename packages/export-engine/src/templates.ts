/**
 * String templates for generateHarness.
 * Keep in sync with the copies under /harness-templates.
 */
import type { ExportOptions } from "./types";

export const ENV_EXAMPLE = `# BYOK placeholders — copy to .env and fill locally.
# Never commit real secrets or credential envelopes.
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
PLATFORM_SECRET=
`;

export function dockerfileController(): string {
  return `FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY controller ./controller
COPY fsm.json manifest.json ./
# Executes the exported FSM with @fsm/engine (shared with the platform).
CMD ["node", "--import", "tsx", "controller/index.ts"]
`;
}

export function dockerfileTools(toolLanguage: ExportOptions["toolLanguage"]): string {
  if (toolLanguage === "bash") {
    return `FROM python:3.12-slim
WORKDIR /tools
COPY tools /tools
# Bash SCRIPT sources; the gRPC shim lands with the tool runtime.
CMD ["python", "-c", "print('tools-bash waiting for gRPC runtime')"]
`;
  }
  return `FROM python:3.12-slim
WORKDIR /tools
COPY tools /tools
# Python SCRIPT sources; the gRPC server lands with the tool runtime.
CMD ["python", "-c", "print('tools-python waiting for gRPC runtime')"]
`;
}

export function dockerComposeYml(toolLanguage: ExportOptions["toolLanguage"]): string {
  const tools = `tools-${toolLanguage}`;
  const dockerfile = `Dockerfile.tools-${toolLanguage}`;
  return `services:
  controller:
    build:
      context: .
      dockerfile: Dockerfile.controller
    env_file:
      - .env
    environment:
      TOOL_LANGUAGE: ${toolLanguage}
      TOOL_SERVICE: ${tools}
    depends_on:
      - ${tools}
    volumes:
      - ./fsm.json:/app/fsm.json:ro
      - ./tools:/app/tools:ro
  ${tools}:
    build:
      context: .
      dockerfile: ${dockerfile}
    volumes:
      - ./tools:/tools:ro
`;
}

export function rootReadme(
  opts: Pick<ExportOptions, "name" | "version" | "toolLanguage">
): string {
  const tools = `tools-${opts.toolLanguage}`;
  return `# ${opts.name}

Standalone harness for \`${opts.name}\` (${opts.version}).

The controller runs the exported FSM with \`@fsm/engine\`. SCRIPT states
execute in the \`${tools}\` service.

## Run

1. Copy \`.env.example\` to \`.env\` and fill the BYOK placeholders
   (\`OPENAI_API_KEY\`, \`ANTHROPIC_API_KEY\`, \`PLATFORM_SECRET\`).
   Do not commit real secrets.
2. \`docker compose up --build\`
3. The \`controller\` service loads \`fsm.json\` and executes it via \`@fsm/engine\`.
4. Tool files under \`tools/\` are mounted into \`${tools}\`.

## Layout

- \`manifest.json\` — name, semver, contentHash, generatorVersion
- \`fsm.json\` — canonical DSL (sorted keys)
- \`docker-compose.yml\` — controller + ${tools}
- \`Dockerfile.controller\` / \`Dockerfile.tools-${opts.toolLanguage}\`
- \`controller/\` — stub that imports \`@fsm/engine\`
- \`tools/\` — one file per SCRIPT state
- \`proto/\` — placeholder for the tool-runtime proto
`;
}

export function controllerReadme(): string {
  return `# Controller

This stub is the exported run loop. It uses \`@fsm/engine\` — the same
package the platform uses — so exported runs and in-app runs share one
implementation.

Wire live executors and the gRPC tool bridge before replacing the stub
\`index.ts\` entrypoint.
`;
}

export function controllerIndex(): string {
  return `/**
 * Harness controller — uses @fsm/engine to execute fsm.json.
 *
 * Environment (see .env.example):
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, PLATFORM_SECRET
 */
import { runFsm } from "@fsm/engine";

void runFsm;

console.log(
  "Controller stub using @fsm/engine. Wire executors and run fsm.json."
);
`;
}

export const PROTO_GITKEEP =
  "# Placeholder — copy packages/proto here once the tool runtime ships.\n";
