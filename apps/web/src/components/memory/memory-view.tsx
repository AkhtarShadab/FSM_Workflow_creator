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
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "@/components/theme-provider";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Database,
  FileCode2,
  FileText,
  Folder,
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
import {
  addMemoryEdge,
  addMemoryNode,
  getMemoryBook,
  indexMemoryFixture,
  seedMemoryGraph,
} from "@/app/memory/actions";
import type { MemoryEdge as MemoryEdgeRow, MemoryNode as MemoryNodeRow } from "@/db/schema";
import {
  bookToFlow,
  type BookFileData,
  type BookSymbolData,
  type MemoryBook,
} from "@/lib/memory/book-toc";

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
type BookDirFlow = Node<{ kind: "dir"; path: string; label: string }, "bookDir">;
type BookFileFlow = Node<BookFileData, "bookFile">;
type BookSymbolFlow = Node<BookSymbolData, "bookSymbol">;
type Layer = "knowledge" | "book";

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

function BookDirNode({ data }: NodeProps<BookDirFlow>) {
  return (
    <div
      className="relative w-[180px] rounded-lg border-2 border-[var(--ink)]/20 bg-[#fef9c3] px-3 py-2 shadow-[2px_3px_0_rgba(0,0,0,0.06)]"
      data-testid="book-dir-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
      <div className="flex items-center gap-1.5 text-[#854d0e]">
        <Folder className="h-3.5 w-3.5" />
        <span className="text-[9px] font-bold tracking-[0.14em] uppercase">Dir</span>
      </div>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold text-[#713f12]">
        {data.label}
      </p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
    </div>
  );
}

function BookFileNode({ data }: NodeProps<BookFileFlow>) {
  return (
    <div
      className="relative w-[200px] rounded-lg border-2 border-[var(--ink)]/20 bg-[#e0f2fe] px-3 py-2 shadow-[2px_3px_0_rgba(0,0,0,0.06)]"
      data-testid="book-file-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
      <div className="flex items-center gap-1.5 text-[#075985]">
        <FileCode2 className="h-3.5 w-3.5" />
        <span className="text-[9px] font-bold tracking-[0.14em] uppercase">File</span>
      </div>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold text-[#0c4a6e]">
        {data.label}
      </p>
      {data.summary ? (
        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-[#0369a1]">
          {data.summary}
        </p>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
    </div>
  );
}

function BookSymbolNode({ data }: NodeProps<BookSymbolFlow>) {
  return (
    <div
      className="relative w-[240px] cursor-pointer rounded-lg border-2 border-[var(--ink)]/20 bg-[#ecfdf5] px-3 py-2 shadow-[2px_3px_0_rgba(0,0,0,0.06)]"
      data-testid="book-symbol-node"
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
      <div className="flex items-center gap-1.5 text-[#065f46]">
        <BookOpen className="h-3.5 w-3.5" />
        <span className="text-[9px] font-bold tracking-[0.14em] uppercase">Symbol</span>
      </div>
      <p
        className="mt-0.5 text-sm font-semibold leading-snug break-words text-[#064e3b]"
        data-testid="book-symbol-intent"
      >
        {data.intent}
      </p>
      <p
        className="mt-1 font-mono text-[11px] leading-snug break-all text-[#047857]"
        data-testid="book-symbol-identity"
      >
        {data.identity}
      </p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[var(--ink)]" />
    </div>
  );
}

const nodeTypes = {
  memoNote: MemoNoteNode,
  bookDir: BookDirNode,
  bookFile: BookFileNode,
  bookSymbol: BookSymbolNode,
};
const edgeTypes = { script: ScriptEdge };

function MemoryView({
  nodes: dbNodes,
  edges: dbEdges,
  book: initialBook,
  projectId,
}: {
  nodes: MemoryNodeRow[];
  edges: MemoryEdgeRow[];
  book: MemoryBook;
  projectId: number;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const [pending, startTransition] = useTransition();
  const [layer, setLayer] = useState<Layer>("knowledge");
  const [book, setBook] = useState<MemoryBook>(initialBook);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<BookSymbolData | null>(null);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<MemoryNodeRow["kind"]>("fact");
  const [content, setContent] = useState("");
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [relation, setRelation] = useState<MemoryEdgeRow["relation"]>("references");

  const { nodes, edges } = useMemo(() => {
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

  const bookFlow = useMemo(() => bookToFlow(book), [book]);

  const visibleBook = useMemo(() => {
    const hidden = new Set<string>();
    for (const fileId of collapsedFiles) {
      for (const edge of bookFlow.edges) {
        if (edge.source === fileId) hidden.add(edge.target);
      }
    }
    return {
      nodes: bookFlow.nodes.filter((n) => !hidden.has(n.id)),
      edges: bookFlow.edges.filter(
        (e) => !hidden.has(e.source) && !hidden.has(e.target)
      ),
    };
  }, [bookFlow, collapsedFiles]);

  const canvasNodes: Node[] =
    layer === "knowledge" ? nodes : (visibleBook.nodes as unknown as Node[]);
  const canvasEdges: Edge[] =
    layer === "knowledge"
      ? edges
      : visibleBook.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "script" as const,
          data: { signal: "contains" },
          label: "contains",
        }));

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

  const indexFixture = () => {
    startTransition(async () => {
      setIndexError(null);
      setIndexStatus(null);
      const result = await indexMemoryFixture(projectId);
      if (!result.ok) {
        setIndexError(result.error);
        return;
      }
      const next = await getMemoryBook(projectId);
      setBook(next);
      setIndexStatus(
        `Indexed ${result.symbolCount} symbols across ${result.fileCount} files`
      );
    });
  };

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    if (layer !== "book") return;
    const data = node.data as BookSymbolData | BookFileData | { kind?: string };
    if (data.kind === "symbol") {
      setSelected(data as BookSymbolData);
    }
  };

  const onNodeDoubleClick: NodeMouseHandler = (_event, node) => {
    if (layer !== "book") return;
    const data = node.data as { kind?: string };
    if (data.kind !== "file") return;
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
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
          Memory
        </h1>
        <div
          className="ml-2 flex rounded-full border border-[var(--ink)]/20 p-0.5"
          data-testid="memory-layer-toggle"
        >
          <button
            type="button"
            data-testid="memory-layer-knowledge"
            onClick={() => setLayer("knowledge")}
            className={cn(
              "rounded-full px-3 py-1 text-[10px] font-semibold tracking-widest uppercase",
              layer === "knowledge"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Knowledge
          </button>
          <button
            type="button"
            data-testid="memory-layer-code-book"
            onClick={() => setLayer("book")}
            className={cn(
              "rounded-full px-3 py-1 text-[10px] font-semibold tracking-widest uppercase",
              layer === "book"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Code book
          </button>
        </div>
        <div className="ml-auto">
          <ModeToggle />
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_340px]">
        <section className="relative min-h-[420px]">
          <ReactFlowProvider>
            <ReactFlow
              key={`${layer}-${book.stats.symbolCount}`}
              nodes={canvasNodes}
              edges={canvasEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={dark ? "dark" : "light"}
              fitView
              nodesConnectable={false}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
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

          {layer === "knowledge" && dbNodes.length === 0 && (
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

          {layer === "book" && book.stats.symbolCount === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
              <BookOpen className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Code book is empty — index the sample fixture to open the TOC graph.
              </p>
            </div>
          )}
        </section>

        {layer === "knowledge" ? (
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
        ) : (
          <aside className="flex flex-col gap-4 border-t-2 border-[var(--ink)]/10 p-4 lg:border-t-0 lg:border-l-2">
            <div className="rounded-xl border-2 border-[var(--ink)]/15 bg-background p-4 shadow-[3px_4px_0_rgba(0,0,0,0.06)]">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <BookOpen className="h-4 w-4" /> Code book
              </h2>
              <p className="text-xs text-muted-foreground">
                {book.stats.fileCount} files · {book.stats.symbolCount} symbols
              </p>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                CAG TOC is dir → file → symbol. Pages are intent + identity, never
                file bodies.
              </p>
              <Button
                data-testid="memory-index-fixture"
                onClick={indexFixture}
                disabled={pending}
                className="mt-3 w-full bg-foreground text-background hover:bg-foreground/90"
              >
                Index sample fixture
              </Button>
              {indexStatus && (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="memory-index-status">
                  {indexStatus}
                </p>
              )}
              {indexError && (
                <p className="mt-2 text-xs text-red-500" data-testid="memory-index-error">
                  {indexError}
                </p>
              )}
            </div>

            <div
              className="rounded-xl border-2 border-[var(--ink)]/15 bg-background p-4 shadow-[3px_4px_0_rgba(0,0,0,0.06)]"
              data-testid="book-symbol-detail"
            >
              <h2 className="mb-3 text-sm font-semibold text-foreground">Symbol page</h2>
              {selected ? (
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                      Intent
                    </dt>
                    <dd className="mt-0.5 break-words text-foreground">{selected.intent}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                      Identity
                    </dt>
                    <dd className="mt-0.5 font-mono break-all text-foreground">
                      {selected.identity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                      Location
                    </dt>
                    <dd className="mt-0.5 font-mono text-foreground">
                      {selected.filePath}
                      {selected.startLine != null ? `:${selected.startLine}` : ""}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Click a symbol node to open intent, identity, and location.
                  Double-click a file to collapse its pages.
                </p>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

export default MemoryView;
