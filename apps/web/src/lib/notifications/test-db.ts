import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/db/schema";
import { setNotificationsDbForTests, type AppDb } from "./db";

const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
);

export async function openNotificationTestDb(): Promise<{
  db: AppDb;
  dir: string;
  client: ReturnType<typeof createClient>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "fsm-n1-"));
  const client = createClient({ url: `file:${path.join(dir, "test.db")}` });
  const db = drizzle(client, { schema }) as AppDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  setNotificationsDbForTests(db);
  return { db, dir, client };
}

export async function closeNotificationTestDb(ctx: {
  client: ReturnType<typeof createClient>;
  dir: string;
}): Promise<void> {
  setNotificationsDbForTests(null);
  ctx.client.close();
  await rm(ctx.dir, { recursive: true, force: true });
}
