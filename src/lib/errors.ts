/**
 * Turn an unknown thrown value into something a human can act on.
 *
 * Every catch block in the app used to read:
 *
 *     err instanceof Error ? err.message : t('common.somethingWrong')
 *
 * which is wrong for the errors we actually throw most. supabase-js rejects with a
 * `PostgrestError` — a PLAIN OBJECT of { message, details, hint, code }, not an Error
 * instance. So `instanceof` was false every time and the real cause was discarded in
 * favour of "Something went wrong. Please refresh the page."
 *
 * That cost real debugging time: a 400 on project creation showed the same generic
 * sentence whether the cause was a missing column, a failed CHECK constraint or an RLS
 * policy — three problems with completely different fixes.
 *
 * `details` and `hint` are included because PostgREST puts the useful part there:
 * message says "column projects.offices does not exist", hint often names the fix.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;

  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint]
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

    if (parts.length > 0) {
      // Deduplicate: PostgREST sometimes repeats the message in details.
      const seen = [...new Set(parts.map(p => p.trim()))].join(' — ');
      const code = typeof e.code === 'string' && e.code ? ` (${e.code})` : '';
      return seen + code;
    }
  }

  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

/**
 * Is this "the table does not exist yet"?
 *
 * The one error class where the raw message is the WRONG thing to show. Everything else
 * benefits from Postgres's own wording — a failed CHECK and an RLS refusal need different
 * fixes and only the real message tells them apart. But a missing table has exactly one
 * cause and one fix: a migration that has not been run. "Could not find the table
 * 'public.agent_requests' in the schema cache (PGRST205)" is precise, actionable for a
 * developer, and meaningless to the CEO looking at the screen.
 *
 * `PGRST205` is PostgREST's schema-cache miss; `42P01` is Postgres's own undefined_table,
 * which surfaces through RPCs and raw SQL.
 */
export function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as Record<string, unknown>).code;
  return code === 'PGRST205' || code === '42P01';
}
