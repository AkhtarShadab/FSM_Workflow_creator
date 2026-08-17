"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Layers, Play, Square, SquareTerminal } from "lucide-react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { AnimatedListItem } from "@/components/ui/animated-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { PulsatingButton } from "@/components/ui/pulsating-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProjectNav } from "@/components/nav/project-nav";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { useRunStore } from "@/stores/run-store";

const SSE_KINDS = [
  "state.start",
  "state.token",
  "state.output",
  "state.retry",
  "state.error",
  "state.transition",
  "human.awaiting",
  "human.resolved",
  "run.complete",
  "run.failed",
] as const;

const MOCK_RUNS = [
  {
    id: "run_001",
    status: "succeeded",
    started: "2 hours ago",
    tokens: "12,431",
    duration: "1m 12s",
  },
  {
    id: "run_002",
    status: "failed",
    started: "5 hours ago",
    tokens: "4,102",
    duration: "23s",
  },
  {
    id: "run_003",
    status: "succeeded",
    started: "yesterday",
    tokens: "31,904",
    duration: "2m 48s",
  },
];

type SseFrame = {
  id?: number;
  stateId?: string;
  kind?: string;
  payload?: unknown;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function formatLiveEvent(ev: SseFrame, kind: string): string {
  const p = asRecord(ev.payload);
  switch (kind) {
    case "state.start":
      return `start ${String(p.type ?? ev.stateId ?? "")}`.trim();
    case "state.output": {
      const bits = [`output ${String(p.signal ?? "")}`.trim()];
      if (ev.latencyMs != null) bits.push(`${ev.latencyMs}ms`);
      if (ev.tokensIn != null || ev.tokensOut != null) {
        bits.push(`tok ${ev.tokensIn ?? 0}/${ev.tokensOut ?? 0}`);
      }
      return bits.join(" · ");
    }
    case "state.retry":
      return `retry attempt=${String(p.attempt ?? "")} ${String(p.code ?? "")}`.trim();
    case "state.error":
      return `error ${String(p.code ?? p.message ?? p.error ?? "")}`.trim();
    case "state.transition":
      return `→ ${String(p.signal ?? "")}`;
    case "run.complete":
      return "run complete";
    case "run.failed":
      return `run failed ${String(p.code ?? p.error ?? "")}`.trim();
    default:
      return kind;
  }
}

function statusFromFrame(kind: string, payload: unknown): string | null {
  if (kind === "run.complete") return "succeeded";
  if (kind === "run.failed") {
    const code = asRecord(payload).code;
    return code === "CANCELLED" ? "cancelled" : "failed";
  }
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    succeeded: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    failed: "border-red-400/40 bg-red-400/10 text-red-300",
    running: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    cancelled: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px]", styles[status])}>
      {status}
    </Badge>
  );
}

