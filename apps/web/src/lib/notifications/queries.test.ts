import { afterEach, describe, expect, it } from "vitest";
import { notifications, projects } from "@/db/schema";
import { notify } from "./emit";
import {
  clearRead,
  formatUnreadBadge,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  pruneReadNotifications,
} from "./queries";
import { READ_RETENTION_MS } from "./types";
import {
  closeNotificationTestDb,
  openNotificationTestDb,
} from "./test-db";

let ctx: Awaited<ReturnType<typeof openNotificationTestDb>> | undefined;

afterEach(async () => {
  if (ctx) {
    await closeNotificationTestDb(ctx);
    ctx = undefined;
  }
});

describe("notification queries", () => {
  it("getUnreadCount ignores read rows and caps rendering at 99+", async () => {
    ctx = await openNotificationTestDb();
    await notify({ type: "run.succeeded", title: "one" });
    await notify({ type: "run.succeeded", title: "two" });
    const [first] = await listNotifications();
    await markRead(first.id);

    const unread = await getUnreadCount();
    expect(unread.count).toBe(1);
    expect(unread.badge).toBe("1");

    await ctx.db.insert(notifications).values(
      Array.from({ length: 100 }, (_, i) => ({
        type: "run.failed",
        severity: "error",
        title: `flood-${i}`,
      }))
    );

    const capped = await getUnreadCount();
    expect(capped.count).toBe(101);
    expect(capped.badge).toBe("99+");
    expect(formatUnreadBadge(0)).toBe("");
    expect(formatUnreadBadge(99)).toBe("99");
    expect(formatUnreadBadge(100)).toBe("99+");
  });

  it("markRead is idempotent; markAllRead clears every unread row for the scope", async () => {
    ctx = await openNotificationTestDb();
    const [alpha] = await ctx.db
      .insert(projects)
      .values({ name: "alpha" })
      .returning();
    const [beta] = await ctx.db
      .insert(projects)
      .values({ name: "beta" })
      .returning();

    await notify({
      type: "run.failed",
      title: "alpha fail",
      projectId: alpha.id,
    });
    await notify({
      type: "run.failed",
      title: "beta fail",
      projectId: beta.id,
    });

    const alphaRows = await listNotifications({ projectId: alpha.id });
    await markRead(alphaRows[0].id);
    await markRead(alphaRows[0].id);

    expect((await getUnreadCount({ projectId: alpha.id })).count).toBe(0);
    const reread = await listNotifications({ projectId: alpha.id });
    expect(reread[0].readAt).not.toBeNull();

    await notify({
      type: "schedule.fired",
      title: "alpha again",
      projectId: alpha.id,
    });
    await markAllRead({ projectId: alpha.id });

    expect((await getUnreadCount({ projectId: alpha.id })).count).toBe(0);
    expect((await getUnreadCount({ projectId: beta.id })).count).toBe(1);
    expect((await getUnreadCount()).count).toBe(1);
  });

  it("clearRead deletes read rows and keeps unread", async () => {
    ctx = await openNotificationTestDb();
    await notify({ type: "run.succeeded", title: "keep unread" });
    await notify({ type: "run.failed", title: "clear me" });
    const rows = await listNotifications();
    const toRead = rows.find((r) => r.title === "clear me");
    expect(toRead).toBeDefined();
    await markRead(toRead!.id);
    await clearRead();

    const remaining = await listNotifications();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("keep unread");
    expect(remaining[0].readAt).toBeNull();
  });

  it("retention sweep deletes read rows older than 30 days and keeps unread ones", async () => {
    ctx = await openNotificationTestDb();
    const old = new Date(Date.now() - READ_RETENTION_MS - 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    await ctx.db.insert(notifications).values([
      {
        type: "run.succeeded",
        severity: "info",
        title: "old read",
        readAt: old,
        createdAt: old,
      },
      {
        type: "run.failed",
        severity: "error",
        title: "old unread",
        createdAt: old,
      },
      {
        type: "human.awaiting",
        severity: "warning",
        title: "recent read",
        readAt: recent,
        createdAt: recent,
      },
    ]);

    const removed = await pruneReadNotifications();
    expect(removed).toBe(1);

    const titles = (await listNotifications()).map((r) => r.title).sort();
    expect(titles).toEqual(["old unread", "recent read"]);
  });
});
