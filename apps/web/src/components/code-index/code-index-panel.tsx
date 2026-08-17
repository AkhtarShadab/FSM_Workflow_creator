"use client";

import { useState } from "react";
import { indexWorkspacePath } from "@/app/code-index/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CodeSymbolKind } from "@/lib/code-index/types";

type ResultRow = {
  filePath: string;
  name: string;
  kind: CodeSymbolKind;
};

export function CodeIndexPanel({
  defaultProjectId,
  defaultPath = "apps/web/fixtures/code-index-sample",
}: {
  defaultProjectId: number;
  defaultPath?: string;
}) {
  const [projectId, setProjectId] = useState(String(defaultProjectId));
  const [pathInput, setPathInput] = useState(defaultPath);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleIndex() {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const pid = Number(projectId);
      if (!Number.isFinite(pid) || pid <= 0) {
        setError("Project id must be a positive number");
        return;
      }

      const result = await indexWorkspacePath(pid, pathInput);
      if (!result.ok) {
        setError(result.error);
        setRows([]);
        return;
      }

      setRows(
        result.symbols.map((s) => ({
          filePath: s.filePath,
          name: s.name,
          kind: s.kind,
        }))
      );
      setStatus(
        `Indexed ${result.symbolCount} symbols across ${result.fileCount} files` +
          (result.skippedLarge > 0
            ? ` (${result.skippedLarge} large files skipped)`
            : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Index failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Code Index</h1>
        <p className="text-sm text-muted-foreground">
          Walk a workspace path, extract TypeScript symbols, and upsert into{" "}
          <code className="text-xs">code_symbols</code>. Paths must stay inside
          the workspace root.
        </p>
      </header>

      <div className="grid gap-4 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 sm:grid-cols-[120px_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="code-index-project">Project</Label>
          <Input
            id="code-index-project"
            data-testid="code-index-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code-index-path">Workspace path</Label>
          <Input
            id="code-index-path"
            data-testid="code-index-path"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="apps/web/src/lib"
          />
        </div>
        <Button
          type="button"
          data-testid="code-index-run"
          disabled={loading}
          onClick={() => handleIndex()}
        >
          {loading ? "Indexing…" : "Index"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-500" data-testid="code-index-error">
          {error}
        </p>
      )}
      {status && (
        <p className="text-sm text-muted-foreground" data-testid="code-index-status">
          {status}
        </p>
      )}

      <Table data-testid="code-index-results">
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Kind</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No symbols yet — run Index on a workspace path.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={`${row.filePath}-${row.name}-${i}`}>
                <TableCell className="max-w-[280px] truncate font-mono text-xs">
                  {row.filePath}
                </TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.kind}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
