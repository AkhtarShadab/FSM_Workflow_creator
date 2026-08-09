"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "@/components/theme-provider";
import {
  ArrowLeft,
  Brain,
  Database,
  FileText,
  GitBranch,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ModeToggle } from "@/components/mode-toggle";
import { ScriptEdge } from "@/components/canvas/script-edge";
import { PencilDefs } from "@/components/canvas/pencil-defs";
import { cn } from "@/lib/utils";
import { addMemoryEdge, addMemoryNode, seedMemoryGraph } from "@/app/memory/actions";
import type { MemoryEdge as MemoryEdgeRow, MemoryNode as MemoryNodeRow } from "@/db/schema";

const KIND_STYLES: Record<
  MemoryNodeRow["kind"],
  { note: string; border: string; text: string; Icon: typeof Brain; label: string }
> = {
  fact: { note: "bg-[#dbeafe]", border: "border-[#a5c4f0]", text: "text-[#1e4a8a]", Icon: Brain, label: "Fact" },
  artifact: { note: "bg-[#fef3c7]", border: "border-[#e8d189]", text: "text-[#7a5410]", Icon: FileText, label: "Artifact" },
  preference: { note: "bg-[#fce7f3]", border: "border-[#f0b8d9]", text: "text-[#8a2a63]", Icon: Settings2, label: "Preference" },
  checkpoint_ref: { note: "bg-[#ede9fe]", border: "border-[#c9b8f5]", text: "text-[#5b3ea8]", Icon: Database, label: "Checkpoint" },
};

type MemoNote = Node<{ label: string; kind: MemoryNodeRow["kind"] }, "memoNote">;

function MemoNoteNode({ data }: NodeProps<MemoNote>) {
  const s = KIND_STYLES[data.kind];
  return (
    <div
      className={cn(
        "relative w-[150px] rounded-[4px] border-2 px-2.5 pt-4 pb-2 shadow-[2px_3px_0_rgba(0,0,0,0.08)]",
        s.note,
        s.border
      )}
    >
      <div className={cn("absolute -top-2 left-1/2 h-4 w-10 -translate-x-1/2 -rotate-[3deg] rounded-[2px] opacity-60", s.note, s.border, "border")} />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
      <div className={cn("flex items-center gap-1", s.text)}>
        <s.Icon className="h-3 w-3" />
        <span className="text-[8px] font-bold tracking-[0.14em] uppercase">{s.label}</span>
      </div>
      <p className={cn("font-hand mt-0.5 text-lg leading-[1.05] font-bold break-words", s.text)}>
        {data.label}
      </p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
    </div>
  );
}

const nodeTypes = { memoNote: MemoNoteNode };
const edgeTypes = { script: ScriptEdge };

