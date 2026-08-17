"use client";

import { useEffect, useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  AlertCircle,
  Brain,
  Check,
  Cloud,
  CloudOff,
  Flag,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Merge,
  Play,
  ShieldCheck,
  SquareTerminal,
  Spline,
  Upload,
  UserRound,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lintCanvas } from "@/lib/canvas-to-dsl";
import { syncBadgeLabel } from "@/lib/draft-autosave";
import { cn } from "@/lib/utils";
import {
  PALETTE_GROUPS,
  SIGNAL_PRESETS,
  STATE_CATALOG,
  STATE_COLORS,
  type FSMStateType,
} from "@/lib/fsm-types";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCredentialStore } from "@/stores/credential-store";
import { useRegistryStore } from "@/stores/registry-store";
import { DslPreviewDialog } from "./dsl-preview-dialog";
import { VersionHistoryDialog } from "./version-history-dialog";

const ICONS: Record<FSMStateType, typeof Play> = {
  START: Play,
  SCRIPT: SquareTerminal,
  HTTP: Globe,
  AI: Brain,
  EXTERNAL_AI: Cloud,
  VALIDATE: ShieldCheck,
  HUMAN: UserRound,
  SPAWN: GitBranch,
  AGGREGATE: Merge,
  SYSTEM_FUNCTION: Layers,
  END: Flag,
};

