export function parseSseAfterId(request: {
  url: string;
  headers: { get(name: string): string | null };
}): number {
  const url = new URL(request.url, "http://localhost");
  const fromQuery = url.searchParams.get("afterId");
  const fromHeader =
    request.headers.get("Last-Event-ID") ??
    request.headers.get("last-event-id");
  const raw = fromQuery ?? fromHeader;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function replayAfter<T extends { id: number }>(
  events: T[],
  afterId: number
): T[] {
  return events.filter((e) => e.id > afterId).sort((a, b) => a.id - b.id);
}

/** Drop live events already covered by replay (id ≤ last replayed). */
export function liveAfterReplay<T extends { id: number }>(
  replayed: T[],
  live: T[]
): T[] {
  const lastId = replayed.at(-1)?.id ?? 0;
  const seen = new Set(replayed.map((e) => e.id));
  return live.filter((e) => e.id > lastId && !seen.has(e.id));
}

export function formatSseEvent(ev: { id: number; kind: string }): string {
  const data = JSON.stringify(ev);
  if (ev.id > 0) {
    return `id: ${ev.id}\nevent: ${ev.kind}\ndata: ${data}\n\n`;
  }
  return `event: ${ev.kind}\ndata: ${data}\n\n`;
}
