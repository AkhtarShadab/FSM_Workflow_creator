/** CAG table-of-contents builder for book memory (002 §10.3). */

export interface TocSymbol {
  identity: string;
  intent: string;
  kind: string;
  startLine?: number;
}

export interface TocFile {
  path: string;
  summary: string;
  symbols: TocSymbol[];
}

export interface TocDir {
  path: string;
  children: Array<TocDir | TocFile>;
  fileCount: number;
  symbolCount: number;
}

export interface MemoryBook {
  root: TocDir;
  stats: { fileCount: number; symbolCount: number };
}

export type BookNodeKind = "dir" | "file" | "symbol";

export interface BookDirData {
  kind: "dir";
  path: string;
  label: string;
  [key: string]: unknown;
}

export interface BookFileData {
  kind: "file";
  path: string;
  summary: string;
  label: string;
  [key: string]: unknown;
}

export interface BookSymbolData {
  kind: "symbol";
  intent: string;
  identity: string;
  filePath: string;
  startLine?: number;
  label: string;
  [key: string]: unknown;
}

export type BookNodeData = BookDirData | BookFileData | BookSymbolData;

export interface FlowNode {
  id: string;
  type: "bookDir" | "bookFile" | "bookSymbol";
  position: { x: number; y: number };
  data: BookNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  data: { relation: "contains" };
}

const SUMMARY_MAX = 160;
const TOKEN_CHARS = 4;
const COL_WIDTH = 280;
const ROW_HEIGHT = 96;
const DEFAULT_BUDGET_TOKENS = 400;

export function isTocFile(node: TocDir | TocFile): node is TocFile {
  return Array.isArray((node as TocFile).symbols);
}

export function isTocDir(node: TocDir | TocFile): node is TocDir {
  return Array.isArray((node as TocDir).children);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / TOKEN_CHARS);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function fileName(filePath: string): string {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function dirName(dirPath: string): string {
  if (!dirPath) return "/";
  const parts = dirPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}

function comparePath(a: string, b: string): number {
  return a.localeCompare(b);
}

function sortSymbols(symbols: TocSymbol[]): TocSymbol[] {
  return [...symbols].sort((a, b) => {
    const lineA = a.startLine ?? Number.MAX_SAFE_INTEGER;
    const lineB = b.startLine ?? Number.MAX_SAFE_INTEGER;
    if (lineA !== lineB) return lineA - lineB;
    return a.identity.localeCompare(b.identity);
  });
}

/** First 1–3 unique intents, truncated to 160 characters. */
export function fileSummary(symbols: TocSymbol[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    const intent = symbol.intent.trim();
    if (!intent || seen.has(intent)) continue;
    seen.add(intent);
    unique.push(intent);
    if (unique.length >= 3) break;
  }
  const joined = unique.join(" · ");
  if (joined.length <= SUMMARY_MAX) return joined;
  return `${joined.slice(0, SUMMARY_MAX - 3)}...`;
}

type TrieNode = {
  path: string;
  dirs: Map<string, TrieNode>;
  files: Map<string, TocSymbol[]>;
};

function emptyTrie(path: string): TrieNode {
  return { path, dirs: new Map(), files: new Map() };
}

function insertFile(root: TrieNode, filePath: string, symbols: TocSymbol[]) {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  if (parts.length === 0) return;
  const name = parts[parts.length - 1];
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i];
    const nextPath = cursor.path ? `${cursor.path}/${segment}` : segment;
    let child = cursor.dirs.get(segment);
    if (!child) {
      child = emptyTrie(nextPath);
      cursor.dirs.set(segment, child);
    }
    cursor = child;
  }
  cursor.files.set(name, symbols);
}

function trieToDir(node: TrieNode): TocDir {
  const children: Array<TocDir | TocFile> = [];
  const dirEntries = [...node.dirs.entries()].sort(([a], [b]) =>
    comparePath(a, b)
  );
  for (const [, child] of dirEntries) {
    children.push(trieToDir(child));
  }
  const fileEntries = [...node.files.entries()].sort(([a], [b]) =>
    comparePath(a, b)
  );
  for (const [name, symbols] of fileEntries) {
    const path = node.path ? `${node.path}/${name}` : name;
    const sorted = sortSymbols(symbols);
    children.push({
      path,
      summary: fileSummary(sorted),
      symbols: sorted,
    });
  }

  let fileCount = 0;
  let symbolCount = 0;
  for (const child of children) {
    if (isTocFile(child)) {
      fileCount += 1;
      symbolCount += child.symbols.length;
    } else {
      fileCount += child.fileCount;
      symbolCount += child.symbolCount;
    }
  }
  return { path: node.path, children, fileCount, symbolCount };
}

export function buildMemoryBook(
  symbols: Array<{
    filePath: string;
    identity: string;
    intent: string;
    kind: string;
    startLine?: number | null;
  }>
): MemoryBook {
  const byFile = new Map<string, TocSymbol[]>();
  for (const row of symbols) {
    const filePath = normalizePath(row.filePath);
    if (!filePath) continue;
    const list = byFile.get(filePath) ?? [];
    list.push({
      identity: row.identity,
      intent: row.intent,
      kind: row.kind,
      startLine: row.startLine ?? undefined,
    });
    byFile.set(filePath, list);
  }

  const trie = emptyTrie("");
  for (const [filePath, fileSymbols] of [...byFile.entries()].sort(([a], [b]) =>
    comparePath(a, b)
  )) {
    insertFile(trie, filePath, fileSymbols);
  }

  const root = trieToDir(trie);
  return {
    root,
    stats: { fileCount: root.fileCount, symbolCount: root.symbolCount },
  };
}

