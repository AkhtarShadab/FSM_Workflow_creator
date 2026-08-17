import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const fsmDefinitions = sqliteTable(
  "fsm_definitions",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    projectId: integer("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    json: text("json").notNull(),
    contentHash: text("content_hash").notNull().default(""),
    label: text("label"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("fsm_definitions_project_id_version_unique").on(
      t.projectId,
      t.version
    ),
  ]
);

export const fsmDrafts = sqliteTable("fsm_drafts", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  projectId: integer("project_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  canvasJson: text("canvas_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const credentials = sqliteTable("credentials", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  projectId: integer("project_id", { mode: "number" }).references(
    () => projects.id,
    { onDelete: "cascade" }
  ),
  provider: text("provider").notNull(),
  baseUrl: text("base_url"),
  encryptedKey: text("encrypted_key").notNull(),
  label: text("label"),
  last4: text("last4").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  modelsJson: text("models_json"),
  discoveryStatus: text("discovery_status"),
  discoveryError: text("discovery_error"),
  discoveredAt: integer("discovered_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const schedules = sqliteTable(
  "schedules",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    projectId: integer("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fsmId: integer("fsm_id", { mode: "number" }).references(
      () => fsmDefinitions.id
    ),
    name: text("name"),
    kind: text("kind", { enum: ["cron", "once"] }),
    cronExpr: text("cron_expr"),
    runAt: integer("run_at", { mode: "timestamp" }),
    timezone: text("timezone").notNull().default("UTC"),
    payloadJson: text("payload_json"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    lastRunId: integer("last_run_id", { mode: "number" }),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }).notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("schedules_enabled_next_run_at").on(t.enabled, t.nextRunAt)]
);

export const runs = sqliteTable("runs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  fsmId: integer("fsm_id", { mode: "number" })
    .notNull()
    .references(() => fsmDefinitions.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  scheduleId: integer("schedule_id", { mode: "number" }).references(
    () => schedules.id
  ),
  startedAt: integer("started_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  tokenUsageJson: text("token_usage_json"),
});

export const runEvents = sqliteTable("run_events", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  runId: integer("run_id", { mode: "number" })
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  stateId: text("state_id").notNull(),
  kind: text("kind").notNull(),
  payloadJson: text("payload_json"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  latencyMs: real("latency_ms"),
  ts: integer("ts", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const humanTasks = sqliteTable("human_tasks", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  runId: integer("run_id", { mode: "number" })
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  stateId: text("state_id"),
  prompt: text("prompt"),
  assignee: text("assignee"),
  status: text("status").notNull().default("pending"),
  responseJson: text("response_json"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const checkpoints = sqliteTable("checkpoints", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  runId: integer("run_id", { mode: "number" })
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  stateId: text("state_id"),
  key: text("key"),
  summary: text("summary"),
  historyJson: text("history_json"),
  tokensSaved: integer("tokens_saved"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    projectId: integer("project_id", { mode: "number" }).references(
      () => projects.id,
      { onDelete: "cascade" }
    ),
    runId: integer("run_id", { mode: "number" }).references(() => runs.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    linkPath: text("link_path"),
    dedupeKey: text("dedupe_key"),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("notifications_read_at_created_at").on(t.readAt, t.createdAt)]
);

export const exportJobs = sqliteTable("export_jobs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  fsmId: integer("fsm_id", { mode: "number" })
    .notNull()
    .references(() => fsmDefinitions.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  status: text("status").notNull().default("pending"),
  artifactUrl: text("artifact_url"),
  contentHash: text("content_hash"),
  sizeBytes: integer("size_bytes"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const memoryNodes = sqliteTable("memory_nodes", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  projectId: integer("project_id", { mode: "number" }).references(
    () => projects.id,
    { onDelete: "cascade" }
  ),
  kind: text("kind", {
    enum: ["fact", "artifact", "preference", "checkpoint_ref"],
  })
    .notNull()
    .default("fact"),
  label: text("label").notNull(),
  content: text("content").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const memoryEdges = sqliteTable("memory_edges", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  projectId: integer("project_id", { mode: "number" }).references(
    () => projects.id,
    { onDelete: "cascade" }
  ),
  sourceId: integer("source_id", { mode: "number" })
    .notNull()
    .references(() => memoryNodes.id, { onDelete: "cascade" }),
  targetId: integer("target_id", { mode: "number" })
    .notNull()
    .references(() => memoryNodes.id, { onDelete: "cascade" }),
  relation: text("relation", {
    enum: ["derived_from", "summarizes", "prefers", "references"],
  })
    .notNull()
    .default("references"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const codeSymbols = sqliteTable(
  "code_symbols",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    projectId: integer("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    intent: text("intent").notNull(),
    identity: text("identity").notNull(),
    filePath: text("file_path").notNull(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    language: text("language"),
    hash: text("hash").notNull(),
    embeddingRef: text("embedding_ref"),
    chunkRef: text("chunk_ref"),
    indexedAt: integer("indexed_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("code_symbols_project_path").on(t.projectId, t.filePath),
    index("code_symbols_project_identity").on(t.projectId, t.identity),
  ]
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type MemoryNode = typeof memoryNodes.$inferSelect;
export type MemoryEdge = typeof memoryEdges.$inferSelect;
