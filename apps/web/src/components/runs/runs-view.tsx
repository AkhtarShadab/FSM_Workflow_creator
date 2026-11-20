"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Layers, Play, RefreshCw, Square } from "lucide-react";
import { AnimatedListItem } from "@/components/ui/animated-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { PulsatingButton } from "@/components/ui/pulsating-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProjectNav } from "@/components/nav/project-nav";
import { cn } from "@/lib/utils";
import { STATE_COLORS, type FSMStateType } from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";
import { detectTemplate, type SignalOverrides } from "@/lib/templates";
import { normalizeEdgeData } from "@/lib/fsm-types";
import { useRunStore } from "@/stores/run-store";

interface RunEventDto {
  stateId: string;
  kind: string;
  message: string;
}

interface RunDto {
  id: number;
  status: string;
  startedAt: number | null;
  endedAt: number | null;
  events: RunEventDto[];
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    succeeded: "border-emerald-400/40 bg-emerald-400/10 text-emerald-500 dark:text-emerald-300",
    failed: "border-red-400/40 bg-red-400/10 text-red-500 dark:text-red-300",
    running: "border-sky-400/40 bg-sky-400/10 text-sky-500 dark:text-sky-300",
    cancelled: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px]", styles[status])}>
      {status}
    </Badge>
  );
}

function relativeTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleDateString();
}

function duration(run: RunDto): string {
  if (!run.startedAt || !run.endedAt) return "—";
  const s = Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface PathStep {
  stateId: string;
  /** consecutive visits (self-loop retries) */
  times: number;
}

/** States a run entered, in order; self-loop repeats collapse to "×n". */
function visitedPath(events: RunEventDto[]): PathStep[] {
  const path: PathStep[] = [];
  for (const e of events) {
    if (!e.message.startsWith("enter ")) continue;
    const last = path[path.length - 1];
    if (last?.stateId === e.stateId) last.times += 1;
    else path.push({ stateId: e.stateId, times: 1 });
  }
  return path;
}

const ERROR_ROUTE = /\.ERROR|VALIDATION_ERROR|HALT|REJECT|TIMEOUT/;

/** Last signal a state emitted (from "ok attempts=1 → ::X.Y" events). */
function lastEmittedSignal(events: RunEventDto[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i].message.match(/→ (::[A-Z0-9_]+\.[A-Z0-9_]+)/);
    if (m) return m[1];
  }
  return null;
}

