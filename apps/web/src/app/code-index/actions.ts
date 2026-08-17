"use server";

import fs from "node:fs";
import path from "node:path";
import { and, count, desc, eq, like, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { codeSymbols } from "@/db/schema";
import { extractSymbols } from "@/lib/code-index/extractor";
import { hashContent } from "@/lib/code-index/hash";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
} from "@/lib/code-index/path-guard";
import { walkSourceFiles } from "@/lib/code-index/walker";
import {
  expandNeighborsFromCards,
  type SymbolCard,
} from "@/lib/code-index/neighbors";
import type {
  CodeSymbolKind,
  IndexPathError,
  IndexPathResult,
  IndexStats,
} from "@/lib/code-index/types";

const RECENT_CAP = 50;

export type CodeSymbolRow = {
  id: number;
  projectId: number;
  kind: string;
  intent: string;
  identity: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  hash: string;
  indexedAt: Date;
};

export type UpsertSymbolInput = {
  projectId: number;
  kind: CodeSymbolKind;
  intent: string;
  identity: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  hash: string;
};

export async function upsertSymbols(
  projectId: number,
  symbols: UpsertSymbolInput[]
): Promise<number> {
  let changed = 0;
  const now = new Date();

  for (const sym of symbols) {
    const existing = await db
      .select({ id: codeSymbols.id, hash: codeSymbols.hash })
      .from(codeSymbols)
      .where(
        and(
          eq(codeSymbols.projectId, projectId),
          eq(codeSymbols.filePath, sym.filePath),
          eq(codeSymbols.identity, sym.identity)
        )
      )
      .limit(1);

    if (existing.length > 0 && existing[0].hash === sym.hash) {
      continue;
    }

    if (existing.length > 0) {
      await db
        .update(codeSymbols)
        .set({
          kind: sym.kind,
          intent: sym.intent,
          startLine: sym.startLine ?? null,
          endLine: sym.endLine ?? null,
          language: sym.language ?? null,
          hash: sym.hash,
          indexedAt: now,
        })
        .where(eq(codeSymbols.id, existing[0].id));
    } else {
      await db.insert(codeSymbols).values({
        projectId,
        kind: sym.kind,
        intent: sym.intent,
        identity: sym.identity,
        filePath: sym.filePath,
        startLine: sym.startLine ?? null,
        endLine: sym.endLine ?? null,
        language: sym.language ?? null,
        hash: sym.hash,
        indexedAt: now,
      });
    }
    changed += 1;
  }

  revalidatePath("/code-index");
  revalidatePath("/memory");
  return changed;
}

async function replaceFileSymbols(
  projectId: number,
  filePath: string,
  symbols: UpsertSymbolInput[]
): Promise<void> {
  await db
    .delete(codeSymbols)
    .where(
      and(
        eq(codeSymbols.projectId, projectId),
        eq(codeSymbols.filePath, filePath)
      )
    );

  if (symbols.length === 0) return;

  const now = new Date();
  await db.insert(codeSymbols).values(
    symbols.map((sym) => ({
      projectId,
      kind: sym.kind,
      intent: sym.intent,
      identity: sym.identity,
      filePath: sym.filePath,
      startLine: sym.startLine ?? null,
      endLine: sym.endLine ?? null,
      language: sym.language ?? null,
      hash: sym.hash,
      indexedAt: now,
    }))
  );
}

export async function indexWorkspacePath(
  projectId: number,
  inputPath: string
): Promise<IndexPathResult | IndexPathError> {
  const resolved = resolveWorkspacePath(inputPath);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const root = getWorkspaceRoot();
  const { files, skippedLarge } = walkSourceFiles(resolved.path);
  const allRows: IndexPathResult["symbols"] = [];

  for (const absolute of files) {
    const content = fs.readFileSync(absolute, "utf8");
    const hash = hashContent(content);
    const relFromWorkspace = path.relative(root, absolute).replace(/\\/g, "/");
    const extracted = extractSymbols(absolute, content);

    const batch: UpsertSymbolInput[] = extracted.map((sym) => ({
      projectId,
      kind: sym.kind,
      intent: sym.intent,
      identity: sym.identity,
      filePath: relFromWorkspace,
      startLine: sym.startLine,
      endLine: sym.endLine,
      language: "typescript",
      hash,
    }));

    await replaceFileSymbols(projectId, relFromWorkspace, batch);

    for (const sym of extracted) {
      allRows.push({
        filePath: relFromWorkspace,
        name: sym.name,
        kind: sym.kind,
        intent: sym.intent,
        identity: sym.identity,
      });
    }
  }

  revalidatePath("/code-index");
  revalidatePath("/memory");

  return {
    ok: true,
    symbols: allRows,
    fileCount: files.length,
    symbolCount: allRows.length,
    skippedLarge,
  };
}

