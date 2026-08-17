import { afterEach, describe, expect, it, vi } from "vitest";
import { notify } from "./emit";
import { listNotifications, markRead } from "./queries";
import { DEFAULT_SEVERITY } from "./types";
import {
  closeNotificationTestDb,
  openNotificationTestDb,
} from "./test-db";
import type { AppDb } from "./db";

const KEY_SHAPED = "sk-test-abcdefghijklmnopqrstuvwxyz123456";

let ctx: Awaited<ReturnType<typeof openNotificationTestDb>> | undefined;

afterEach(async () => {
  if (ctx) {
    await closeNotificationTestDb(ctx);
    ctx = undefined;
  }
});

describe("notify()", () => {
  it("writes a row with the correct type, severity, and link path", async () => {
    ctx = await openNotificationTestDb();
    await notify({
      type: "run.failed",
      title: "Run 42 failed",
      body: "timeout",
      linkPath: "/project/3/runs?run=42",
    });

    const rows = await listNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "run.failed",
      severity: "error",
      title: "Run 42 failed",
      body: "timeout",
      linkPath: "/project/3/runs?run=42",
      count: 1,
    });
  });

  it("collapses identical unread dedupeKey emissions into one row with count 2", async () => {
    ctx = await openNotificationTestDb();
    const input = {
      type: "run.failed" as const,
      title: "HTTP 500",
      body: "upstream",
      dedupeKey: "run:7:http",
    };
    await notify(input);
    await notify(input);

    const rows = await listNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].body).toBe("upstream");
    expect(rows[0].dedupeKey).toBe("run:7:http");
  });

  it("inserts a new row for the same dedupeKey after the first is read", async () => {
    ctx = await openNotificationTestDb();
    const input = {
      type: "run.failed" as const,
      title: "HTTP 500",
      dedupeKey: "run:7:http",
    };
    await notify(input);
    const [first] = await listNotifications();
    await markRead(first.id);
    await notify(input);

    const rows = await listNotifications();
    expect(rows).toHaveLength(2);
    const unread = rows.filter((r) => r.readAt == null);
    const read = rows.filter((r) => r.readAt != null);
    expect(unread).toHaveLength(1);
    expect(read).toHaveLength(1);
    expect(unread[0].count).toBe(1);
    expect(unread[0].id).not.toBe(first.id);
  });

  it("scrubs a key-shaped string before persistence", async () => {
    ctx = await openNotificationTestDb();
    await notify({
      type: "credential.failed",
      title: `Discovery failed for ${KEY_SHAPED}`,
      body: `provider returned ${KEY_SHAPED} in the error`,
      linkPath: `/settings?hint=${KEY_SHAPED}`,
      dedupeKey: `cred:${KEY_SHAPED}`,
    });

    const [row] = await listNotifications();
    expect(row.title).not.toContain(KEY_SHAPED);
    expect(row.body).not.toContain(KEY_SHAPED);
    expect(row.linkPath).not.toContain(KEY_SHAPED);
    expect(row.dedupeKey).not.toContain(KEY_SHAPED);
    expect(row.title).toContain("[REDACTED]");
    expect(row.body).toContain("[REDACTED]");
  });

  it("swallows a thrown DB error, logs it, and still resolves", async () => {
    const logError = vi.fn();
    const throwing = new Proxy({} as AppDb, {
      get(_target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          return undefined;
        }
        return () => {
          throw new Error("db down");
        };
      },
    });

    await expect(
      notify(
        { type: "run.failed", title: "should not persist" },
        { db: throwing, logError }
      )
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalled();
    expect(String(logError.mock.calls[0]?.[0])).toMatch(/notify failed/);
  });

  it("maps run.failed → error, human.awaiting → warning, run.succeeded → info", async () => {
    ctx = await openNotificationTestDb();
    expect(DEFAULT_SEVERITY["run.failed"]).toBe("error");
    expect(DEFAULT_SEVERITY["human.awaiting"]).toBe("warning");
    expect(DEFAULT_SEVERITY["run.succeeded"]).toBe("info");

    await notify({ type: "run.failed", title: "failed" });
    await notify({ type: "human.awaiting", title: "paused" });
    await notify({ type: "run.succeeded", title: "ok" });

    const rows = await listNotifications();
    const byType = Object.fromEntries(rows.map((r) => [r.type, r.severity]));
    expect(byType["run.failed"]).toBe("error");
    expect(byType["human.awaiting"]).toBe("warning");
    expect(byType["run.succeeded"]).toBe("info");
  });
});
