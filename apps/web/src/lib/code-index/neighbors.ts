/** RAG neighbor walk over symbol cards (002 §10.4). Never returns file bodies. */

export type SymbolCard = {
  intent: string;
  identity: string;
  filePath: string;
  startLine?: number;
  kind: string;
};

function cardKey(card: SymbolCard): string {
  return `${card.filePath}\0${card.identity}`;
}

function identityMatches(card: SymbolCard, identity: string): boolean {
  const needle = identity.trim();
  if (!needle) return false;
  return card.identity === needle || card.identity.includes(needle);
}

function heuristicallyReferences(from: SymbolCard, to: SymbolCard): boolean {
  if (from.identity.length < 2 || to.identity.length < 2) return false;
  if (to.intent.includes(from.identity) || to.identity.includes(from.identity)) {
    return true;
  }
  if (from.intent.includes(to.identity) || from.identity.includes(to.identity)) {
    return true;
  }
  return false;
}

/**
 * Same-file symbols plus heuristic `references` (identity substring).
 * `hops` is a BFS radius; the seed identity itself is omitted.
 */
export function expandNeighborsFromCards(
  symbols: SymbolCard[],
  identity: string,
  hops = 1
): SymbolCard[] {
  const trimmed = identity.trim();
  if (!trimmed || hops < 1) return [];

  const seeds = symbols.filter((s) => identityMatches(s, trimmed));
  if (seeds.length === 0) return [];

  const seedKeys = new Set(seeds.map(cardKey));
  const seen = new Set<string>(seedKeys);
  const found = new Map<string, SymbolCard>();
  let frontier = seeds;

  for (let hop = 0; hop < hops; hop++) {
    const next: SymbolCard[] = [];
    for (const from of frontier) {
      for (const candidate of symbols) {
        const key = cardKey(candidate);
        if (seen.has(key)) continue;
        const sameFile = candidate.filePath === from.filePath;
        const referenced = heuristicallyReferences(from, candidate);
        if (!sameFile && !referenced) continue;
        seen.add(key);
        found.set(key, candidate);
        next.push(candidate);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return [...found.values()];
}
