"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, StickyNote, X } from "lucide-react";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Textarea } from "@/components/ui/textarea";
import { updateProjectDescription } from "@/app/actions";
import { useCanvasStore } from "@/stores/canvas-store";
import type { Project } from "@/db/schema";

/**
 * Describe panel (shapeof.ai "Describe" pattern) — decomposes the project
 * into its fundamental tokens before you start working on it.
 */
export function DescribePanel({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const router = useRouter();
  const nodes = useCanvasStore((s) => s.canvases[String(project.id)]?.nodes);
  const edges = useCanvasStore((s) => s.canvases[String(project.id)]?.edges);
  const [description, setDescription] = useState(project.description ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (description === (project.description ?? "")) return;
    startTransition(async () => {
      await updateProjectDescription(project.id, description);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rotate-[-0.4deg] rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)] p-6 shadow-[6px_8px_0_rgba(0,0,0,0.10)]">
        {/* washi tape */}
        <div className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 -rotate-[2deg] rounded-[2px] bg-[#8fb4ec]/50 shadow-sm" />

        <button
          onClick={onClose}
          className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-muted-foreground uppercase">
          <StickyNote className="h-3.5 w-3.5" />
          Describe
        </div>

        <h2 className="font-hand mt-1 text-4xl leading-none font-bold text-foreground">
          {project.name}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Created {project.createdAt?.toLocaleString() ?? "—"}
        </p>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-foreground/80">
              What should this harness do?
            </label>
            {saved && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={save}
            disabled={pending}
            placeholder="e.g. Scrape 12 pages, summarize each with an LLM, then write a markdown report…"
            className="min-h-[84px] border-[var(--ink)]/20 bg-foreground/5 text-sm"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {[
            { label: "States on canvas", value: nodes?.length ?? 0 },
            { label: "Wires", value: edges?.length ?? 0 },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-[var(--ink)]/15 bg-foreground/5 px-3 py-2"
            >
              <p className="font-hand text-2xl leading-none font-bold text-foreground">
                {value}
              </p>
              <p className="mt-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <ShimmerButton
            onClick={() => router.push(`/project/${project.id}/runs`)}
            background="rgba(209,250,229,0.9)"
            shimmerColor="#34d399"
            className="text-sm font-semibold text-[#1e5c3f]"
          >
            <span className="flex items-center gap-2">
              <Play className="h-4 w-4" /> Start run
            </span>
          </ShimmerButton>
          <RainbowButton onClick={onClose} className="text-sm">
            Open canvas
          </RainbowButton>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground">
          Start run opens the live monitor — engine execution lands in Phase 3.
        </p>
      </div>
    </div>
  );
}
