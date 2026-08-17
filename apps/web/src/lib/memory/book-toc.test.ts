import { describe, expect, it } from "vitest";
import {
  bookToFlow,
  buildMemoryBook,
  estimateTokens,
  fileSummary,
  formatTocForPrompt,
  isTocFile,
} from "./book-toc";

const TWO_FILES = [
  {
    filePath: "src/a.ts",
    identity: "alpha(name: string) -> void",
    intent: "Writes the alpha log line",
    kind: "function",
    startLine: 4,
  },
  {
    filePath: "src/a.ts",
    identity: "class Alpha",
    intent: "Holds alpha helpers",
    kind: "class",
    startLine: 12,
  },
  {
    filePath: "src/b.ts",
    identity: "beta() -> number",
    intent: "Counts beta events",
    kind: "function",
    startLine: 2,
  },
];

function collectFiles(book: ReturnType<typeof buildMemoryBook>) {
  const files: string[] = [];
  function walk(dir: (typeof book)["root"]) {
    for (const child of dir.children) {
      if (isTocFile(child)) files.push(child.path);
      else walk(child);
    }
  }
  walk(book.root);
  return files.sort();
}

describe("buildMemoryBook", () => {
  it("builds a TOC with two files under src/", () => {
    const book = buildMemoryBook(TWO_FILES);
    expect(collectFiles(book)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(book.stats.fileCount).toBe(2);
    expect(book.stats.symbolCount).toBe(3);
  });
});

describe("fileSummary", () => {
  it("joins unique intents and stays within 160 chars", () => {
    const book = buildMemoryBook(TWO_FILES);
    const src = book.root.children.find((c) => !isTocFile(c));
    expect(src && !isTocFile(src)).toBe(true);
    if (!src || isTocFile(src)) return;
    const a = src.children.find((c) => isTocFile(c) && c.path === "src/a.ts");
    expect(a && isTocFile(a)).toBe(true);
    if (!a || !isTocFile(a)) return;
    expect(a.summary.length).toBeGreaterThan(0);
    expect(a.summary.length).toBeLessThanOrEqual(160);
    expect(a.summary).toContain("Writes the alpha log line");
    expect(fileSummary(a.symbols)).toBe(a.summary);
  });

  it("truncates long intent lists", () => {
    const long = "x".repeat(80);
    const summary = fileSummary([
      { identity: "a()", intent: long, kind: "function" },
      { identity: "b()", intent: long + "y", kind: "function" },
      { identity: "c()", intent: long + "z", kind: "function" },
    ]);
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary.endsWith("...")).toBe(true);
  });
});

describe("bookToFlow", () => {
  it("emits dir, file, and symbol nodes with contains edges", () => {
    const flow = bookToFlow(buildMemoryBook(TWO_FILES));
    const kinds = new Set(flow.nodes.map((n) => n.data.kind));
    expect(kinds.has("dir")).toBe(true);
    expect(kinds.has("file")).toBe(true);
    expect(kinds.has("symbol")).toBe(true);
    expect(flow.edges.every((e) => e.data.relation === "contains")).toBe(true);
    const dirX = Math.min(
      ...flow.nodes.filter((n) => n.data.kind === "dir").map((n) => n.position.x)
    );
    const fileX = Math.min(
      ...flow.nodes.filter((n) => n.data.kind === "file").map((n) => n.position.x)
    );
    const symbolX = Math.min(
      ...flow.nodes
        .filter((n) => n.data.kind === "symbol")
        .map((n) => n.position.x)
    );
    expect(dirX).toBeLessThan(fileX);
    expect(fileX).toBeLessThan(symbolX);
  });

  it("is deterministic", () => {
    const a = bookToFlow(buildMemoryBook(TWO_FILES));
    const b = bookToFlow(buildMemoryBook(TWO_FILES));
    expect(a).toEqual(b);
  });
});

describe("formatTocForPrompt", () => {
  it("respects a tiny token budget by dropping files", () => {
    const book = buildMemoryBook(TWO_FILES);
    const full = formatTocForPrompt(book, 400);
    expect(full).toContain("src / a.ts");
    expect(full).toContain("src / b.ts");

    const tiny = formatTocForPrompt(book, 8);
    expect(estimateTokens(tiny)).toBeLessThanOrEqual(8);
    expect(tiny.length).toBeLessThan(full.length);
  });
});
