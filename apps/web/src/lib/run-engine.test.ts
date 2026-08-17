import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { fsmDefinitions, projects, runs } from "@/db/schema";
import { startProjectRunOn } from "@/lib/run-engine";
import { listVersions, publishVersion, saveDraft } from "@/lib/draft-sync";
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

async function createTestDb() {
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
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      fsm_id INTEGER NOT NULL REFERENCES fsm_definitions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      triggered_by TEXT NOT NULL DEFAULT 'manual',
      schedule_id INTEGER,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at INTEGER,
      token_usage_json TEXT
    );
    CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      state_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      latency_ms REAL,
      ts INTEGER NOT NULL DEFAULT (unixepoch())
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

function canvas(label = "Start"): CanvasData {
  return {
    nodes: [
      node("S0", "START", { label }),
      node("E0", "END", { label: "End" }, { x: 200, y: 0 }),
    ],
    edges: [edge("e0", "S0", "E0", "::SCRIPT.NEXT")],
  };
}

describe("startProjectRunOn", () => {
  it("publishes then runs when the project has no version", async () => {
    const db = await createTestDb();
    const [project] = await db
      .insert(projects)
      .values({ name: "Run" })
      .returning({ id: projects.id });

    const result = await startProjectRunOn(db, project.id, canvas());
    expect(result.status).toBe("succeeded");
    expect(result.events.some((e) => e.stateId === "E0")).toBe(true);

    const defs = await db
      .select()
      .from(fsmDefinitions)
      .where(eq(fsmDefinitions.projectId, project.id));
    expect(defs).toHaveLength(1);
    expect(defs[0]?.contentHash).not.toBe("");
    expect(result.fsmId).toBe(defs[0]?.id);

    const runRows = await db.select().from(runs);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.fsmId).toBe(defs[0]?.id);
  });

  it("reuses the latest published fsmId and does not insert another definition", async () => {
    const db = await createTestDb();
    const [project] = await db
      .insert(projects)
      .values({ name: "Published" })
      .returning({ id: projects.id });

    await saveDraft(db, project.id, canvas("alpha"), 0);
    const published = await publishVersion(db, project.id, "v1");

    const first = await startProjectRunOn(db, project.id, canvas("alpha"));
    const second = await startProjectRunOn(db, project.id, canvas("alpha"));

    expect(first.fsmId).toBe(published.id);
    expect(second.fsmId).toBe(published.id);

    const defs = await db
      .select()
      .from(fsmDefinitions)
      .where(eq(fsmDefinitions.projectId, project.id));
    expect(defs).toHaveLength(1);

    const versions = await listVersions(db, project.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.id).toBe(published.id);

    const runRows = await db.select().from(runs);
    expect(runRows).toHaveLength(2);
    expect(runRows.every((row) => row.fsmId === published.id)).toBe(true);
  });
});
