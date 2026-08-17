import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { fsmDefinitions, projects, runEvents, runs } from "@/db/schema";
import { getRunEvents, listRuns } from "@/lib/run-history";
import type { PersistenceDb } from "@/lib/draft-sync";

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

async function seedProject(db: PersistenceDb, name = "History") {
  const [project] = await db
    .insert(projects)
    .values({ name })
    .returning({ id: projects.id });
  const [def] = await db
    .insert(fsmDefinitions)
    .values({
      projectId: project.id,
      version: 2,
      json: "{}",
      contentHash: "abc123",
      label: "shipped",
    })
    .returning({ id: fsmDefinitions.id });
  return { projectId: project.id, fsmId: def.id };
}

describe("listRuns", () => {
  it("joins runs to fsm_definitions and returns newest first", async () => {
    const db = await createTestDb();
    const { projectId, fsmId } = await seedProject(db);
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-01-02T00:00:00Z");

    await db.insert(runs).values({
      fsmId,
      status: "failed",
      startedAt: older,
      endedAt: new Date(older.getTime() + 23_000),
      tokenUsageJson: JSON.stringify({ tokensIn: 10, tokensOut: 4 }),
    });
    const [latest] = await db
      .insert(runs)
      .values({
        fsmId,
        status: "succeeded",
        startedAt: newer,
        endedAt: new Date(newer.getTime() + 72_000),
      })
      .returning({ id: runs.id });

    const rows = await listRuns(db, projectId, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(latest.id);
    expect(rows[0]?.status).toBe("succeeded");
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.label).toBe("shipped");
    expect(rows[0]?.contentHash).toBe("abc123");
    expect(rows[0]?.durationMs).toBe(72_000);
    expect(rows[1]?.status).toBe("failed");
    expect(rows[1]?.tokensIn).toBe(10);
    expect(rows[1]?.tokensOut).toBe(4);
  });

  it("respects limit and hides other projects", async () => {
    const db = await createTestDb();
    const a = await seedProject(db, "A");
    const b = await seedProject(db, "B");
    for (let i = 0; i < 3; i++) {
      await db.insert(runs).values({ fsmId: a.fsmId, status: "succeeded" });
    }
    await db.insert(runs).values({ fsmId: b.fsmId, status: "failed" });

    const rows = await listRuns(db, a.projectId, 2);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.fsmId === a.fsmId)).toBe(true);
    expect(rows.every((row) => row.status === "succeeded")).toBe(true);
  });

  it("returns an empty list when the project has no runs", async () => {
    const db = await createTestDb();
    const { projectId } = await seedProject(db);
    expect(await listRuns(db, projectId, 20)).toEqual([]);
  });
});

describe("getRunEvents", () => {
  it("returns ordered events and supports afterId replay", async () => {
    const db = await createTestDb();
    const { fsmId } = await seedProject(db);
    const [run] = await db
      .insert(runs)
      .values({ fsmId, status: "succeeded" })
      .returning({ id: runs.id });

    await db.insert(runEvents).values([
      {
        runId: run.id,
        stateId: "S0",
        kind: "SCRIPT",
        payloadJson: JSON.stringify({ message: "start" }),
      },
      {
        runId: run.id,
        stateId: "S1",
        kind: "AI",
        payloadJson: JSON.stringify({ message: "think" }),
        tokensIn: 3,
        tokensOut: 8,
      },
      {
        runId: run.id,
        stateId: "E0",
        kind: "SYSTEM",
        payloadJson: JSON.stringify({ message: "done" }),
      },
    ]);

    const all = await getRunEvents(db, run.id);
    expect(all.map((e) => e.stateId)).toEqual(["S0", "S1", "E0"]);
    expect(all[0]?.message).toBe("start");
    expect(all[1]?.tokensIn).toBe(3);
    expect(all[1]?.tokensOut).toBe(8);

    const afterFirst = await getRunEvents(db, run.id, all[0]?.id);
    expect(afterFirst.map((e) => e.stateId)).toEqual(["S1", "E0"]);
    expect(afterFirst.every((e) => e.id > (all[0]?.id ?? 0))).toBe(true);
  });

  it("returns no events for an unknown run", async () => {
    const db = await createTestDb();
    expect(await getRunEvents(db, 999)).toEqual([]);
  });
});
