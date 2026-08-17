"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Download, Loader2 } from "lucide-react";
import { listVersions } from "@/app/project/[id]/actions";
import { listExportJobs } from "@/app/project/[id]/export/actions";
import { BlurFade } from "@/components/ui/blur-fade";
import { ThemedMagicCard } from "@/components/themed-magic-card";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/nav/project-nav";
import { cn } from "@/lib/utils";
import type { VersionRow } from "@/lib/draft-sync";
import type { ExportJobRow, ToolLanguage } from "@/lib/export/zip-harness";

const LANGUAGES: { id: ToolLanguage; label: string; desc: string }[] = [
  { id: "python", label: "Python", desc: "grpcio server, module-per-tool" },
  { id: "bash", label: "Bash", desc: "Python shim execs bash scripts" },
];

function shortHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 12)}…`;
}

function formatCreatedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function filenameFromDisposition(header: string | null): string {
  if (!header) return "harness.zip";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? "harness.zip";
}

export function ExportWizard({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [jobs, setJobs] = useState<ExportJobRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [language, setLanguage] = useState<ToolLanguage>("python");
  const [includeMemory, setIncludeMemory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lintIssues, setLintIssues] = useState<Array<{ code: string; message: string }>>(
    []
  );
  const [sizeWarning, setSizeWarning] = useState(false);

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];

  const refresh = useCallback(async () => {
    const pid = Number(projectId);
    const [nextVersions, nextJobs] = await Promise.all([
      listVersions(pid),
      listExportJobs(pid),
    ]);
    setVersions(nextVersions);
    setJobs(nextJobs);
    setSelectedId((current) => {
      if (current && nextVersions.some((v) => v.id === current)) return current;
      return nextVersions[0]?.id ?? null;
    });
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load export data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const downloadZip = async () => {
    if (!selected) return;
    setDownloading(true);
    setError(null);
    setLintIssues([]);
    setSizeWarning(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: selected.id,
          toolLanguage: language,
          includeMemory,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          issues?: Array<{ code: string; message: string }>;
        };
        setError(data.error ?? "Export failed");
        setLintIssues(data.issues ?? []);
        await refresh().catch(() => undefined);
        return;
      }
      setSizeWarning(res.headers.get("X-Export-Size-Warning") === "1");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(res.headers.get("Content-Disposition"));
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
      await refresh().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <ProjectNav projectId={projectId} projectName={projectName} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <BlurFade delay={0.05} inView>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Export harness</h1>
              <p className="text-sm text-muted-foreground">
                Download a published version as a standalone Docker ZIP.
              </p>
            </div>
          </BlurFade>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading published versions…
            </div>
          ) : versions.length === 0 ? (
            <div
              className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-6"
              data-testid="publish-prompt"
            >
              <p className="font-semibold text-foreground">Publish a version first</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Export compiles an immutable published FSM. Open the canvas, then
                publish.
              </p>
              <Link
                href={`/project/${projectId}/canvas`}
                data-testid="open-canvas-link"
                className="mt-4 inline-flex text-sm font-medium text-sky-400 hover:underline"
              >
                Open canvas
              </Link>
            </div>
          ) : (
            <>
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground/80 uppercase">
                  <span className="h-2 w-2 rounded-full bg-sky-400" />
                  1 · Version
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2" data-testid="export-version-list">
                  {versions.map((row) => {
                    const active = selected?.id === row.id;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          data-testid="export-version-row"
                          data-version={row.version}
                          onClick={() => setSelectedId(row.id)}
                          className="w-full text-left"
                        >
                          <ThemedMagicCard
                            className={cn(
                              "rounded-xl border p-4",
                              active
                                ? "border-sky-400/60 bg-sky-400/10"
                                : "border-foreground/10 bg-foreground/5"
                            )}
                          >
                            <p className="font-semibold text-foreground">
                              v{row.version}
                              {row.label ? (
                                <span className="ml-2 font-normal text-muted-foreground">
                                  {row.label}
                                </span>
                              ) : null}
                            </p>
                            <p
                              data-testid="export-version-hash"
                              title={row.contentHash}
                              className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                            >
                              {shortHash(row.contentHash)}
                            </p>
                          </ThemedMagicCard>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground/80 uppercase">
                  <span className="h-2 w-2 rounded-full bg-[#A07CFE]" />
                  2 · Options
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {LANGUAGES.map((l) => (
                    <button key={l.id} type="button" onClick={() => setLanguage(l.id)}>
                      <ThemedMagicCard
                        className={cn(
                          "rounded-xl border p-4 text-left",
                          language === l.id
                            ? "border-purple-400/60 bg-purple-400/10"
                            : "border-foreground/10 bg-foreground/5"
                        )}
                      >
                        <p className="font-semibold text-foreground">{l.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{l.desc}</p>
                      </ThemedMagicCard>
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeMemory}
                    onChange={(e) => setIncludeMemory(e.target.checked)}
                    data-testid="include-memory"
                  />
                  Include memory.json (most recent nodes)
                </label>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <RainbowButton
                  onClick={() => void downloadZip()}
                  disabled={downloading || !selected}
                  className="gap-2"
                  data-testid="download-zip-button"
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : downloaded ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {downloaded ? "Downloaded!" : "Download ZIP"}
                </RainbowButton>
                {selected ? (
                  <span className="font-mono text-xs text-muted-foreground" data-testid="selected-hash">
                    {shortHash(selected.contentHash)}
                  </span>
                ) : null}
              </div>

              {sizeWarning ? (
                <p className="text-xs text-amber-400" data-testid="size-warning">
                  Bundle is over 50 MB; export continued and size was logged.
                </p>
              ) : null}

              {error ? (
                <div
                  className="rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-300"
                  data-testid="export-error"
                >
                  {error}
                  {lintIssues.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="lint-errors">
                      {lintIssues.map((issue) => (
                        <li key={`${issue.code}-${issue.message}`}>
                          {issue.code}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground/80 uppercase">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Export history
            </h2>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="export-history-empty">
                No export jobs yet.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="export-history">
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    data-testid="export-job-row"
                    data-status={job.status}
                    data-hash={job.contentHash ?? ""}
                    className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {job.status}
                        </Badge>
                        <span>v{job.version}</span>
                        <span className="text-muted-foreground">{job.target}</span>
                      </div>
                      <p
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={job.contentHash ?? ""}
                        data-testid="export-job-hash"
                      >
                        {job.contentHash ? shortHash(job.contentHash) : "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                      <p>{formatBytes(job.sizeBytes)}</p>
                      <p>{formatCreatedAt(job.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