/** Grouped state palette (Flow / Work / Generative / Control / Custom) + signal picker */
export function CanvasToolbar({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const preferredSignal = useCanvasStore((s) => s.preferredSignal);
  const setPreferredSignal = useCanvasStore((s) => s.setPreferredSignal);
  const syncStatus = useCanvasStore((s) => s.syncStatus);
  const notice = useCanvasStore((s) => s.notice);
  const versionCount = useCanvasStore((s) => s.versionCounts[projectId] ?? 0);
  const publishProject = useCanvasStore((s) => s.publishProject);
  const reloadFromServer = useCanvasStore((s) => s.reloadFromServer);
  const overwriteServer = useCanvasStore((s) => s.overwriteServer);
  const nodes = useCanvasStore((s) => s.canvases[projectId]?.nodes);
  const edges = useCanvasStore((s) => s.canvases[projectId]?.edges);
  const credentials = useCredentialStore((s) => s.credentials);
  const registry = useRegistryStore((s) => s.registry);
  const { screenToFlowPosition } = useReactFlow();
  const [publishing, setPublishing] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const lintErrors = useMemo(() => {
    const issues = lintCanvas(
      { nodes: nodes ?? [], edges: edges ?? [] },
      {
        registry,
        credentials: credentials.map((c) => ({
          id: c.id,
          active: c.active,
          models: c.models,
        })),
      }
    );
    return issues.filter((i) => i.severity === "error");
  }, [nodes, edges, credentials, registry]);

  const badge = syncBadgeLabel(syncStatus, online);
  const publishDisabled = lintErrors.length > 0 || publishing;

  const handlePublish = async () => {
    if (publishDisabled) return;
    setPublishing(true);
    try {
      await publishProject(projectId);
    } finally {
      setPublishing(false);
    }
  };

  const handleAdd = (type: FSMStateType) => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const jitter = () => (Math.random() - 0.5) * 160;
    const id = addNode(
      projectId,
      type,
      { x: center.x + jitter(), y: center.y + jitter() },
      STATE_CATALOG[type].label
    );
    selectNode(id);
  };

  return (
    <>
      <div className="absolute top-4 left-4 z-10 hidden w-[200px] rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-2 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm md:block">
        <span className="mb-1 block px-1.5 pt-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Add state
        </span>
        <div className="flex flex-col gap-2" data-testid="palette-groups">
          {PALETTE_GROUPS.map((group) => (
            <div key={group.id} data-testid={`palette-group-${group.id}`}>
              <span className="mb-0.5 block px-1.5 text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                {group.label}
              </span>
              <div className="flex flex-col gap-0.5">
                {group.types.map((type) => {
                  const Icon = ICONS[type];
                  const meta = STATE_CATALOG[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      title={meta.tooltip}
                      onClick={() => handleAdd(type)}
                      className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-foreground/5"
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-transform group-hover:scale-110",
                          STATE_COLORS[type].note,
                          STATE_COLORS[type].border,
                          STATE_COLORS[type].text
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-foreground">
                          {meta.label}
                        </span>
                        <span className="block truncate text-[9px] text-muted-foreground">
                          {meta.tooltip}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-1.5 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm md:hidden">
        {PALETTE_GROUPS.flatMap((g) => g.types).map((type) => {
          const Icon = ICONS[type];
          return (
            <button
              key={type}
              title={STATE_CATALOG[type].tooltip}
              type="button"
              onClick={() => handleAdd(type)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md border-2",
                STATE_COLORS[type].note,
                STATE_COLORS[type].border,
                STATE_COLORS[type].text
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>

      <div className="absolute top-4 left-1/2 z-10 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border-2 border-[var(--ink)]/15 bg-[var(--paper)]/90 p-2 shadow-[3px_4px_0_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <Spline className="ml-1 hidden h-4 w-4 text-[var(--ink)] sm:block" />
        <span className="hidden text-[10px] font-semibold tracking-widest text-muted-foreground uppercase sm:block">
          New wires
        </span>
        <Select
          value={preferredSignal}
          onValueChange={(v) => v && setPreferredSignal(v)}
        >
          <SelectTrigger className="h-8 w-[150px] border-foreground/10 bg-foreground/5 font-mono text-xs sm:w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-foreground/10 bg-popover text-popover-foreground">
            <SelectItem value="auto" className="font-mono text-xs">
              auto (from source)
            </SelectItem>
            {SIGNAL_PRESETS.map(({ signal }) => (
              <SelectItem key={signal} value={signal} className="font-mono text-xs">
                {signal}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mx-1 h-5 w-px bg-foreground/10" />
        <DslPreviewDialog projectId={projectId} projectName={projectName} />
        <div className="mx-1 h-5 w-px bg-foreground/10" />
        {badge ? (
          <span
            data-testid="sync-badge"
            data-sync-status={syncStatus}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
              badge === "Saved" && "text-emerald-700 dark:text-emerald-400",
              badge === "Saving…" && "text-muted-foreground",
              badge === "Offline" && "text-amber-700 dark:text-amber-400",
              badge === "error" && "text-red-600 dark:text-red-400"
            )}
            title={
              syncStatus === "stale"
                ? "Canvas changed elsewhere"
                : badge
            }
          >
            {badge === "Saved" && <Check className="h-3 w-3" />}
            {badge === "Saving…" && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {badge === "Offline" && <CloudOff className="h-3 w-3" />}
            {badge === "error" && <AlertCircle className="h-3 w-3" />}
            {badge}
          </span>
        ) : null}
        {syncStatus === "stale" && (
          <span className="flex items-center gap-1 text-[10px]">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 underline-offset-2 hover:underline"
              onClick={() => void reloadFromServer(projectId)}
            >
              Reload
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 underline-offset-2 hover:underline"
              onClick={() => void overwriteServer(projectId)}
            >
              Overwrite
            </button>
          </span>
        )}
        <button
          type="button"
          data-testid="publish-button"
          disabled={publishDisabled}
          title={
            lintErrors.length > 0
              ? "Fix lint errors before publishing"
              : "Publish an immutable version"
          }
          onClick={() => void handlePublish()}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-white disabled:pointer-events-none disabled:opacity-50"
        >
          {publishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Publish
          <span className="font-mono text-[10px] text-muted-foreground">
            {versionCount}
          </span>
        </button>
        <VersionHistoryDialog projectId={projectId} />
        {notice ? (
          <span
            data-testid="import-notice"
            className="rounded-md bg-foreground/5 px-2 py-1 text-[11px] text-foreground"
          >
            {notice}
          </span>
        ) : null}
      </div>
    </>
  );
}
