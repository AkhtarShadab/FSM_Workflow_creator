import { describe, expect, it } from "vitest";
import { expandNeighborsFromCards, type SymbolCard } from "./neighbors";

const CARDS: SymbolCard[] = [
  {
    filePath: "src/a.ts",
    identity: "alpha()",
    intent: "starts the alpha path",
    kind: "function",
    startLine: 1,
  },
  {
    filePath: "src/a.ts",
    identity: "beta()",
    intent: "same-file helper",
    kind: "function",
    startLine: 8,
  },
  {
    filePath: "src/b.ts",
    identity: "gamma()",
    intent: "unrelated",
    kind: "function",
    startLine: 1,
  },
  {
    filePath: "src/c.ts",
    identity: "wrap()",
    intent: "delegates to alpha()",
    kind: "function",
    startLine: 3,
  },
];

describe("expandNeighbors", () => {
  it("returns same-file symbols and omits the seed", () => {
    const neighbors = expandNeighborsFromCards(CARDS, "alpha()", 1);
    const identities = neighbors.map((n) => n.identity).sort();
    expect(identities).toContain("beta()");
    expect(identities).not.toContain("alpha()");
    expect(identities).not.toContain("gamma()");
  });

  it("includes heuristic identity-substring references", () => {
    const neighbors = expandNeighborsFromCards(CARDS, "alpha()", 1);
    expect(neighbors.some((n) => n.identity === "wrap()")).toBe(true);
  });
});
