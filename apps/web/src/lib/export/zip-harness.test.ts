import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { exportJobs, projects } from "@/db/schema";
import { publishVersion, saveDraft, type PersistenceDb } from "@/lib/draft-sync";
import {
  ExportRouteError,
  buildExportZip,
  collectScriptLanguages,
  dslFromPublishedJson,
  enrichScriptSources,
  listExportJobs,
  sanitizeErrorMessage,
  zipHarnessFiles,
} from "@/lib/export/zip-harness";
import {
  defaultNodeData,
  type CanvasData,
  type StateNode,
  type TransitionEdge,
} from "@/lib/fsm-types";
import type { FsmDsl } from "@fsm/export-engine";

const clients: Array<ReturnType<typeof createClient>> = [];

afterEach(() => {
  while (clients.length > 0) {
    clients.pop()?.close();
  }
});

async function createTestDb(): Promise<PersistenceDb> {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE fsm_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      json TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX fsm_definitions_project_id_version_unique
      ON fsm_definitions (project_id, version);
    CREATE TABLE fsm_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      canvas_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE export_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      fsm_id INTEGER NOT NULL REFERENCES fsm_definitions(id) ON DELETE CASCADE,
      target TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      artifact_url TEXT,
      content_hash TEXT,
      size_bytes INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return drizzle(client, { schema });
}

function node(
  id: string,
  type: StateNode["data"]["stateType"],
  patch: Partial<StateNode["data"]> = {},
  position = { x: 0, y: 0 }
): StateNode {
  return {
    id,
    type: "stateCircle",
    position,
    data: { ...defaultNodeData(type, type), ...patch, stateType: type },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  signal: string,
  extra: Partial<TransitionEdge["data"]> = {}
): TransitionEdge {
  return {
    id,
    source,
    target,
    type: "script",
    data: { signal, ...extra },
    label: signal,
  };
}

function linearCanvas(): CanvasData {
  return {
    nodes: [
      node("S0", "START", { label: "Start" }),
      node("E0", "END", { label: "End" }, { x: 200, y: 0 }),
    ],
    edges: [edge("e0", "S0", "E0", "::SCRIPT.NEXT")],
  };
}

function scriptCanvas(code = "print('ok')\n", language: "python" | "bash" = "python"): CanvasData {
  return {
    nodes: [
      node("S0", "START", { label: "Start" }),
      node(
        "T0",
        "SCRIPT",
        {
          label: "Fetch",
          script: {
            toolName: "fetch_pages",
            language,
            code,
          },
        },
        { x: 160, y: 0 }
      ),
      node("E0", "END", { label: "End" }, { x: 320, y: 0 }),
    ],
    edges: [
      edge("e0", "S0", "T0", "::SCRIPT.NEXT"),
      edge("e1", "T0", "E0", "::SCRIPT.NEXT"),
    ],
  };
}

async function seedPublished(
  db: PersistenceDb,
  canvas: CanvasData,
  name = "demo-harness"
) {
  const [project] = await db
    .insert(projects)
    .values({ name })
    .returning({ id: projects.id });
  await saveDraft(db, project.id, canvas, 0);
  const published = await publishVersion(db, project.id, "v1");
  return { projectId: project.id, published };
}

async function zipPaths(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir)
    .sort();
}

describe("dslFromPublishedJson", () => {
  it("strips canvas and injects SCRIPT code from the snapshot", () => {
    const published = {
      name: "demo",
      states: [
        { id: "S0", type: "START" },
        {
          id: "T0",
          type: "SCRIPT",
          tool: { name: "fetch_pages", language: "python" },
        },
      ],
      canvas: scriptCanvas("print('from-canvas')\n"),
    };
    const { dsl } = dslFromPublishedJson(JSON.stringify(published));
    expect("canvas" in dsl).toBe(false);
    const script = (dsl.states as Array<Record<string, unknown>>)[1];
    expect((script.script as { code: string }).code).toBe("print('from-canvas')\n");
  });

  it("rejects invalid JSON", () => {
    expect(() => dslFromPublishedJson("not-json")).toThrow(ExportRouteError);
  });
});