export async function searchByIntent(
  projectId: number,
  query: string,
  limit = RECENT_CAP
): Promise<CodeSymbolRow[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return await db
      .select()
      .from(codeSymbols)
      .where(eq(codeSymbols.projectId, projectId))
      .orderBy(desc(codeSymbols.indexedAt))
      .limit(limit);
  }

  return await db
    .select()
    .from(codeSymbols)
    .where(
      and(
        eq(codeSymbols.projectId, projectId),
        like(codeSymbols.intent, `%${trimmed}%`)
      )
    )
    .orderBy(desc(codeSymbols.indexedAt))
    .limit(limit);
}

export async function searchByPath(
  projectId: number,
  prefix: string,
  limit = RECENT_CAP
): Promise<CodeSymbolRow[]> {
  const trimmed = prefix.trim();
  if (!trimmed) {
    return await db
      .select()
      .from(codeSymbols)
      .where(eq(codeSymbols.projectId, projectId))
      .orderBy(desc(codeSymbols.indexedAt))
      .limit(limit);
  }

  return await db
    .select()
    .from(codeSymbols)
    .where(
      and(
        eq(codeSymbols.projectId, projectId),
        like(codeSymbols.filePath, `${trimmed}%`)
      )
    )
    .orderBy(desc(codeSymbols.indexedAt))
    .limit(limit);
}

export async function lookupIdentity(
  projectId: number,
  identityOrPartial: string,
  limit = RECENT_CAP
): Promise<CodeSymbolRow[]> {
  const trimmed = identityOrPartial.trim();
  if (!trimmed) {
    return await db
      .select()
      .from(codeSymbols)
      .where(eq(codeSymbols.projectId, projectId))
      .orderBy(desc(codeSymbols.indexedAt))
      .limit(limit);
  }

  return await db
    .select()
    .from(codeSymbols)
    .where(
      and(
        eq(codeSymbols.projectId, projectId),
        like(codeSymbols.identity, `%${trimmed}%`)
      )
    )
    .orderBy(desc(codeSymbols.indexedAt))
    .limit(limit);
}

function toSymbolCard(row: {
  intent: string;
  identity: string;
  filePath: string;
  startLine: number | null;
  kind: string;
}): SymbolCard {
  return {
    intent: row.intent,
    identity: row.identity,
    filePath: row.filePath,
    startLine: row.startLine ?? undefined,
    kind: row.kind,
  };
}

/**
 * Same-file symbols plus heuristic `references` (identity substring).
 * Returns symbol cards only — never file bodies.
 */
export async function expandNeighbors(
  projectId: number,
  identity: string,
  hops = 1
): Promise<SymbolCard[]> {
  const rows = await db
    .select({
      intent: codeSymbols.intent,
      identity: codeSymbols.identity,
      filePath: codeSymbols.filePath,
      startLine: codeSymbols.startLine,
      kind: codeSymbols.kind,
    })
    .from(codeSymbols)
    .where(eq(codeSymbols.projectId, projectId));

  return expandNeighborsFromCards(rows.map(toSymbolCard), identity, hops);
}

export async function getIndexStats(projectId: number): Promise<IndexStats> {
  const [symbolRow] = await db
    .select({ value: count() })
    .from(codeSymbols)
    .where(eq(codeSymbols.projectId, projectId));

  const fileRows = await db
    .select({ filePath: codeSymbols.filePath })
    .from(codeSymbols)
    .where(eq(codeSymbols.projectId, projectId));

  const uniqueFiles = new Set(fileRows.map((r) => r.filePath)).size;

  const [lastRow] = await db
    .select({ value: max(codeSymbols.indexedAt) })
    .from(codeSymbols)
    .where(eq(codeSymbols.projectId, projectId));

  return {
    symbolCount: Number(symbolRow?.value ?? 0),
    fileCount: uniqueFiles,
    lastIndexedAt: lastRow?.value
      ? new Date(lastRow.value as Date).toISOString()
      : null,
  };
}