function collectFiles(dir: TocDir): TocFile[] {
  const files: TocFile[] = [];
  for (const child of dir.children) {
    if (isTocFile(child)) files.push(child);
    else files.push(...collectFiles(child));
  }
  return files;
}

function fileSection(file: TocFile): string {
  const parts = normalizePath(file.path).split("/").filter(Boolean);
  const name = parts.pop() ?? file.path;
  const dir = parts.join("/") || ".";
  const lines = [`## ${dir} / ${name} — ${file.summary}`];
  for (const symbol of file.symbols.slice(0, 2)) {
    lines.push(`- ${symbol.identity}`);
  }
  return lines.join("\n");
}

function fileDepth(filePath: string): number {
  return normalizePath(filePath).split("/").filter(Boolean).length;
}

/**
 * Markdown outline for State 0. Drops deepest files first when over the
 * token budget (1 token ≈ 4 chars).
 */
export function formatTocForPrompt(
  book: MemoryBook,
  budgetTokens: number = DEFAULT_BUDGET_TOKENS
): string {
  const files = collectFiles(book.root).sort((a, b) =>
    comparePath(a.path, b.path)
  );
  const selected = files.slice();

  const render = () => selected.map(fileSection).join("\n");
  let text = render();

  while (selected.length > 0 && estimateTokens(text) > budgetTokens) {
    let dropIdx = 0;
    let bestDepth = -1;
    for (let i = 0; i < selected.length; i++) {
      const depth = fileDepth(selected[i].path);
      if (depth > bestDepth || (depth === bestDepth && i >= dropIdx)) {
        bestDepth = depth;
        dropIdx = i;
      }
    }
    selected.splice(dropIdx, 1);
    text = render();
  }

  if (estimateTokens(text) > budgetTokens) {
    return text.slice(0, Math.max(0, budgetTokens * TOKEN_CHARS));
  }
  return text;
}

function dirId(path: string): string {
  return `dir:${path}`;
}

function fileId(path: string): string {
  return `file:${path}`;
}

function symbolId(filePath: string, identity: string): string {
  return `symbol:${filePath}:${identity}`;
}

function shortIntent(intent: string, max = 48): string {
  const trimmed = intent.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

function maxDirDepth(dir: TocDir, depth = 0): number {
  let max = depth;
  for (const child of dir.children) {
    if (isTocDir(child)) {
      max = Math.max(max, maxDirDepth(child, depth + 1));
    }
  }
  return max;
}

function containsEdge(source: string, target: string): FlowEdge {
  return {
    id: `contains:${source}->${target}`,
    source,
    target,
    data: { relation: "contains" },
  };
}

/**
 * Deterministic layered layout: directory columns on the left, then files,
 * then symbols. No random seeds.
 */
export function bookToFlow(book: MemoryBook): {
  nodes: FlowNode[];
  edges: FlowEdge[];
} {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const dirDepth = maxDirDepth(book.root);
  const fileX = (dirDepth + 1) * COL_WIDTH;
  const symbolX = (dirDepth + 2) * COL_WIDTH;
  let row = 0;

  function walkDir(dir: TocDir, depth: number) {
    const id = dirId(dir.path);
    const startRow = row;
    nodes.push({
      id,
      type: "bookDir",
      position: { x: depth * COL_WIDTH, y: startRow * ROW_HEIGHT },
      data: {
        kind: "dir",
        path: dir.path,
        label: dirName(dir.path),
      },
    });

    for (const child of dir.children) {
      if (isTocDir(child)) {
        const childId = dirId(child.path);
        edges.push(containsEdge(id, childId));
        walkDir(child, depth + 1);
        continue;
      }

      const fid = fileId(child.path);
      const fileRow = row;
      nodes.push({
        id: fid,
        type: "bookFile",
        position: { x: fileX, y: fileRow * ROW_HEIGHT },
        data: {
          kind: "file",
          path: child.path,
          summary: child.summary,
          label: fileName(child.path),
        },
      });
      edges.push(containsEdge(id, fid));

      if (child.symbols.length === 0) {
        row += 1;
        continue;
      }

      for (const symbol of child.symbols) {
        const sid = symbolId(child.path, symbol.identity);
        nodes.push({
          id: sid,
          type: "bookSymbol",
          position: { x: symbolX, y: row * ROW_HEIGHT },
          data: {
            kind: "symbol",
            intent: symbol.intent,
            identity: symbol.identity,
            filePath: child.path,
            startLine: symbol.startLine,
            label: shortIntent(symbol.intent),
          },
        });
        edges.push(containsEdge(fid, sid));
        row += 1;
      }
    }

    if (row === startRow) {
      row += 1;
    }
  }

  walkDir(book.root, 0);
  return { nodes, edges };
}
