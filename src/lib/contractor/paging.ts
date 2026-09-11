/**
 * Paging arithmetic for the CRM backfill.
 *
 * Pulled out of the handler so it can be tested as behaviour rather than as source text.
 * The handler used to take the oldest `MAX_PER_RUN` rows with no offset and no cursor,
 * which meant "re-run to continue" replayed the same first page forever and rows past
 * it were unreachable. Fine at 29 contractors; a silent cap at 6% of a list of 650.
 *
 * No imports, no `import.meta`: reachable from `api/`. See api/README.md.
 */

/** Inclusive row window for one run — the two arguments Supabase's `.range()` takes. */
export function pageWindow(offset: number, size: number): { from: number; to: number } {
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  return { from, to: from + size - 1 };
}

/**
 * Where the next run starts, or null when this one came back short of a full page —
 * which is the only signal that the list has been exhausted, since nothing counts it.
 */
export function nextOffset(offset: number, seen: number, size: number): number | null {
  const from = pageWindow(offset, size).from;
  return seen >= size ? from + seen : null;
}