export function RunsView({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { live, events, start, stop, pushEvent, replaceEvents, reset } = useRunStore();
  const canvas = useCanvasStore((s) => s.canvases[projectId]);
  const [busy, setBusy] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<RunDto[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [path, setPath] = useState<PathStep[]>([]);
  const [lastSignal, setLastSignal] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scenarioId, setScenarioId] = useState("default");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [lastFinal, setLastFinal] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastScenarioId, setLastScenarioId] = useState<string | null>(null);

  const template = useMemo(() => detectTemplate(canvas), [canvas]);
  const scenarios = template?.scenarios ?? [];
  const activeScenario = scenarios.find((x) => x.id === scenarioId);

  /** States with ≥2 outgoing signals — the branches a dry run can steer. */
  const branchStates = useMemo(() => {
    const nodes = canvas?.nodes ?? [];
    const edges = canvas?.edges ?? [];
    return nodes
      .map((n) => ({
        node: n,
        signals: [
          ...new Set(
            edges
              .filter((e) => e.source === n.id)
              .map((e) => normalizeEdgeData(e.data, e.source, e.target))
              .filter((d) => d.kind !== "router")
              .map((d) => d.signal)
          ),
        ],
      }))
      .filter((b) => b.signals.length >= 2);
  }, [canvas]);

  const currentOverrides = (): SignalOverrides => {
    if (activeScenario) return activeScenario.overrides;
    if (scenarioId !== "custom") return {};
    return Object.fromEntries(
      Object.entries(custom)
        .filter(([, sig]) => sig)
        .map(([id, sig]) => [id, [sig]])
    );
  };

  const totalIn = events.reduce((sum, e) => sum + (e.tokensIn ?? 0), 0);
  const totalOut = events.reduce((sum, e) => sum + (e.tokensOut ?? 0), 0);

  const nodeById = useMemo(
    () => new Map((canvas?.nodes ?? []).map((n) => [n.id, n])),
    [canvas?.nodes]
  );

  const showEvents = useCallback(
    (list: RunEventDto[]) => {
      replaceEvents(
        list.map((ev) => ({
          stateId: ev.stateId,
          kind: (ev.kind as "SCRIPT" | "AI" | "SYSTEM" | "SPAWN") || "SCRIPT",
          message: ev.message,
        }))
      );
      setPath(visitedPath(list));
      setLastSignal(lastEmittedSignal(list));
    },
    [replaceEvents]
  );

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs?limit=25`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setHistory(data.runs ?? []);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoadingHistory(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Initial fetch of persisted run history (state is set after the await).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
    return () => abortRef.current?.abort();
  }, [loadHistory]);

  const runEngine = async () => {
    setLastFinal(null);
    setLastError(null);
    setLastScenarioId(null);
    reset();
    setPath([]);
    setLastSignal(null);
    setSelectedRunId(null);
    setBusy(true);
    setLastStatus(null);
    start();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const nodes = canvas?.nodes ?? [];
      const edges = canvas?.edges ?? [];
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas: { nodes, edges }, overrides: currentOverrides() }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed");
      setLastStatus(data.status);
      setLastFinal(data.finalStateId ?? null);
      setLastError(data.error ?? null);
      setLastScenarioId(activeScenario?.id ?? null);
      setSelectedRunId(data.runId ?? null);
      const list: RunEventDto[] = [...(data.events ?? [])];
      // Engine failures (no allowlisted edge, self-loop cap, …) come back as
      // `error` with HTTP 200 — show them instead of a silent "failed".
      if (data.error) {
        list.push({ stateId: "engine", kind: "SYSTEM", message: `error: ${data.error}` });
      }
      showEvents(list);
    } catch (err) {
      const aborted = controller.signal.aborted;
      setLastStatus(aborted ? "cancelled" : "failed");
      pushEvent({
        stateId: "engine",
        kind: "SYSTEM",
        message: aborted
          ? "Stopped by user (the server may still finish recording the run)"
          : err instanceof Error
            ? err.message
            : "Run failed",
      });
    } finally {
      abortRef.current = null;
      stop();
      setBusy(false);
      void loadHistory();
    }
  };

  const stopRun = () => abortRef.current?.abort();

  const lastScenario = scenarios.find((x) => x.id === lastScenarioId);
  const expectationMet =
    lastScenario && lastStatus
      ? lastStatus === lastScenario.expect.status &&
        (!lastScenario.expect.finalStateId || lastFinal === lastScenario.expect.finalStateId) &&
        (!lastScenario.expect.errorIncludes ||
          (lastError ?? "").includes(lastScenario.expect.errorIncludes))
      : null;
  // An END reached through an error / reject / timeout edge is a handled
  // failure (e.g. "Escalation hold"), not a happy-path finish.
  const endedViaErrorRoute = Boolean(lastSignal && ERROR_ROUTE.test(lastSignal));
  const finalLabel = lastFinal ? (nodeById.get(lastFinal)?.data.label ?? lastFinal) : null;

  const selectRun = (run: RunDto) => {
    setLastScenarioId(null);
    setLastFinal(null);
    setLastError(null);
    setSelectedRunId(run.id);
    setLastStatus(run.status);
    showEvents(run.events);
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      <ProjectNav projectId={projectId} projectName={projectName} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4 lg:grid-cols-2 lg:overflow-hidden">
        <section className="flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80 lg:min-h-0">
          <div className="flex items-start justify-between gap-2 border-b border-foreground/10 p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Run history</h2>
              <p className="text-xs text-muted-foreground">
                Persisted runs for this project — click one to replay its events
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Refresh"
              aria-label="Refresh run history"
              onClick={() => void loadHistory()}
              disabled={loadingHistory}
            >
              <RefreshCw className={cn("h-4 w-4", loadingHistory && "animate-spin")} />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {historyError && (
              <p className="p-4 text-xs text-red-500 dark:text-red-300">{historyError}</p>
            )}
            {!historyError && history.length === 0 && !loadingHistory && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No runs yet. Press “Run engine” to execute the canvas.
              </p>
            )}
            <ul className="divide-y divide-foreground/5" data-testid="run-history">
              {history.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => selectRun(run)}
                    className={cn(
                      "flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left transition-colors hover:bg-foreground/5",
                      selectedRunId === run.id && "bg-foreground/[0.07]"
                    )}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      run_{String(run.id).padStart(3, "0")}
                    </span>
                    <StatusBadge status={run.status} />
                    <span className="ml-auto text-xs text-muted-foreground">
                      {relativeTime(run.startedAt)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {run.events.length} ev
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {duration(run)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </section>

        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80 lg:min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 p-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Live monitor</h2>
              <p className="text-xs text-muted-foreground">
                Engine run from canvas (stub executors for AI/HTTP)
                {lastStatus ? ` · last: ${lastStatus}` : ""}
              </p>
            </div>
            {busy || live ? (
              <Button
                size="sm"
                onClick={stopRun}
                className="gap-2 bg-red-500/20 text-red-600 hover:bg-red-500/30 dark:text-red-200"
                data-testid="run-stop"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <PulsatingButton
                onClick={runEngine}
                pulseColor="rgba(52,211,153,0.4)"
                className="h-8 shrink-0 gap-2 bg-emerald-500/20 px-3 text-xs whitespace-nowrap text-emerald-700 hover:bg-emerald-500/30 dark:text-emerald-200"
                data-testid="run-engine"
              >
                <span className="flex items-center gap-2">
                  <Play className="h-3.5 w-3.5" />
                  Run engine
                </span>
              </PulsatingButton>
            )}
          </div>

          <div className="space-y-2 border-b border-foreground/10 p-4" data-testid="run-scenario">
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Scenario</span>
              <select
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
                disabled={busy}
                className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/5 px-2 text-xs text-foreground"
                data-testid="run-scenario-select"
              >
                <option value="default">Default: every state succeeds</option>
                {scenarios.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
                {branchStates.length > 0 && <option value="custom">Custom branches…</option>}
              </select>
            </label>
            {activeScenario && (
              <p className="text-xs text-muted-foreground">
                {activeScenario.description}{" "}
                <span className="text-foreground/70">
                  Expect: {activeScenario.expect.status}
                  {activeScenario.expect.finalStateId
                    ? ` at “${nodeById.get(activeScenario.expect.finalStateId)?.data.label ?? activeScenario.expect.finalStateId}”`
                    : ""}
                </span>
              </p>
            )}
            {scenarioId === "custom" && (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {branchStates.map(({ node, signals }) => (
                  <label key={node.id} className="flex min-w-0 items-center gap-2 text-[11px]">
                    <span className="w-28 shrink-0 truncate text-muted-foreground" title={node.data.label}>
                      {node.data.label}
                    </span>
                    <select
                      value={custom[node.id] ?? ""}
                      onChange={(e) => setCustom((c) => ({ ...c, [node.id]: e.target.value }))}
                      className="h-7 min-w-0 flex-1 rounded border border-foreground/10 bg-foreground/5 px-1 font-mono text-[10px] text-foreground"
                    >
                      <option value="">default</option>
                      {signals.map((sig) => (
                        <option key={sig} value={sig}>
                          {sig}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <p className="text-[10px] text-muted-foreground sm:col-span-2">
                  Applies to each state&apos;s first visit; later visits use the default success signal.
                </p>
              </div>
            )}
            {lastStatus && !busy && (finalLabel || lastError) && (
              <p
                className={cn(
                  "rounded-md px-2 py-1 text-xs",
                  lastStatus !== "succeeded"
                    ? "bg-red-500/10 text-red-700 dark:text-red-300"
                    : endedViaErrorRoute
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                )}
                data-testid="run-outcome"
              >
                {lastStatus === "succeeded"
                  ? `${endedViaErrorRoute ? "Routed to" : "Reached"} “${finalLabel}”${lastSignal ? ` via ${lastSignal}` : ""}`
                  : `Failed: ${lastError}`}
                {expectationMet != null && (
                  <span className="ml-2 font-semibold">
                    {expectationMet ? "✓ as expected" : "✗ unexpected outcome"}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-px border-b border-foreground/10 bg-foreground/5">
            {[
              { value: events.length, label: "events", color: "text-sky-500 dark:text-sky-400" },
              { value: totalIn, label: "tokens in", color: "text-[#A07CFE]" },
              { value: totalOut, label: "tokens out", color: "text-emerald-500 dark:text-emerald-400" },
            ].map(({ value, label, color }) => (
              <div key={label} className="bg-background px-2 py-2 text-center sm:px-4">
                <NumberTicker value={value} className={cn("text-lg font-bold", color)} />
                <p className="text-[9px] tracking-widest text-muted-foreground uppercase">
                  {label}
                </p>
              </div>
            ))}
          </div>

          {/* Visited path of the shown run (was a hard-coded S0→S1→S2 demo) */}
          <div
            className="flex min-h-[96px] flex-wrap items-center justify-center gap-2 border-b border-foreground/10 px-3 py-5"
            data-testid="run-path"
          >
            {path.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">
                {busy ? "Running…" : "The state path of the selected run appears here."}
              </p>
            ) : (
              path.map(({ stateId, times }, i) => {
                const node = nodeById.get(stateId);
                const type = (node?.data.stateType ?? "SCRIPT") as FSMStateType;
                const colors = STATE_COLORS[type] ?? STATE_COLORS.SCRIPT;
                return (
                  <Fragment key={`${stateId}-${i}`}>
                    {i > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span
                      title={stateId}
                      className={cn(
                        "max-w-[9rem] truncate rounded-[4px] border-2 px-2 py-1 text-xs font-semibold shadow-[2px_3px_0_rgba(0,0,0,0.08)]",
                        colors.note,
                        colors.border,
                        colors.text
                      )}
                    >
                      {node?.data.label ?? stateId}
                      {times > 1 && (
                        <span className="ml-1 rounded bg-black/10 px-1 text-[10px]" title="self-loop retries">
                          ×{times}
                        </span>
                      )}
                    </span>
                  </Fragment>
                );
              })
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1 p-4">
            <div className="flex flex-col gap-2" data-testid="run-events">
              {events.length === 0 && (
                <p className="py-8 text-center text-xs text-muted-foreground/70">
                  No events yet. Press “Run engine” to execute the canvas FSM.
                </p>
              )}
              {events.map((e) => (
                <AnimatedListItem key={e.id}>
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-foreground/5 bg-foreground/5 px-3 py-2",
                      e.message.startsWith("error") && "border-red-400/30 bg-red-400/10"
                    )}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-[35%] truncate font-mono text-[10px] text-muted-foreground">
                      {nodeById.get(e.stateId)?.data.label ?? e.stateId}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80" title={e.message}>
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
