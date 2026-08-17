import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical";
import { ExportEngineError } from "./errors";
import { generateHarness } from "./generate";
import type { ExportOptions, FsmDsl } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const LINEAR_DSL = JSON.parse(
  readFileSync(join(here, "fixtures/linear.fsm.json"), "utf8")
) as FsmDsl;

const LINEAR_OPTS: ExportOptions = {
  name: "linear-demo",
  version: "1.0.0",
  contentHash: "sha256:fixture-linear",
  toolLanguage: "python",
  includeMemory: false,
  generatorVersion: "0.1.0",
};

/** Golden path list for START → SCRIPT → END (python, no memory). */
const LINEAR_GOLDEN_PATHS = [
  ".env.example",
  "Dockerfile.controller",
  "Dockerfile.tools-python",
  "README.md",
  "controller/README.md",
  "controller/index.ts",
  "docker-compose.yml",
  "fsm.json",
  "manifest.json",
  "proto/.gitkeep",
  "tools/fetch_pages.py",
];

const API_KEY_PATTERN = /sk-/;
const ENVELOPE_PATTERN =
  /v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

function paths(files: { path: string }[]): string[] {
  return files.map((f) => f.path);
}

function fileMap(files: { path: string; contents: string }[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.contents]));
}

describe("generateHarness", () => {
  it("golden snapshot: linear START-SCRIPT-END paths + canonical fsm.json", () => {
    const files = generateHarness(LINEAR_DSL, LINEAR_OPTS);
    expect(paths(files)).toEqual(LINEAR_GOLDEN_PATHS);

    const byPath = fileMap(files);
    const expectedFsm = `{
  "name": "linear-demo",
  "states": [
    {
      "id": "START",
      "transitions": [
        {
          "on": "::SCRIPT.NEXT",
          "to": "fetch_pages"
        }
      ],
      "type": "START"
    },
    {
      "id": "fetch_pages",
      "label": "Fetch pages",
      "script": {
        "code": "print(\\"::SCRIPT.NEXT\\")\\n",
        "language": "python",
        "toolName": "fetch_pages"
      },
      "transitions": [
        {
          "on": "::SCRIPT.NEXT",
          "to": "END"
        }
      ],
      "type": "SCRIPT"
    },
    {
      "id": "END",
      "transitions": [],
      "type": "END"
    }
  ],
  "version": 1
}
`;
    expect(byPath.get("fsm.json")).toBe(expectedFsm);
    expect(byPath.get("fsm.json")).toBe(canonicalJson(LINEAR_DSL));

    const manifest = JSON.parse(byPath.get("manifest.json") ?? "{}") as {
      name: string;
      version: string;
      contentHash: string;
      generatorVersion: string;
      createdAt?: string;
    };
    expect(manifest).toEqual({
      contentHash: "sha256:fixture-linear",
      generatorVersion: "0.1.0",
      name: "linear-demo",
      version: "1.0.0",
    });
    expect(manifest.createdAt).toBeUndefined();
    expect(byPath.get("tools/fetch_pages.py")).toBe('print("::SCRIPT.NEXT")\n');
    expect(byPath.get("controller/README.md")).toContain("@fsm/engine");
    expect(byPath.get("controller/index.ts")).toContain("@fsm/engine");
  });

  it("determinism: two generates on the same input are byte-identical", () => {
    const a = generateHarness(LINEAR_DSL, LINEAR_OPTS);
    const b = generateHarness(LINEAR_DSL, LINEAR_OPTS);
    expect(a).toEqual(b);
    expect(a.map((f) => f.contents).join("\0")).toBe(
      b.map((f) => f.contents).join("\0")
    );
  });

  it("TOOL_SOURCE_MISSING for empty SCRIPT code", () => {
    const dsl: FsmDsl = {
      name: "empty-script",
      states: [
        { id: "S0", type: "START" },
        {
          id: "broken",
          type: "SCRIPT",
          script: { toolName: "broken", code: "   " },
        },
        { id: "END", type: "END" },
      ],
    };
    try {
      generateHarness(dsl, LINEAR_OPTS);
      expect.unreachable("expected TOOL_SOURCE_MISSING");
    } catch (err) {
      expect(err).toBeInstanceOf(ExportEngineError);
      expect((err as ExportEngineError).code).toBe("TOOL_SOURCE_MISSING");
    }
  });

  it("TOOL_SOURCE_MISSING when SCRIPT has no source field", () => {
    const dsl: FsmDsl = {
      states: [{ id: "s1", stateType: "SCRIPT", toolName: "orphan" }],
    };
    expect(() => generateHarness(dsl, LINEAR_OPTS)).toThrowError(
      ExportEngineError
    );
    try {
      generateHarness(dsl, LINEAR_OPTS);
    } catch (err) {
      expect((err as ExportEngineError).code).toBe("TOOL_SOURCE_MISSING");
    }
  });

  it("includeMemory false omits memory.json", () => {
    const files = generateHarness(LINEAR_DSL, {
      ...LINEAR_OPTS,
      includeMemory: false,
    });
    expect(paths(files)).not.toContain("memory.json");
  });

  it("includeMemory true emits memory.json", () => {
    const files = generateHarness(LINEAR_DSL, {
      ...LINEAR_OPTS,
      includeMemory: true,
    });
    expect(paths(files)).toContain("memory.json");
    const memory = files.find((f) => f.path === "memory.json")?.contents;
    expect(memory).toBe(canonicalJson({ nodes: [], edges: [] }));
    const manifest = JSON.parse(
      files.find((f) => f.path === "manifest.json")?.contents ?? "{}"
    ) as { memoryIncluded: boolean; memoryTruncated: boolean };
    expect(manifest.memoryIncluded).toBe(true);
    expect(manifest.memoryTruncated).toBe(false);
  });

  it("secret scan: no sk- keys or v1. credential envelopes", () => {
    const files = generateHarness(LINEAR_DSL, {
      ...LINEAR_OPTS,
      includeMemory: true,
    });
    for (const file of files) {
      expect(file.contents, file.path).not.toMatch(API_KEY_PATTERN);
      expect(file.contents, file.path).not.toMatch(ENVELOPE_PATTERN);
    }
    const env = files.find((f) => f.path === ".env.example")?.contents ?? "";
    expect(env).toContain("OPENAI_API_KEY=");
    expect(env).toContain("ANTHROPIC_API_KEY=");
    expect(env).toContain("PLATFORM_SECRET=");
    expect(env).not.toMatch(/OPENAI_API_KEY=.+/);
  });

  it("compose references the toolLanguage service", () => {
    const py = generateHarness(LINEAR_DSL, LINEAR_OPTS);
    const pyCompose = py.find((f) => f.path === "docker-compose.yml")?.contents ?? "";
    expect(pyCompose).toContain("tools-python:");
    expect(pyCompose).toContain("Dockerfile.tools-python");
    expect(pyCompose).not.toContain("tools-bash");
    expect(paths(py)).toContain("Dockerfile.tools-python");
    expect(paths(py)).not.toContain("Dockerfile.tools-bash");

    const sh = generateHarness(LINEAR_DSL, {
      ...LINEAR_OPTS,
      toolLanguage: "bash",
    });
    const shCompose = sh.find((f) => f.path === "docker-compose.yml")?.contents ?? "";
    expect(shCompose).toContain("tools-bash:");
    expect(shCompose).toContain("Dockerfile.tools-bash");
    expect(shCompose).not.toContain("tools-python");
    expect(paths(sh)).toContain("Dockerfile.tools-bash");
    expect(paths(sh)).toContain("tools/fetch_pages.sh");
    expect(paths(sh)).not.toContain("Dockerfile.tools-python");
  });
});

describe("canonicalJson", () => {
  it("sorts keys regardless of input order", () => {
    expect(canonicalJson({ z: 1, a: 2, m: { b: 1, a: 0 } })).toBe(
      `{
  "a": 2,
  "m": {
    "a": 0,
    "b": 1
  },
  "z": 1
}
`
    );
  });
});
