import { and, count, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { notifications } from "@/db/schema";
import { getNotificationsDb, type AppDb } from "./db";
import { unpackOccurrenceBody } from "./occurrence";
import {
  formatUnreadBadge,
  READ_RETENTION_MS,
  type ListNotificationsOptions,
  type NotificationItem,
  type NotificationScope,
  type NotificationType,
  type Severity,
} from "./types";

export type { ListNotificationsOptions, NotificationItem, NotificationScope };
export { formatUnreadBadge } from "./types";

export type QueryDeps = {
  db?: AppDb;
};

function scopeUnread(projectId?: number) {
  if (projectId == null) return isNull(notifications.readAt);
  return and(
    isNull(notifications.readAt),
    eq(notifications.projectId, projectId)
  );
}

function scopeRead(projectId?: number) {
  if (projectId == null) return isNotNull(notifications.readAt);
  return and(
    isNotNull(notifications.readAt),
    eq(notifications.projectId, projectId)
  );
}

function asItem(
  row: typeof notifications.$inferSelect
): NotificationItem {
  const { body, count: occurrence } = unpackOccurrenceBody(row.body);
  return {
    id: row.id,
    projectId: row.projectId,
    runId: row.runId,
    type: row.type as NotificationType,
    severity: row.severity as Severity,
    title: row.title,
    body,
    linkPath: row.linkPath,
    dedupeKey: row.dedupeKey,
    readAt: row.readAt,
    createdAt: row.createdAt,
    count: occurrence,
  };
}

export async function listNotifications(
  opts: ListNotificationsOptions = {},
  deps?: QueryDeps
): Promise<NotificationItem[]> {
  const db = await getNotificationsDb(deps?.db);
  try {
    await pruneReadNotifications({ db });
  } catch {
    // Retention is best-effort.
  }

  const filters = [];
  if (opts.projectId != null) {
    filters.push(eq(notifications.projectId, opts.projectId));
  }
  if (opts.severity) {
    filters.push(eq(notifications.severity, opts.severity));
  }
  if (opts.unreadOnly) {
    filters.push(isNull(notifications.readAt));
  }

  const query = db
    .select()
    .from(notifications)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(notifications.createdAt), desc(notifications.id));

  const rows = opts.limit != null ? await query.limit(opts.limit) : await query;
  return rows.map(asItem);
}

export async function getUnreadCount(
  scope: NotificationScope = {},
  deps?: QueryDeps
): Promise<{ count: number; badge: string }> {
  const db = await getNotificationsDb(deps?.db);
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(scopeUnread(scope.projectId));
  const n = Number(row?.n ?? 0);
  return { count: n, badge: formatUnreadBadge(n) };
}

export async function markRead(
  id: number,
  deps?: QueryDeps
): Promise<void> {
  const db = await getNotificationsDb(deps?.db);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
}

export async function markAllRead(
  scope: NotificationScope = {},
  deps?: QueryDeps
): Promise<void> {
  const db = await getNotificationsDb(deps?.db);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(scopeUnread(scope.projectId));
}

export async function clearRead(
  scope: NotificationScope = {},
  deps?: QueryDeps
): Promise<void> {
  const db = await getNotificationsDb(deps?.db);
  await db.delete(notifications).where(scopeRead(scope.projectId));
}

/** Deletes read notifications older than 30 days; unread rows are kept. */
export async function pruneReadNotifications(
  deps?: QueryDeps
): Promise<number> {
  const db = await getNotificationsDb(deps?.db);
  const cutoff = new Date(Date.now() - READ_RETENTION_MS);
  const removed = await db
    .delete(notifications)
    .where(
      and(isNotNull(notifications.readAt), lt(notifications.createdAt, cutoff))
    )
    .returning({ id: notifications.id });
  return removed.length;
}
