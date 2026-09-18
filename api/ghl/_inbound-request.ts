/**
 * The HTTP request around an inbound GHL payload, reduced to what could establish identity.
 *
 * Phase 6.2, Option 2 (06 §16.7). The workflow Webhook body carries no message or
 * conversation id and cannot be configured to (§16.6). Whether GoHighLevel puts one in a
 * header is unknown because `inbound.ts` never kept headers. This keeps them — sanitised
 * BEFORE the row exists, so nothing secret or network-identifying can reach the table:
 *
 *   never   x-groundwork-secret, authorization, cookie, and any name containing
 *           secret / token / key
 *   never   anything the edge adds about the caller: every x-vercel-* header (the first
 *           real capture on 18 Sep 2026 showed Vercel spells the client IP
 *           x-vercel-forwarded-for / x-vercel-proxied-for and adds ip-city, ip-latitude,
 *           ja4-digest, proxy-signature …), x-invocation-id, and any name containing
 *           forwarded / proxied / real-ip / client-ip
 *   not     user-agent, content-type — already known to say nothing about identity
 *
 * Values are cut at 512 characters, the whole object at 8 KB. Pure: no I/O, no logging.
 */

export const HEADER_VALUE_MAX = 512;
export const REQUEST_META_MAX_BYTES = 8 * 1024;

/** Exact names that never leave the request. Lower-case; Node lower-cases header names. */
const DROP_EXACT = new Set([
  'x-groundwork-secret', 'authorization', 'cookie',
  'x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip',
  'x-invocation-id', 'user-agent', 'content-type',
]);
/** Name fragments that never leave the request: secrets, and anything about the caller. */
const DROP_FRAGMENT = /secret|token|key|forwarded|proxied|real-ip|client-ip/;
/** Whole families the platform adds about the request — never GHL's identity. */
const DROP_PREFIX = ['x-vercel-'];

export const keepHeader = (name: string): boolean => {
  const n = name.toLowerCase();
  return !DROP_EXACT.has(n) && !DROP_FRAGMENT.test(n) && !DROP_PREFIX.some(p => n.startsWith(p));
};

const cut = (v: string): string => (v.length > HEADER_VALUE_MAX ? v.slice(0, HEADER_VALUE_MAX) : v);
const flat = (v: unknown): string | null =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.filter(x => typeof x === 'string').join(', ') : null;

export interface RequestMeta {
  method: string | null;
  query: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * Build the stored object from a Node/Vercel request. Never throws on odd input; returns
 * null only when there is nothing at all to keep. Applied to a request whose secret has
 * already been checked — the secret itself is dropped by name, whatever else happens.
 */
export function requestMeta(req: { method?: unknown; query?: unknown; headers?: unknown }): RequestMeta | null {
  const headers: Record<string, string> = {};
  const rawHeaders = req?.headers && typeof req.headers === 'object' ? (req.headers as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (!keepHeader(name)) continue;
    const s = flat(value);
    if (s !== null) headers[name.toLowerCase()] = cut(s);
  }

  const query: Record<string, string> = {};
  const rawQuery = req?.query && typeof req.query === 'object' ? (req.query as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(rawQuery)) {
    if (!keepHeader(name)) continue;               // the same names are secrets in a query string too
    const s = flat(value);
    if (s !== null) query[name] = cut(s);
  }

  const meta: RequestMeta = { method: typeof req?.method === 'string' ? req.method : null, query, headers };
  if (!meta.method && !Object.keys(query).length && !Object.keys(headers).length) return null;

  // Cap the whole object: drop the longest header values first until it fits.
  while (JSON.stringify(meta).length > REQUEST_META_MAX_BYTES) {
    const longest = Object.entries(meta.headers).sort((a, b) => b[1].length - a[1].length)[0];
    if (!longest) break;
    delete meta.headers[longest[0]];
  }
  return meta;
}
