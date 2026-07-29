"use client";

import { useEffect, useRef, useState } from "react";
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
import { useRunStore } from "@/stores/run-store";

const MOCK_RUNS = [
  { id: "run_001", status: "succeeded", started: "2 hours ago", tokens: "12,431", duration: "1m 12s" },
  { id: "run_002", status: "failed", started: "5 hours ago", tokens: "4,102", duration: "23s" },
  { id: "run_003", status: "succeeded", started: "yesterday", tokens: "31,904", duration: "2m 48s" },
];

const SIM_SCRIPT = [
  { stateId: "S0", kind: "SCRIPT" as const, message: "::SCRIPT.NEXT — config hydrated" },
  { stateId: "S1", kind: "SCRIPT" as const, message: '::SCRIPT.NEXT|message="pages=12"', tokensIn: 0, tokensOut: 0, latencyMs: 812 },
  { stateId: "S2", kind: "AI" as const, message: "::AI.NEXT — summarized 12 pages", tokensIn: 4120, tokensOut: 733, latencyMs: 2341 },
  { stateId: "SF1", kind: "SYSTEM" as const, message: "::SYSTEM.DEHYDRATE — checkpoint cp_9f2" },
  { stateId: "S3", kind: "SCRIPT" as const, message: '::SCRIPT.NEXT|message="path=/out/report.md"', latencyMs: 144 },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    succeeded: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    failed: "border-red-400/40 bg-red-400/10 text-red-300",
    running: "border-sky-400/40 bg-sky-400/10 text-sky-300",
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

  const { live, events, start, stop, pushEvent, reset } = useRunStore();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      const event = SIM_SCRIPT[step % SIM_SCRIPT.length];
      pushEvent(event);
      setStep((s) => s + 1);
    }, 1400);
    return () => clearInterval(timer);
  }, [live, step, pushEvent]);

  const activeIdx = events.length > 0 ? (step - 1) % SIM_SCRIPT.length : -1;
  const totalIn = events.reduce((sum, e) => sum + (e.tokensIn ?? 0), 0);
  const totalOut = events.reduce((sum, e) => sum + (e.tokensOut ?? 0), 0);

  const nodes = [
    { ref: s0Ref, label: "S0", Icon: Play, color: "bg-[#d1fae5] border-[#8fdcb4] text-[#1e5c3f]" },
    { ref: s1Ref, label: "S1", Icon: SquareTerminal, color: "bg-[#dbeafe] border-[#a5c4f0] text-[#1e4a8a]" },
    { ref: s2Ref, label: "S2", Icon: Brain, color: "bg-[#fce7f3] border-[#f0b8d9] text-[#8a2a63]" },
  ];

  return (
    <div className="flex h-screen flex-col bg-background">
      <ProjectNav projectId={projectId} projectName={projectName} />

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
        {/* Run history */}
        <section className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80">
          <div className="border-b border-foreground/10 p-4">
            <h2 className="text-sm font-semibold text-foreground">Run history</h2>
            <p className="text-xs text-muted-foreground">Mock data — engine lands in Phase 3</p>
          </div>
          <ScrollArea className="flex-1">
            <ul className="divide-y divide-foreground/5">
              {MOCK_RUNS.map((run) => (
                <li key={run.id} className="flex items-center gap-4 p-4">
                  <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                  <StatusBadge status={run.status} />
                  <span className="ml-auto text-xs text-muted-foreground">{run.started}</span>
                  <span className="font-mono text-xs text-muted-foreground">{run.tokens} tok</span>
                  <span className="font-mono text-xs text-muted-foreground">{run.duration}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </section>

        {/* Live monitor — canvas beam animation (§10.2 AnimatedBeam) */}
        <section className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-background/80">
          <div className="flex items-center justify-between border-b border-foreground/10 p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Live monitor</h2>
              <p className="text-xs text-muted-foreground">AnimatedBeam over run events (SSE in Phase 3)</p>
            </div>
            {live ? (
              <Button
                size="sm"
                onClick={stop}
                className="gap-2 bg-red-500/20 text-red-200 hover:bg-red-500/30"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <PulsatingButton
                onClick={() => {
                  reset();
                  start();
                }}
                pulseColor="rgba(52,211,153,0.4)"
                className="h-8 gap-2 bg-emerald-500/20 px-3 text-xs text-emerald-200 hover:bg-emerald-500/30"
              >
                <Play className="h-3.5 w-3.5" />
                Simulate run
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
                  live && activeIdx === i && "outline-2 outline-dashed outline-offset-4 outline-[var(--ink)]"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="font-hand text-lg leading-none font-bold">{label}</span>
              </div>
            ))}
            <AnimatedBeam containerRef={containerRef} fromRef={s0Ref} toRef={s1Ref} gradientStartColor="#a8a29e" gradientStopColor="#78716c" duration={2} pathColor="var(--ink)" pathOpacity={0.25} />
            <AnimatedBeam containerRef={containerRef} fromRef={s1Ref} toRef={s2Ref} gradientStartColor="#a8a29e" gradientStopColor="#78716c" duration={2} pathColor="var(--ink)" pathOpacity={0.25} />
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="flex flex-col gap-2">
              {events.length === 0 && (
                <p className="py-8 text-center text-xs text-muted-foreground/70">
                  No events yet. Press “Simulate run” to stream mock RunEvents.
                </p>
              )}
              {events.map((e) => (
                <AnimatedListItem key={e.id}>
                  <div className="flex items-center gap-3 rounded-lg border border-foreground/5 bg-foreground/5 px-3 py-2">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-mono text-[10px] text-muted-foreground">{e.stateId}</span>
                    <span className="flex-1 truncate font-mono text-xs text-foreground/80">
                      {e.message}
                    </span>
                    {e.tokensIn != null && (
                      <span className="font-mono text-[10px] text-purple-300">
                        {e.tokensIn}→{e.tokensOut}
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
