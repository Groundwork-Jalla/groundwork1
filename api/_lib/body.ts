/**
 * The request body, read once as bytes and parsed once — for `api/events.ts`.
 *
 * ── Why the switchboard reads its own body ───────────────────────────────────────────
 * Vercel parses `req.body` before a function runs, and in doing so consumes the bytes.
 * A webhook that is *signed* (a GoHighLevel Marketplace webhook, like a Stripe one) can
 * only be verified against the exact bytes the sender signed — a re-serialised object
 * will not match. So `events.ts` turns Vercel's parser off, reads the raw body here, and
 * gives every action both: `req.rawBody` (Buffer) for whoever must verify a signature,
 * and `req.body` parsed the way Vercel would have parsed it, so no existing handler sees
 * a difference.
 *
 * The parse mirrors Vercel's rules: JSON for `application/json`, form fields for
 * `application/x-www-form-urlencoded`, a string for `text/*`, otherwise the raw bytes.
 * Invalid JSON is a 400, as it was.
 */

export async function readRawBody(readable: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export type ParsedBody =
  | { ok: true; body: unknown }
  | { ok: false; error: string };

export function parseBody(raw: Buffer, contentType: string | undefined): ParsedBody {
  if (raw.length === 0) return { ok: true, body: undefined };
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) {
    try { return { ok: true, body: JSON.parse(raw.toString('utf8')) }; }
    catch { return { ok: false, error: 'Invalid JSON' }; }
  }
  if (type === 'application/x-www-form-urlencoded') {
    return { ok: true, body: Object.fromEntries(new URLSearchParams(raw.toString('utf8'))) };
  }
  if (type.startsWith('text/')) return { ok: true, body: raw.toString('utf8') };
  return { ok: true, body: raw };
}

/**
 * Read and parse once; attach both forms to the request. Returns false after answering
 * 400 when the body is unusable, so the caller simply stops.
 */
export async function attachBody(req: any, res: any): Promise<boolean> {
  if (req.method === 'GET' || req.method === 'HEAD') { req.rawBody = Buffer.alloc(0); return true; }
  const raw = await readRawBody(req);
  const parsed = parseBody(raw, req.headers?.['content-type']);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return false; }
  req.rawBody = raw;
  req.body = parsed.body;
  return true;
}