function MemoryView({
  nodes: dbNodes,
  edges: dbEdges,
}: {
  nodes: MemoryNodeRow[];
  edges: MemoryEdgeRow[];
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<MemoryNodeRow["kind"]>("fact");
  const [content, setContent] = useState("");
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [relation, setRelation] = useState<MemoryEdgeRow["relation"]>("references");

  const { nodes, edges } = useMemo(() => {
    // Circle layout — memory graphs are small; a ring reads well
    const cx = 420;
    const cy = 300;
    const r = Math.max(180, dbNodes.length * 42);
    const nodes: MemoNote[] = dbNodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(dbNodes.length, 1) - Math.PI / 2;
      return {
        id: String(n.id),
        type: "memoNote" as const,
        position: {
          x: cx + r * Math.cos(angle) - 75,
          y: cy + r * Math.sin(angle) - 40,
        },
        data: { label: n.label, kind: n.kind },
      };
    });
    const edges = dbEdges.map((e) => ({
      id: `me-${e.id}`,
      source: String(e.sourceId),
      target: String(e.targetId),
      type: "script" as const,
      data: { signal: e.relation },
      label: e.relation,
    }));
    return { nodes, edges };
  }, [dbNodes, dbEdges]);

  const submitNode = () => {
    if (!label.trim()) return;
    startTransition(async () => {
      await addMemoryNode({ label, kind, content });
      setLabel("");
      setContent("");
    });
  };

  const submitEdge = () => {
    if (!fromId || !toId) return;
    startTransition(async () => {
      await addMemoryEdge({
        sourceId: Number(fromId),
        targetId: Number(toId),
        relation,
      });
      setFromId("");
      setToId("");
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)] lg:h-screen">
      <header className="relative flex h-14 shrink-0 items-center gap-4 border-b-2 border-[var(--ink)]/10 bg-background/90 px-4 backdrop-blur-sm">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <h1 className="font-hand text-2xl leading-none font-bold text-foreground">
          Memory graph
        </h1>
        <span className="ml-2 rounded-full border border-[var(--ink)]/20 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Turso · graph-organized
        </span>
        <div className="ml-auto">
          <ModeToggle />
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_340px]">
        {/* Graph canvas */}
        <section className="relative min-h-[420px]">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={dark ? "dark" : "light"}
              fitView
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              className="bg-[var(--paper)]"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1.6}
                color={dark ? "rgba(214,211,209,0.16)" : "rgba(87,83,78,0.22)"}
              />
              <Controls className="!border-[var(--ink)]/20 !bg-[var(--paper)] [&_button]:!border-[var(--ink)]/15 [&_button]:!bg-[var(--paper)] [&_button]:!fill-[var(--ink)]" />
            </ReactFlow>
            <PencilDefs />
          </ReactFlowProvider>

          {dbNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <GitBranch className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No memories yet — seed a demo graph to see the view.
              </p>
              <Button
                onClick={() => startTransition(async () => seedMemoryGraph())}
                disabled={pending}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Seed demo graph
              </Button>
            </div>
          )}
        </section>

        {/* Side panel */}
        <aside className="flex flex-col gap-4 border-t-2 border-[var(--ink)]/10 p-4 lg:border-t-0 lg:border-l-2">
          <div className="rounded-xl border-2 border-[var(--ink)]/15 bg-background p-4 shadow-[3px_4px_0_rgba(0,0,0,0.06)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Plus className="h-4 w-4" /> Add memory
            </h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Label</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="User prefers terse output"
                  className="h-8 border-foreground/10 bg-foreground/5 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Kind</Label>
                <Select value={kind} onValueChange={(v) => v && setKind(v as MemoryNodeRow["kind"])}>
                  <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-popover-foreground">
                    {Object.entries(KIND_STYLES).map(([k, s]) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Content</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[64px] border-foreground/10 bg-foreground/5 text-xs"
                />
              </div>
              <Button
                onClick={submitNode}
                disabled={pending || !label.trim()}
                className="w-full bg-foreground text-background hover:bg-foreground/90"
              >
                Pin to graph
              </Button>
            </div>
          </div>

          <div className="rounded-xl border-2 border-[var(--ink)]/15 bg-background p-4 shadow-[3px_4px_0_rgba(0,0,0,0.06)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <GitBranch className="h-4 w-4" /> Wire two memories
            </h2>
            <div className="space-y-3">
              {[
                { value: fromId, set: setFromId, placeholder: "From…" },
                { value: toId, set: setToId, placeholder: "To…" },
              ].map(({ value, set, placeholder }, i) => (
                <Select key={i} value={value} onValueChange={(v) => v && set(v)}>
                  <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 text-xs">
                    <SelectValue placeholder={placeholder} />
                  </SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-popover text-popover-foreground">
                    {dbNodes.map((n) => (
                      <SelectItem key={n.id} value={String(n.id)} className="text-xs">
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
              <Select value={relation} onValueChange={(v) => v && setRelation(v as MemoryEdgeRow["relation"])}>
                <SelectTrigger className="h-8 border-foreground/10 bg-foreground/5 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-foreground/10 bg-popover text-popover-foreground">
                  {["derived_from", "summarizes", "prefers", "references"].map((r) => (
                    <SelectItem key={r} value={r} className="font-mono text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={submitEdge}
                disabled={pending || !fromId || !toId}
                variant="outline"
                className="w-full border-foreground/20"
              >
                Draw pencil wire
              </Button>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            §5.3 — nodes are memory units (fact · artifact · preference ·
            checkpoint_ref); wires are typed relations. State 0 hydration reads the
            top-N subgraph; System Functions append `summarizes` edges after
            dehydration.
          </p>
        </aside>
      </main>
    </div>
  );
}

export default MemoryView;