describe("collectScriptLanguages / enrichScriptSources", () => {
  it("reports mixed SCRIPT languages", () => {
    const dsl: FsmDsl = {
      states: [
        {
          id: "a",
          type: "SCRIPT",
          script: { language: "python", code: "x" },
        },
        {
          id: "b",
          type: "SCRIPT",
          script: { language: "bash", code: "y" },
        },
      ],
    };
    expect(collectScriptLanguages(dsl)).toEqual(["bash", "python"]);
  });

  it("fills empty SCRIPT code from canvas", () => {
    const dsl: FsmDsl = {
      states: [{ id: "T0", type: "SCRIPT", tool: { name: "t" } }],
    };
    const enriched = enrichScriptSources(dsl, scriptCanvas("echo hi\n", "bash"));
    const state = enriched.states[0] as { script: { code: string; language: string } };
    expect(state.script.code).toBe("echo hi\n");
    expect(state.script.language).toBe("bash");
  });
});

describe("sanitizeErrorMessage", () => {
  it("redacts PAT-shaped tokens", () => {
    expect(sanitizeErrorMessage("boom ghp_abc123xyz and sk-secretkey")).toBe(
      "boom [redacted] and [redacted]"
    );
  });
});

describe("buildExportZip", () => {
  it("refuses export before any publish", async () => {
    const db = await createTestDb();
    const [project] = await db
      .insert(projects)
      .values({ name: "empty" })
      .returning({ id: projects.id });
    await expect(buildExportZip(db, project.id)).rejects.toMatchObject({
      code: "NO_PUBLISHED_VERSION",
      status: 409,
    });
    const jobs = await db.select().from(exportJobs);
    expect(jobs).toHaveLength(0);
  });

  it("streams a ZIP with the harness layout and writes export_jobs", async () => {
    const db = await createTestDb();
    const { projectId, published } = await seedPublished(db, linearCanvas());
    const result = await buildExportZip(db, projectId);
    expect(result.filename).toMatch(/^harness-demo-harness-v1\.0\.0\.zip$/);
    expect(result.job.status).toBe("complete");
    expect(result.job.contentHash).toBe(published.contentHash);
    expect(result.job.sizeBytes).toBeGreaterThan(0);
    expect(result.sizeWarning).toBe(false);

    const paths = await zipPaths(result.bytes);
    expect(paths).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "fsm.json",
        "docker-compose.yml",
        "Dockerfile.controller",
        "README.md",
        ".env.example",
      ])
    );

    const zip = await JSZip.loadAsync(result.bytes);
    const manifest = JSON.parse(
      (await zip.file("manifest.json")?.async("string")) ?? "{}"
    ) as { contentHash: string; version: string };
    expect(manifest.contentHash).toBe(published.contentHash);
    expect(manifest.version).toBe("1.0.0");

    const jobs = await listExportJobs(db, projectId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("complete");
    expect(jobs[0].contentHash).toBe(published.contentHash);
    expect(jobs[0].sizeBytes).toBe(result.job.sizeBytes);
    expect(jobs[0].target).toBe("zip");
  });

  it("re-exporting the same version records a second job with the same hash", async () => {
    const db = await createTestDb();
    const { projectId, published } = await seedPublished(db, linearCanvas());
    const first = await buildExportZip(db, projectId);
    const second = await buildExportZip(db, projectId);
    expect(second.job.contentHash).toBe(first.job.contentHash);
    expect(second.job.contentHash).toBe(published.contentHash);
    const jobs = await listExportJobs(db, projectId);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.contentHash))).toEqual(
      new Set([published.contentHash])
    );
  });

  it("puts SCRIPT source from the canvas into tools/", async () => {
    const db = await createTestDb();
    const { projectId } = await seedPublished(
      db,
      scriptCanvas("print('::SCRIPT.NEXT')\n")
    );
    const result = await buildExportZip(db, projectId);
    const zip = await JSZip.loadAsync(result.bytes);
    const tool = await zip.file("tools/fetch_pages.py")?.async("string");
    expect(tool).toBe("print('::SCRIPT.NEXT')\n");
  });

  it("records TOOL_SOURCE_MISSING as a failed job", async () => {
    const db = await createTestDb();
    const { projectId } = await seedPublished(db, scriptCanvas("   "));
    await expect(buildExportZip(db, projectId)).rejects.toMatchObject({
      code: "TOOL_SOURCE_MISSING",
      status: 422,
    });
    const jobs = await listExportJobs(db, projectId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].error).toMatch(/empty tool source/i);
  });

  it("refuses mixed SCRIPT languages", async () => {
    const db = await createTestDb();
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node(
          "T0",
          "SCRIPT",
          {
            script: { toolName: "py", language: "python", code: "print(1)\n" },
          },
          { x: 100, y: 0 }
        ),
        node(
          "T1",
          "SCRIPT",
          {
            script: { toolName: "sh", language: "bash", code: "echo 1\n" },
          },
          { x: 200, y: 0 }
        ),
        node("E0", "END", {}, { x: 300, y: 0 }),
      ],
      edges: [
        edge("e0", "S0", "T0", "::SCRIPT.NEXT"),
        edge("e1", "T0", "T1", "::SCRIPT.NEXT"),
        edge("e2", "T1", "E0", "::SCRIPT.NEXT"),
      ],
    };
    const { projectId } = await seedPublished(db, canvas);
    await expect(buildExportZip(db, projectId)).rejects.toMatchObject({
      code: "MIXED_LANGUAGES",
    });
    const jobs = await listExportJobs(db, projectId);
    expect(jobs[0].status).toBe("failed");
  });

  it("lists lint errors and writes a failed job", async () => {
    const db = await createTestDb();
    const canvas: CanvasData = {
      nodes: [
        node("S0", "START"),
        node("V0", "VALIDATE", { validate: { kind: "schema", schema: "" } }, {
          x: 160,
          y: 0,
        }),
        node("E0", "END", {}, { x: 320, y: 0 }),
      ],
      edges: [
        edge("e0", "S0", "V0", "::SCRIPT.NEXT"),
        edge("e1", "V0", "E0", "::VALIDATE.OK"),
      ],
    };
    const { projectId } = await seedPublished(db, canvas);
    try {
      await buildExportZip(db, projectId);
      expect.unreachable("expected LINT_FAILED");
    } catch (err) {
      expect(err).toBeInstanceOf(ExportRouteError);
      const typed = err as ExportRouteError;
      expect(typed.code).toBe("LINT_FAILED");
      const issues = typed.extra.issues as Array<{ code: string }>;
      expect(issues.some((i) => i.code === "VALIDATE_INCOMPLETE")).toBe(true);
    }
    const jobs = await listExportJobs(db, projectId);
    expect(jobs[0].status).toBe("failed");
  });

  it("exports a specific versionId rather than always the latest", async () => {
    const db = await createTestDb();
    const { projectId, published } = await seedPublished(db, linearCanvas());
    await saveDraft(db, projectId, scriptCanvas("print(1)\n"), 1);
    const v2 = await publishVersion(db, projectId, "v2");
    expect(v2.id).not.toBe(published.id);

    const older = await buildExportZip(db, projectId, { versionId: published.id });
    expect(older.job.contentHash).toBe(published.contentHash);
    const latest = await buildExportZip(db, projectId);
    expect(latest.job.contentHash).toBe(v2.contentHash);
  });

  it("includeMemory adds memory.json", async () => {
    const db = await createTestDb();
    const { projectId } = await seedPublished(db, linearCanvas());
    const result = await buildExportZip(db, projectId, { includeMemory: true });
    const paths = await zipPaths(result.bytes);
    expect(paths).toContain("memory.json");
  });
});

describe("zipHarnessFiles", () => {
  it("is deterministic for the same file tree", async () => {
    const files = [
      { path: "a.txt", contents: "hello\n" },
      { path: "b.txt", contents: "world\n" },
    ];
    const a = await zipHarnessFiles(files);
    const b = await zipHarnessFiles(files);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
