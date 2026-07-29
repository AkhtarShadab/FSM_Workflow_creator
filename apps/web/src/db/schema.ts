import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
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

export const fsmDefinitions = sqliteTable("fsm_definitions", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  projectId: integer("project_id", { mode: "number" })
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  json: text("json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
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
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const runs = sqliteTable("runs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  fsmId: integer("fsm_id", { mode: "number" })
    .notNull()
    .references(() => fsmDefinitions.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
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

export const exportJobs = sqliteTable("export_jobs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  fsmId: integer("fsm_id", { mode: "number" })
    .notNull()
    .references(() => fsmDefinitions.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  status: text("status").notNull().default("pending"),
  artifactUrl: text("artifact_url"),
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

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type MemoryNode = typeof memoryNodes.$inferSelect;
export type MemoryEdge = typeof memoryEdges.$inferSelect;
