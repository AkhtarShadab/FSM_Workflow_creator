import { NextResponse } from "next/server";
import type { PersistedRunEvent } from "@/lib/executors/types";
import {
  listRunEventsAfter,
  runSupervisor,
  subscribeToRun,
} from "@/lib/run-supervisor";
import {
  formatSseEvent,
  liveAfterReplay,
  parseSseAfterId,
} from "@/lib/sse-replay";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId: raw } = await context.params;
  const runId = Number(raw);
  if (!Number.isInteger(runId) || runId < 1) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const status = await runSupervisor.store.getRunStatus?.(runId);
  if (status == null) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const afterId = parseSseAfterId(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: PersistedRunEvent) => {
        controller.enqueue(encoder.encode(formatSseEvent(ev)));
      };

      let live = false;
      const liveBuffer: PersistedRunEvent[] = [];
      const unsub = subscribeToRun(runId, (ev) => {
        if (!live) {
          liveBuffer.push(ev);
          return;
        }
        try {
          send(ev);
        } catch {
          unsub();
        }
      });

      const close = () => {
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        const replay = await listRunEventsAfter(runId, afterId);
        live = true;
        for (const ev of replay) send(ev);
        for (const ev of liveAfterReplay(replay, liveBuffer)) send(ev);
        request.signal.addEventListener("abort", close, { once: true });
      } catch (err) {
        unsub();
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
