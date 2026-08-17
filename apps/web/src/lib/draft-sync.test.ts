import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { projects } from "@/db/schema";
import { canvasToDsl } from "@/lib/canvas-to-dsl";
import { contentHash } from "@/lib/canonical-json";
import {
  DRAFT_MAX_BYTES,
  PersistenceError,
  listVersions,
  loadDraft,
  publishVersion,
  saveDraft,
  type PersistenceDb,
} from "@/lib/draft-sync";
import {
  defaultNodeData,
  type CanvasData,
  type StateNode,
  type TransitionEdge,
} from "@/lib/fsm-types";

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
  signal: string
): TransitionEdge {
  return {
    id,
    source,
    target,
    type: "script",
    data: { signal },
    label: signal,
  };
}

function canvas(label = "Start", positionX = 0): CanvasData {
  return {
    nodes: [
      node("S0", "START", { label }, { x: positionX, y: 0 }),
      node("E0", "END", { label: "End" }, { x: 200, y: 0 }),
    ],
    edges: [edge("e0", "S0", "E0", "::SCRIPT.NEXT")],
  };
}

async function seedProject(db: PersistenceDb, name = "Harness") {
  const [row] = await db
    .insert(projects)
    .values({ name })
    .returning({ id: projects.id });
  return row.id;
}

describe("saveDraft / loadDraft", () => {
  it("upserts a draft and round-trips canvas + revision", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    const first = canvas("Alpha");

    const saved = await saveDraft(db, projectId, first, 0);
    expect(saved.revision).toBe(1);

    const loaded = await loadDraft(db, projectId);
    expect(loaded?.revision).toBe(1);
    expect(loaded?.canvas.nodes[0]?.data.label).toBe("Alpha");

    const second = canvas("Beta");
    const updated = await saveDraft(db, projectId, second, 1);
    expect(updated.revision).toBe(2);
    const reloaded = await loadDraft(db, projectId);
    expect(reloaded?.revision).toBe(2);
    expect(reloaded?.canvas.nodes[0]?.data.label).toBe("Beta");
  });

  it("returns null when the project has no draft", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    expect(await loadDraft(db, projectId)).toBeNull();
  });

  it("rejects STALE_REVISION and does not write", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    await saveDraft(db, projectId, canvas("v1"), 0);
    await saveDraft(db, projectId, canvas("v2"), 1);

    await expect(
      saveDraft(db, projectId, canvas("stale"), 1)
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    await expect(
      saveDraft(db, projectId, canvas("stale"), 1)
    ).rejects.toBeInstanceOf(PersistenceError);

    const loaded = await loadDraft(db, projectId);
    expect(loaded?.revision).toBe(2);
    expect(loaded?.canvas.nodes[0]?.data.label).toBe("v2");
  });

  it("rejects DRAFT_TOO_LARGE over 2 MiB", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    const huge = canvas("ok");
    huge.nodes[0]!.data.description = "x".repeat(DRAFT_MAX_BYTES + 1);

    await expect(saveDraft(db, projectId, huge, 0)).rejects.toMatchObject({
      code: "DRAFT_TOO_LARGE",
    });
    expect(await loadDraft(db, projectId)).toBeNull();
  });

  it("rejects PROJECT_MISSING", async () => {
    const db = await createTestDb();
    await expect(saveDraft(db, 999, canvas(), 0)).rejects.toMatchObject({
      code: "PROJECT_MISSING",
    });
  });
});

describe("publishVersion / listVersions", () => {
  it("returns the same row for an unchanged canvas (no version bump)", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    await saveDraft(db, projectId, canvas("same"), 0);

    const first = await publishVersion(db, projectId, "v1");
    expect(first.version).toBe(1);
    expect(first.label).toBe("v1");
    expect(first.contentHash).toBe(contentHash(canvasToDsl(canvas("same"))));

    const second = await publishVersion(db, projectId, "ignored");
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(1);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.label).toBe("v1");

    const versions = await listVersions(db, projectId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.id).toBe(first.id);
  });

  it("increments version monotonically across three distinct canvases", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);

    await saveDraft(db, projectId, canvas("one"), 0);
    const v1 = await publishVersion(db, projectId);

    await saveDraft(db, projectId, canvas("two"), 1);
    const v2 = await publishVersion(db, projectId, "two");

    await saveDraft(db, projectId, canvas("three"), 2);
    const v3 = await publishVersion(db, projectId);

    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    expect(new Set([v1.contentHash, v2.contentHash, v3.contentHash]).size).toBe(
      3
    );

    const versions = await listVersions(db, projectId);
    expect(versions.map((row) => row.version)).toEqual([3, 2, 1]);
    expect(versions[1]?.label).toBe("two");
  });

  it("does not bump when only timestamps on the canvas change", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    const firstCanvas = canvas("stable");
    await saveDraft(db, projectId, firstCanvas, 0);
    const published = await publishVersion(db, projectId);

    const touched = canvas("stable");
    (touched as CanvasData & { updatedAt: number }).updatedAt = Date.now();
    await saveDraft(db, projectId, touched, 1);
    const again = await publishVersion(db, projectId);
    expect(again.id).toBe(published.id);
    expect(again.version).toBe(1);
  });

  it("rejects NO_DRAFT when nothing has been saved", async () => {
    const db = await createTestDb();
    const projectId = await seedProject(db);
    await expect(publishVersion(db, projectId)).rejects.toMatchObject({
      code: "NO_DRAFT",
    });
  });
});
