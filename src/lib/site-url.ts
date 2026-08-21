/**
 * The one place the site's own origin is written down.
 *
 * **www is canonical.** The bare domain does not serve the app — `https://tryjalla.com`
 * answers 308 and sends the browser to `https://www.tryjalla.com`. Both therefore "work",
 * which is exactly why the two spellings drifted apart unnoticed: six email templates were
 * building links against the bare domain while the serverless functions defaulted to www.
 * Every one of those links cost a redirect, and a redirect on a link that carries an auth
 * token is one more step that can drop a query parameter or a fragment.
 *
 * Two constraints shape how this reads the environment, and both are load-bearing:
 *
 *   - **No `import.meta`.** These modules are reachable from `api/`, where it is a parse
 *     error rather than something a runtime guard can catch — see the note in
 *     `src/lib/i18n/translate.ts` and the rules in `api/README.md`.
 *   - **`process` must be guarded.** The same email builders run in the browser (via
 *     `src/lib/supabase/approvals.ts`) where Vite does not define it.
 *
 * `src/lib/site-url.test.ts` fails the build if a tryjalla origin is written anywhere else.
 */

/** Canonical origin. The only host that serves the app without a redirect. */
export const CANONICAL_SITE_URL = 'https://www.tryjalla.com';

/**
 * The origin to build links against.
 *
 * Prefers `PUBLIC_SITE_URL` so a preview deployment links to itself instead of quietly
 * sending a tester to production. Falls back to the canonical host in the browser, where
 * the variable is not available.
 */
export function siteUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env ? process.env.PUBLIC_SITE_URL : undefined;
  return stripTrailingSlash(fromEnv || CANONICAL_SITE_URL);
}

/** Join a path onto the site origin without doubling or dropping the slash. */
export function siteLink(path: string): string {
  return `${siteUrl()}/${path.replace(/^\/+/, '')}`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
