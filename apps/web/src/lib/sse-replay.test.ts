import { describe, expect, it } from "vitest";
import {
  formatSseEvent,
  liveAfterReplay,
  parseSseAfterId,
  replayAfter,
} from "./sse-replay";

describe("SSE replay helper", () => {
  const events = [
    { id: 1, kind: "state.start" },
    { id: 2, kind: "state.output" },
    { id: 3, kind: "state.transition" },
    { id: 4, kind: "run.complete" },
  ];

  it("returns only events with id > afterId", () => {
    expect(replayAfter(events, 2).map((e) => e.id)).toEqual([3, 4]);
    expect(replayAfter(events, 0).map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(replayAfter(events, 4)).toEqual([]);
  });

  it("reads Last-Event-ID and afterId query", () => {
    expect(
      parseSseAfterId({
        url: "http://localhost/api/runs/1/stream",
        headers: new Headers({ "Last-Event-ID": "7" }),
      })
    ).toBe(7);
    expect(
      parseSseAfterId({
        url: "http://localhost/api/runs/1/stream?afterId=4",
        headers: new Headers(),
      })
    ).toBe(4);
    expect(
      parseSseAfterId({
        url: "http://localhost/api/runs/1/stream?afterId=9",
        headers: new Headers({ "Last-Event-ID": "1" }),
      })
    ).toBe(9);
  });

  it("drops live duplicates already covered by replay", () => {
    const replayed = replayAfter(events, 1);
    const live = [
      { id: 2, kind: "state.output" },
      { id: 3, kind: "state.transition" },
      { id: 5, kind: "run.complete" },
    ];
    expect(liveAfterReplay(replayed, live).map((e) => e.id)).toEqual([5]);
  });

  it("formats SSE frames with the persisted id", () => {
    const frame = formatSseEvent({
      id: 12,
      kind: "state.output",
    });
    expect(frame).toContain("id: 12\n");
    expect(frame).toContain("event: state.output\n");
    expect(frame).toContain('data: {"id":12');
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});