export function RunsView({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const s0Ref = useRef<HTMLDivElement>(null);
  const s1Ref = useRef<HTMLDivElement>(null);
  const s2Ref = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const { live, runId, events, start, stop, pushEvent, reset } = useRunStore();
  const canvas = useCanvasStore((s) => s.canvases[projectId]);
  const [busy, setBusy] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  const totalIn = events.reduce((sum, e) => sum + (e.tokensIn ?? 0), 0);
  const totalOut = events.reduce((sum, e) => sum + (e.tokensOut ?? 0), 0);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const attachStream = useCallback(
    (id: number) => {
      closeStream();
      const es = new EventSource(`/api/runs/${id}/stream`);
      sourceRef.current = es;
      const onFrame = (kind: string, raw: MessageEvent<string>) => {
        let parsed: SseFrame = {};
        try {
          parsed = JSON.parse(raw.data) as SseFrame;
        } catch {
          parsed = {};
        }
        const eventKind = parsed.kind ?? kind;
        if (eventKind === "state.token") return;
        const status = statusFromFrame(eventKind, parsed.payload);
        if (status) {
          setLastStatus(status);
          stop();
          setBusy(false);
          if (eventKind === "run.complete" || eventKind === "run.failed") {
            es.close();
            if (sourceRef.current === es) sourceRef.current = null;
          }
        }
        pushEvent({
          id: parsed.id != null ? `sse_${parsed.id}` : undefined,
          stateId: parsed.stateId ?? "",
          kind: eventKind,
          message: formatLiveEvent(parsed, eventKind),
          tokensIn: parsed.tokensIn ?? undefined,
          tokensOut: parsed.tokensOut ?? undefined,
          latencyMs: parsed.latencyMs ?? undefined,
        });
      };
      for (const kind of SSE_KINDS) {
        es.addEventListener(kind, (ev) =>
          onFrame(kind, ev as MessageEvent<string>)
        );
      }
      es.onerror = () => {
        /* EventSource reconnects; terminal events close the socket */
      };
    },
    [closeStream, pushEvent, stop]
  );

  useEffect(() => () => closeStream(), [closeStream]);

  const runEngine = async () => {
    reset();
    closeStream();
    setBusy(true);
    setLastStatus("running");
    start();
    try {
      const nodes = canvas?.nodes ?? [];
      const edges = canvas?.edges ?? [];
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas: { nodes, edges } }),
      });
      const data = (await res.json()) as { runId?: number; error?: string };
      if (!res.ok || data.runId == null) {
        throw new Error(data.error ?? "Run failed");
      }
      start(data.runId);
      attachStream(data.runId);
    } catch (err) {
      setLastStatus("failed");
      pushEvent({
        stateId: "engine",
        kind: "run.failed",
        message: err instanceof Error ? err.message : "Run failed",
      });
      stop();
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    const id = useRunStore.getState().runId;
    if (id == null) {
      stop();
      setBusy(false);
      return;
    }
    try {
      await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
    } catch {
      stop();
      setBusy(false);
    }
  };

  const nodes = [
    {
      ref: s0Ref,
      label: "S0",
      Icon: Play,
      color: "bg-[#d1fae5] border-[#8fdcb4] text-[#1e5c3f]",
    },
    {
      ref: s1Ref,
      label: "S1",
      Icon: SquareTerminal,
      color: "bg-[#dbeafe] border-[#a5c4f0] text-[#1e4a8a]",
    },
    {
      ref: s2Ref,
      label: "S2",
      Icon: Brain,
      color: "bg-[#fce7f3] border-[#f0b8d9] text-[#8a2a63]",
    },
  ];

  return (
    <div className="flex h-screen flex-col bg-background">
      <ProjectNav projectId={projectId} projectName={projectName} />

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
        <section className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80">
          <div className="border-b border-foreground/10 p-4">
            <h2 className="text-sm font-semibold text-foreground">Run history</h2>
            <p className="text-xs text-muted-foreground">
              Recent local samples — live runs use @fsm/engine
            </p>
          </div>
          <ScrollArea className="flex-1">
            <ul className="divide-y divide-foreground/5">
              {MOCK_RUNS.map((run) => (
                <li key={run.id} className="flex items-center gap-4 p-4">
                  <span className="font-mono text-xs text-muted-foreground">
                    {run.id}
                  </span>
                  <StatusBadge status={run.status} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {run.started}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {run.tokens} tok
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {run.duration}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </section>

        <section className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80">
          <div className="flex items-center justify-between border-b border-foreground/10 p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Live monitor
              </h2>
              <p className="text-xs text-muted-foreground">
                SSE /api/runs/[id]/stream
                {runId != null ? ` · run ${runId}` : ""}
                {lastStatus ? ` · last: ${lastStatus}` : ""}
              </p>
            </div>
            {busy || live ? (
              <Button
                size="sm"
                data-testid="run-cancel"
                onClick={cancelRun}
                className="gap-2 bg-red-500/20 text-red-200 hover:bg-red-500/30"
              >
                <Square className="h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : (
              <PulsatingButton
                onClick={runEngine}
                pulseColor="rgba(52,211,153,0.4)"
                className="h-8 gap-2 bg-emerald-500/20 px-3 text-xs text-emerald-200 hover:bg-emerald-500/30"
                data-testid="run-engine"
              >
                <Play className="h-3.5 w-3.5" />
                Run engine
              </PulsatingButton>
            )}
          </div>

          <div className="grid grid-cols-3 gap-px border-b border-foreground/10 bg-foreground/5">
            {[
              { value: events.length, label: "events", color: "text-sky-400" },
              { value: totalIn, label: "tokens in", color: "text-[#A07CFE]" },
              { value: totalOut, label: "tokens out", color: "text-emerald-400" },
            ].map(({ value, label, color }) => (
              <div key={label} className="bg-background px-4 py-2 text-center">
                <NumberTicker
                  value={value}
                  className={cn("text-lg font-bold", color)}
                />
                <p className="text-[9px] tracking-widest text-muted-foreground uppercase">
                  {label}
                </p>
              </div>
            ))}
          </div>

          <div
            ref={containerRef}
            className="relative flex items-center justify-around border-b border-foreground/10 py-10"
          >
            {nodes.map(({ ref, label, Icon, color }, i) => (
              <div
                key={label}
                ref={ref}
                className={cn(
                  "z-10 flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-[4px] border-2 shadow-[2px_3px_0_rgba(0,0,0,0.08)]",
                  i % 2 === 0 ? "-rotate-[1.2deg]" : "rotate-[1deg]",
                  color,
                  live &&
                    "outline-2 outline-dashed outline-offset-4 outline-[var(--ink)]"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="font-hand text-lg leading-none font-bold">
                  {label}
                </span>
              </div>
            ))}
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={s0Ref}
              toRef={s1Ref}
              gradientStartColor="#a8a29e"
              gradientStopColor="#78716c"
              duration={2}
              pathColor="var(--ink)"
              pathOpacity={0.25}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={s1Ref}
              toRef={s2Ref}
              gradientStartColor="#a8a29e"
              gradientStopColor="#78716c"
              duration={2}
              pathColor="var(--ink)"
              pathOpacity={0.25}
            />
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="flex flex-col gap-2" data-testid="run-events">
              {events.length === 0 && (
                <p className="py-8 text-center text-xs text-muted-foreground/70">
                  No events yet. Press “Run engine” to execute the canvas FSM.
                </p>
              )}
              {events.map((e) => (
                <AnimatedListItem key={e.id}>
                  <div className="flex items-center gap-3 rounded-lg border border-foreground/5 bg-foreground/5 px-3 py-2">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {e.stateId}
                    </span>
                    <span className="font-mono text-[10px] text-sky-300/80">
                      {e.kind}
                    </span>
                    <span className="flex-1 truncate font-mono text-xs text-foreground/80">
                      {e.message}
                    </span>
                    {e.latencyMs != null && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {e.latencyMs}ms
                      </span>
                    )}
                  </div>
                </AnimatedListItem>
              ))}
            </div>
          </ScrollArea>
        </section>
      </main>
    </div>
  );
}
