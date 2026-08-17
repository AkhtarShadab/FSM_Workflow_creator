import { canonicalJson } from "./canonical";
import { collectScriptTools } from "./scripts";
import {
  controllerIndex,
  controllerReadme,
  dockerComposeYml,
  dockerfileController,
  dockerfileTools,
  ENV_EXAMPLE,
  PROTO_GITKEEP,
  rootReadme,
} from "./templates";
import {
  DEFAULT_GENERATOR_VERSION,
  MEMORY_NODE_CAP,
  type ExportOptions,
  type FsmDsl,
  type GeneratedFile,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function memoryBundle(dsl: FsmDsl): { value: unknown; truncated: boolean } {
  const memory = dsl.memory;
  if (!isRecord(memory)) {
    return { value: { nodes: [], edges: [] }, truncated: false };
  }
  const nodes = Array.isArray(memory.nodes) ? memory.nodes : null;
  if (nodes && nodes.length > MEMORY_NODE_CAP) {
    return {
      value: { ...memory, nodes: nodes.slice(-MEMORY_NODE_CAP) },
      truncated: true,
    };
  }
  return { value: memory, truncated: false };
}

/**
 * Pure harness generator: no network, no filesystem, no clocks.
 * Same (dsl, opts) always yields byte-identical files.
 */
export function generateHarness(dsl: FsmDsl, opts: ExportOptions): GeneratedFile[] {
  const toolLanguage = opts.toolLanguage;
  const generatorVersion = opts.generatorVersion ?? DEFAULT_GENERATOR_VERSION;
  const scripts = collectScriptTools(dsl, toolLanguage);

  const manifest: Record<string, unknown> = {
    name: opts.name,
    version: opts.version,
    contentHash: opts.contentHash,
    generatorVersion,
  };

  let memoryJson: string | undefined;
  if (opts.includeMemory) {
    const memory = memoryBundle(dsl);
    manifest.memoryIncluded = true;
    manifest.memoryTruncated = memory.truncated;
    memoryJson = canonicalJson(memory.value);
  }

  const files: GeneratedFile[] = [
    { path: "manifest.json", contents: canonicalJson(manifest) },
    { path: "fsm.json", contents: canonicalJson(dsl) },
    { path: "docker-compose.yml", contents: dockerComposeYml(toolLanguage) },
    { path: "Dockerfile.controller", contents: dockerfileController() },
    {
      path: `Dockerfile.tools-${toolLanguage}`,
      contents: dockerfileTools(toolLanguage),
    },
    { path: "controller/README.md", contents: controllerReadme() },
    { path: "controller/index.ts", contents: controllerIndex() },
    { path: "proto/.gitkeep", contents: PROTO_GITKEEP },
    { path: ".env.example", contents: ENV_EXAMPLE },
    {
      path: "README.md",
      contents: rootReadme({
        name: opts.name,
        version: opts.version,
        toolLanguage,
      }),
    },
  ];

  for (const tool of scripts) {
    files.push({
      path: tool.path,
      contents: tool.source.endsWith("\n") ? tool.source : `${tool.source}\n`,
      ...(toolLanguage === "bash" ? { mode: 0o755 } : {}),
    });
  }

  if (memoryJson !== undefined) {
    files.push({ path: "memory.json", contents: memoryJson });
  }

  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
