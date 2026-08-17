/**
 * State 0 / phase-map wrapper around the CAG TOC string (011).
 * Hard cap is 400 tokens; 002 formatTocForPrompt drops deepest files first.
 */
import {
  formatTocForPrompt as formatBookToc,
  type MemoryBook,
} from "@/lib/memory/book-toc";

export const PHASE_MAP_TOC_BUDGET_TOKENS = 400;

export type MemoryToc = string;

export function formatTocForPrompt(
  book: MemoryBook,
  budgetTokens: number = PHASE_MAP_TOC_BUDGET_TOKENS
): MemoryToc {
  return formatBookToc(book, budgetTokens);
}
