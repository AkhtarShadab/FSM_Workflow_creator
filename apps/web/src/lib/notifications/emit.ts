import { and, eq, isNull } from "drizzle-orm";
import { notifications } from "@/db/schema";
import { getNotificationsDb, type AppDb } from "./db";
import { packOccurrenceBody, unpackOccurrenceBody } from "./occurrence";
import { pruneReadNotifications } from "./queries";
import { scrubOptional, scrubSecrets } from "./scrub";
import {
  defaultSeverityFor,
  type NotificationType,
  type NotifyInput,
  type Severity,
} from "./types";

export type { NotificationType, NotifyInput, Severity };
export { DEFAULT_SEVERITY, defaultSeverityFor } from "./types";
export { scrubSecrets } from "./scrub";

export type NotifyDeps = {
  db?: AppDb;
  logError?: (message: string, err: unknown) => void;
};

function logNotifyError(
  deps: NotifyDeps | undefined,
  err: unknown
): void {
  const message = "[notifications] notify failed";
  if (deps?.logError) {
    deps.logError(message, err);
    return;
  }
  console.error(message, err);
}

/**
 * Best-effort notification insert. Producers must not touch `notifications`
 * directly. Failures are logged and swallowed so a run is never affected.
 */
export async function notify(
  input: NotifyInput,
  deps?: NotifyDeps
): Promise<void> {
  try {
    const db = await getNotificationsDb(deps?.db);
    try {
      await pruneReadNotifications({ db });
    } catch {
      // Retention is best-effort and must not block emission.
    }

    const severity = input.severity ?? defaultSeverityFor(input.type);
    const title = scrubSecrets(input.title);
    const body = scrubOptional(input.body);
    const linkPath = scrubOptional(input.linkPath);
    const dedupeKey = scrubOptional(input.dedupeKey);

    if (dedupeKey) {
      const existing = await db
        .select({
          id: notifications.id,
          body: notifications.body,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.dedupeKey, dedupeKey),
            isNull(notifications.readAt)
          )
        )
        .limit(1);

      const row = existing[0];
      if (row) {
        const unpacked = unpackOccurrenceBody(row.body);
        await db
          .update(notifications)
          .set({
            body: packOccurrenceBody(unpacked.body, unpacked.count + 1),
            createdAt: new Date(),
          })
          .where(eq(notifications.id, row.id));
        return;
      }
    }

    await db.insert(notifications).values({
      type: input.type,
      severity,
      title: title || "Notification",
      body: packOccurrenceBody(body, 1),
      linkPath,
      dedupeKey,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
    });
  } catch (err) {
    logNotifyError(deps, err);
  }
}
