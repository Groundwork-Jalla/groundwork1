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
 * Prefers `PUBLIC_SITE_URL` when it is a real site origin. Vercel's deployment hostname
 * is never customer-facing: if it leaks into this setting, use the canonical domain.
 */
export function siteUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env ? process.env.PUBLIC_SITE_URL : undefined;
  return trustedSiteOrigin(fromEnv);
}

/** Join a path onto the site origin without doubling or dropping the slash. */
export function siteLink(path: string): string {
  return `${siteUrl()}/${path.replace(/^\/+/, '')}`;
}

/** Resolve a configured or request-derived origin without exposing Vercel hostnames. */
export function trustedSiteOrigin(value?: string): string {
  if (!value) return CANONICAL_SITE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return CANONICAL_SITE_URL;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'vercel.app' || hostname.endsWith('.vercel.app')
      || hostname === 'vercel.com' || hostname.endsWith('.vercel.com')
    ) return CANONICAL_SITE_URL;
    return url.origin;
  } catch {
    return CANONICAL_SITE_URL;
  }
}
