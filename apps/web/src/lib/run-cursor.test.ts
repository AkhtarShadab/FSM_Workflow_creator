import { describe, expect, it } from "vitest";
import {
  findLatestCursor,
  parseRunCursorEvent,
  resumeFromEvents,
  serializeRunCursor,
  type RunCursorPayload,
} from "./run-cursor";

const baseCursor: RunCursorPayload = {
  lastCompletedStateId: "S1",
  lastSignal: "::STATE.SUCCESS",
  nextStateId: "S2",
  attempt: 1,
  payloadRef: 'inline:{"ok":true}',
  updatedAt: "2026-08-17T12:00:00.000Z",
};

describe("R3 run cursor", () => {
  it("round-trips cursor from event list", () => {
    const event = serializeRunCursor("S1", {
      lastCompletedStateId: "S1",
      lastSignal: "::STATE.SUCCESS",
      nextStateId: "S2",
      attempt: 2,
      payloadRef: "hash:abc",
      updatedAt: "2026-08-17T12:00:00.000Z",
    });
    const parsed = parseRunCursorEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.payload.nextStateId).toBe("S2");
    expect(parsed?.payload.attempt).toBe(2);

    const events = [
      { kind: "state.output", stateId: "S1", payload: { ok: true } },
      event,
      serializeRunCursor("S2", {
        ...baseCursor,
        lastCompletedStateId: "S2",
        nextStateId: "S3",
        attempt: 1,
      }),
    ];
    const latest = findLatestCursor(events);
    expect(latest?.lastCompletedStateId).toBe("S2");
    expect(latest?.nextStateId).toBe("S3");
  });

  it("resume skips lastCompletedStateId and starts at nextStateId", () => {
    const events = [
      serializeRunCursor("S1", baseCursor),
    ];
    const resume = resumeFromEvents(events);
    expect(resume.from).toBe("S2");
    expect(resume.warning).toBeUndefined();
    expect(resume.cursor?.lastCompletedStateId).toBe("S1");
    expect(resume.from).not.toBe(resume.cursor?.lastCompletedStateId);
  });

  it("missing cursor resumes from START with warning flag", () => {
    const resume = resumeFromEvents([
      { kind: "state.output", stateId: "S1", payload: {} },
    ]);
    expect(resume.from).toBe("START");
    expect(resume.warning).toBe("resume_without_cursor");
    expect(resume.cursor).toBeUndefined();
  });
});
