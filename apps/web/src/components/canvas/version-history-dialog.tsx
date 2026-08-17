"use client";

import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { listVersions } from "@/app/project/[id]/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { VersionRow } from "@/lib/draft-sync";
import { useCanvasStore } from "@/stores/canvas-store";

function formatCreatedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function shortHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 12)}…`;
}

export function VersionHistoryDialog({ projectId }: { projectId: string }) {
  const restoreProjectVersion = useCanvasStore((s) => s.restoreProjectVersion);
  const versionCount = useCanvasStore((s) => s.versionCounts[projectId] ?? 0);
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listVersions(Number(projectId))
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load versions");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, versionCount]);

  const handleRestore = async (versionId: number) => {
    setRestoringId(versionId);
    setError(null);
    try {
      await restoreProjectVersion(projectId, versionId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-testid="version-history-button"
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-white"
        title="Published version history"
      >
        <History className="h-4 w-4" />
        History
      </DialogTrigger>
      <DialogContent
        data-testid="version-history-dialog"
        className="max-w-lg border-foreground/10 bg-background text-foreground sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            Published versions are immutable. Restore copies a version into the
            draft without changing history.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-red-500" data-testid="version-history-error">
            {error}
          </p>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading versions…
          </div>
        ) : versions.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="version-history-empty"
          >
            No published versions yet.
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh]">
            <ul className="space-y-2" data-testid="version-history-list">
              {versions.map((row) => (
                <li
                  key={row.id}
                  data-testid="version-row"
                  data-version={row.version}
                  className="flex items-start justify-between gap-3 rounded-lg border border-foreground/10 bg-foreground/5 p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">
                      v{row.version}
                      <span
                        data-testid="version-label"
                        className="ml-2 font-normal text-muted-foreground"
                      >
                        {row.label ?? "—"}
                      </span>
                    </p>
                    <p
                      data-testid="version-hash"
                      title={row.contentHash}
                      className="truncate font-mono text-[11px] text-muted-foreground"
                    >
                      {shortHash(row.contentHash)}
                    </p>
                    <p
                      data-testid="version-created-at"
                      className="text-[11px] text-muted-foreground"
                    >
                      {formatCreatedAt(row.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="restore-version-button"
                    disabled={restoringId !== null}
                    onClick={() => void handleRestore(row.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-foreground/10 bg-background px-2 py-1 text-[11px] font-medium hover:bg-foreground/10 disabled:opacity-50"
                  >
                    {restoringId === row.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Restore into draft
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
