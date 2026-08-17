import { describe, expect, it } from "vitest";
import { buildMemoryBook } from "@/lib/memory/book-toc";
import {
  PHASE_MAP_TOC_BUDGET_TOKENS,
  formatTocForPrompt,
} from "./memory-toc";

describe("formatTocForPrompt (011 wrapper)", () => {
  it("caps State 0 TOC at the 400-token budget", () => {
    expect(PHASE_MAP_TOC_BUDGET_TOKENS).toBe(400);
    const book = buildMemoryBook([
      {
        filePath: "src/a.ts",
        identity: "alpha()",
        intent: "does alpha",
        kind: "function",
        startLine: 1,
      },
    ]);
    const toc = formatTocForPrompt(book);
    expect(toc).toContain("src / a.ts");
    expect(toc).toContain("alpha()");
  });
});
