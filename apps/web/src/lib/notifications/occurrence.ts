/**
 * Occurrence count is not a schema column (SB0). When a unread `dedupeKey`
 * collapses repeats, the count is packed into `body` with a sentinel the DTO
 * layer strips so N2 can show `×N`.
 */
const SEP = "\n\u2060×";

export function packOccurrenceBody(
  body: string | null,
  count: number
): string | null {
  if (count <= 1) return body;
  return `${body ?? ""}${SEP}${count}`;
}

export function unpackOccurrenceBody(stored: string | null): {
  body: string | null;
  count: number;
} {
  if (stored == null) return { body: null, count: 1 };
  const at = stored.lastIndexOf(SEP);
  if (at === -1) return { body: stored, count: 1 };
  const raw = stored.slice(at + SEP.length);
  const count = Number.parseInt(raw, 10);
  if (!Number.isFinite(count) || count < 2 || String(count) !== raw) {
    return { body: stored, count: 1 };
  }
  const text = stored.slice(0, at);
  return { body: text.length === 0 ? null : text, count };
}
