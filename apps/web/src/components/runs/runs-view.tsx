"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Layers, Play, Square, SquareTerminal } from "lucide-react";
import { getRunEvents, listRuns } from "@/app/project/[id]/runs/actions";
import type { RunEventRow, RunHistoryRow } from "@/lib/run-history";
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

const HISTORY_LIMIT = 50;

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    succeeded: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    failed: "border-red-400/40 bg-red-400/10 text-red-300",
    running: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    pending: "border-foreground/20 bg-foreground/5 text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px]", styles[status] ?? styles.pending)}>
      {status}
    </Badge>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatStarted(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function formatTokens(run: RunHistoryRow): string {
  const total = (run.tokensIn ?? 0) + (run.tokensOut ?? 0);
  if (!total) return "—";
  return `${total.toLocaleString()} tok`;
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

  const { live, events, start, stop, pushEvent, reset } = useRunStore();
  const canvas = useCanvasStore((s) => s.canvases[projectId]);
  const [busy, setBusy] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  const [history, setHistory] = useState<RunHistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [historyEvents, setHistoryEvents] = useState<RunEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const totalIn = events.reduce((sum, e) => sum + (e.tokensIn ?? 0), 0);
  const totalOut = events.reduce((sum, e) => sum + (e.tokensOut ?? 0), 0);

  const refreshHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const rows = await listRuns(Number(projectId), HISTORY_LIMIT);
      setHistory(rows);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setHistoryLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setHistoryLoading(true);
    void refreshHistory();
  }, [refreshHistory]);

  const openRunEvents = async (runId: number) => {
    if (selectedRunId === runId) {
      setSelectedRunId(null);
      setHistoryEvents([]);
      setEventsError(null);
      return;
    }
    setSelectedRunId(runId);
    setEventsLoading(true);
    setEventsError(null);
    try {
      const rows = await getRunEvents(runId);
      setHistoryEvents(rows);
    } catch (err) {
      setHistoryEvents([]);
      setEventsError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setEventsLoading(false);
    }
  };

  const runEngine = async () => {
    reset();
    setBusy(true);
    setLastStatus(null);
    start();
    try {
      const nodes = canvas?.nodes ?? [];
      const edges = canvas?.edges ?? [];
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas: { nodes, edges } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed");
      setLastStatus(data.status);
      for (const ev of data.events ?? []) {
        pushEvent({
          stateId: ev.stateId,
          kind: (ev.kind as "SCRIPT" | "AI" | "SYSTEM" | "SPAWN") || "SCRIPT",
          message: ev.message,
        });
      }
    } catch (err) {
      setLastStatus("failed");
      pushEvent({
        stateId: "engine",
        kind: "SYSTEM",
        message: err instanceof Error ? err.message : "Run failed",
      });
    } finally {
      stop();
      setBusy(false);
      void refreshHistory();
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
              Published versions from this project — click a run to inspect events
            </p>
          </div>
          <ScrollArea className="flex-1">
            {historyError ? (
              <p
                className="p-4 text-xs text-red-400"
                data-testid="run-history-error"
              >
                {historyError}
              </p>
            ) : null}
            {historyLoading ? (
              <p className="p-4 text-xs text-muted-foreground">Loading runs…</p>
            ) : history.length === 0 ? (
              <p
                className="py-8 text-center text-xs text-muted-foreground/70"
                data-testid="run-history-empty"
              >
                No runs yet. Publish a version and press “Run engine”.
              </p>
            ) : (
              <ul className="divide-y divide-foreground/5" data-testid="run-history-list">
                {history.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      data-testid="run-history-row"
                      data-run-id={run.id}
                      data-status={run.status}
                      data-version={run.version}
                      onClick={() => void openRunEvents(run.id)}
                      className={cn(
                        "flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-foreground/5",
                        selectedRunId === run.id && "bg-foreground/5"
                      )}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        run_{run.id}
                      </span>
                      <StatusBadge status={run.status} />
                      <span
                        data-testid="run-history-version"
                        className="font-mono text-xs text-muted-foreground"
                      >
                        v{run.version}
                      </span>
                      <span
                        data-testid="run-history-started"
                        className="ml-auto text-xs text-muted-foreground"
                      >
                        {formatStarted(run.startedAt)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTokens(run)}
                      </span>
                      <span
                        data-testid="run-history-duration"
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {formatDuration(run.durationMs)}
                      </span>
                    </button>
                    {selectedRunId === run.id ? (
                      <div
                        className="border-t border-foreground/5 bg-foreground/[0.03] px-4 py-3"
                        data-testid="run-history-events"
                      >
                        {eventsLoading ? (
                          <p className="text-xs text-muted-foreground">Loading events…</p>
                        ) : eventsError ? (
                          <p className="text-xs text-red-400">{eventsError}</p>
                        ) : historyEvents.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No events recorded.</p>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {historyEvents.map((ev) => (
                              <li
                                key={ev.id}
                                data-testid="run-history-event"
                                className="flex items-center gap-3 rounded-lg border border-foreground/5 bg-background/60 px-3 py-2"
                              >
                                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {ev.stateId}
                                </span>
                                <span className="text-[10px] tracking-wider text-muted-foreground uppercase">
                                  {ev.kind}
                                </span>
                                <span className="flex-1 truncate font-mono text-xs text-foreground/80">
                                  {ev.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </section>

        <section className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80">
          <div className="flex items-center justify-between border-b border-foreground/10 p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Live monitor
              </h2>
              <p className="text-xs text-muted-foreground">
                Engine run from canvas (stub executors for AI/HTTP)
                {lastStatus ? ` · last: ${lastStatus}` : ""}
              </p>
            </div>
            {busy || live ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={stop}
                className="gap-2 bg-red-500/20 text-red-200 hover:bg-red-500/30"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
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
                    <span className="flex-1 truncate font-mono text-xs text-foreground/80">
                      {e.message}
                    </span>
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
