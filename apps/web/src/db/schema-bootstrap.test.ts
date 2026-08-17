import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

describe("schema bootstrap", () => {
  it("exports every FeatureShipping table", () => {
    expect(getTableName(schema.projects)).toBe("projects");
    expect(getTableName(schema.fsmDefinitions)).toBe("fsm_definitions");
    expect(getTableName(schema.fsmDrafts)).toBe("fsm_drafts");
    expect(getTableName(schema.credentials)).toBe("credentials");
    expect(getTableName(schema.schedules)).toBe("schedules");
    expect(getTableName(schema.runs)).toBe("runs");
    expect(getTableName(schema.runEvents)).toBe("run_events");
    expect(getTableName(schema.humanTasks)).toBe("human_tasks");
    expect(getTableName(schema.checkpoints)).toBe("checkpoints");
    expect(getTableName(schema.notifications)).toBe("notifications");
    expect(getTableName(schema.exportJobs)).toBe("export_jobs");
    expect(getTableName(schema.memoryNodes)).toBe("memory_nodes");
    expect(getTableName(schema.memoryEdges)).toBe("memory_edges");
    expect(getTableName(schema.codeSymbols)).toBe("code_symbols");
  });

  it("exposes SB0 columns on existing and new tables", () => {
    expect(Object.keys(getTableColumns(schema.fsmDrafts)).sort()).toEqual(
      ["canvasJson", "id", "projectId", "revision", "updatedAt"].sort()
    );
    expect(getTableColumns(schema.fsmDefinitions).contentHash).toBeDefined();
    expect(getTableColumns(schema.fsmDefinitions).label).toBeDefined();
    expect(getTableColumns(schema.credentials).last4).toBeDefined();
    expect(getTableColumns(schema.credentials).active).toBeDefined();
    expect(getTableColumns(schema.credentials).modelsJson).toBeDefined();
    expect(getTableColumns(schema.credentials).discoveryStatus).toBeDefined();
    expect(getTableColumns(schema.credentials).discoveryError).toBeDefined();
    expect(getTableColumns(schema.credentials).discoveredAt).toBeDefined();
    expect(getTableColumns(schema.credentials).revokedAt).toBeDefined();
    expect(getTableColumns(schema.runs).triggeredBy).toBeDefined();
    expect(getTableColumns(schema.runs).scheduleId).toBeDefined();
    expect(getTableColumns(schema.exportJobs).contentHash).toBeDefined();
    expect(getTableColumns(schema.exportJobs).sizeBytes).toBeDefined();
    expect(getTableColumns(schema.exportJobs).error).toBeDefined();
    expect(getTableColumns(schema.codeSymbols).hash).toBeDefined();
    expect(getTableColumns(schema.codeSymbols).indexedAt).toBeDefined();
    expect(getTableColumns(schema.schedules).nextRunAt).toBeDefined();
    expect(getTableColumns(schema.humanTasks).status).toBeDefined();
    expect(getTableColumns(schema.checkpoints).historyJson).toBeDefined();
    expect(getTableColumns(schema.notifications).dedupeKey).toBeDefined();
  });
});

describe("schema bootstrap migration", () => {
  let dir: string;
  let client: ReturnType<typeof createClient>;

  afterAll(async () => {
    client?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("applies on an empty libSQL file and round-trips SB0 rows", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fsm-sb0-"));
    client = createClient({ url: `file:${path.join(dir, "test.db")}` });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const tables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    const names = tables.rows.map((row) => String(row.name));
    for (const table of [
      "fsm_drafts",
      "code_symbols",
      "notifications",
      "schedules",
      "human_tasks",
      "checkpoints",
    ]) {
      expect(names).toContain(table);
    }

    const [project] = await db
      .insert(schema.projects)
      .values({ name: "sb0" })
      .returning();

    await db.insert(schema.fsmDrafts).values({
      projectId: project.id,
      canvasJson: "{}",
    });

    const [fsm] = await db
      .insert(schema.fsmDefinitions)
      .values({
        projectId: project.id,
        version: 1,
        json: "{}",
        contentHash: "abc",
        label: "v1",
      })
      .returning();

    await expect(
      db.insert(schema.fsmDefinitions).values({
        projectId: project.id,
        version: 1,
        json: "{}",
        contentHash: "dup",
      })
    ).rejects.toThrow();

    await db.insert(schema.credentials).values({
      projectId: project.id,
      provider: "openai",
      encryptedKey: "sealed",
      last4: "1234",
      active: true,
    });

    const [schedule] = await db
      .insert(schema.schedules)
      .values({
        projectId: project.id,
        fsmId: fsm.id,
        name: "nightly",
        kind: "cron",
        cronExpr: "0 0 * * *",
        nextRunAt: new Date(0),
      })
      .returning();

    const [run] = await db
      .insert(schema.runs)
      .values({
        fsmId: fsm.id,
        status: "awaiting_human",
        triggeredBy: "schedule",
        scheduleId: schedule.id,
      })
      .returning();

    await db.insert(schema.humanTasks).values({
      runId: run.id,
      stateId: "human-1",
      prompt: "Approve?",
    });
    await db.insert(schema.checkpoints).values({
      runId: run.id,
      stateId: "sys-1",
      key: "run:1:cp:0",
      summary: "done",
    });
    await db.insert(schema.notifications).values({
      projectId: project.id,
      runId: run.id,
      type: "run.succeeded",
      severity: "info",
      title: "Run finished",
    });
    await db.insert(schema.exportJobs).values({
      fsmId: fsm.id,
      target: "zip",
      contentHash: "abc",
      sizeBytes: 12,
    });
    await db.insert(schema.codeSymbols).values({
      projectId: project.id,
      kind: "function",
      intent: "connect",
      identity: "connect()",
      filePath: "src/net.ts",
      hash: "h1",
      indexedAt: new Date(0),
    });

    const drafts = await db.select().from(schema.fsmDrafts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].revision).toBe(1);

    const creds = await db.select().from(schema.credentials);
    expect(creds[0].last4).toBe("1234");
    expect(creds[0].active).toBe(true);

    const persistedRuns = await db.select().from(schema.runs);
    expect(persistedRuns[0].triggeredBy).toBe("schedule");
    expect(persistedRuns[0].scheduleId).toBe(schedule.id);
  });
});
