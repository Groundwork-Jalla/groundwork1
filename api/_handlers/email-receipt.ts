import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `/api/events?action=email-receipt` — Resend tells us what became of a message.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────
 *
 * Favour, 9 Nov 2026: "ensure that every email sent out actually delivers."
 *
 * A 200 from `POST /emails` means Resend ACCEPTED the message. It is not delivery, and
 * treating it as delivery is why nobody could answer "did Ada get her invitation?" for
 * any invitation ever sent. The mailbox can still bounce it, defer it or file it as
 * spam, and Resend says so — it emits `email.sent`, `email.delivered`, `email.bounced`,
 * `email.complained` and `email.delivery_delayed` for every message.
 *
 * This is the subscription. It writes the provider's verdict onto the invitation row,
 * which is what turns "we tried" into "it arrived" or "it bounced, here is why".
 *
 * ── Signed, because anyone can POST here ───────────────────────────────────────────
 *
 * Resend signs with Svix headers. Unverified, this endpoint would let a stranger mark
 * any invitation delivered — or, worse, mark a delivered one bounced and have staff
 * chase a client who already joined. The raw bytes are what was signed, so `rawBody`
 * is what is verified, exactly as `crm-inbound` does it (see api/_lib/body.ts).
 *
 * The secret lives in `app_config.resend_webhook_secret`, beside the other provider
 * credentials, so it can be rotated without a deploy. Absent, the endpoint refuses
 * everything rather than trusting the payload — an unverified receipt is worse than
 * no receipt.
 */

const SIGNED_WINDOW_SECONDS = 5 * 60;

type Status = 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed';

/** Resend's event names, mapped to what we store. */
const STATUS: Record<string, Status> = {
  'email.sent':            'sent',
  'email.delivered':       'delivered',
  'email.bounced':         'bounced',
  'email.complained':      'complained',
  'email.failed':          'failed',
  // A delay is not an outcome. It is recorded as `sent` so the row does not claim
  // delivery it has not had, and so a later `delivered` still lands normally.
  'email.delivery_delayed': 'sent',
};

/**
 * Svix: `v1,<base64>` entries, space separated, over `<id>.<timestamp>.<body>`.
 * The secret arrives as `whsec_<base64>`.
 */
function signatureValid(secret: string, id: string, ts: string, body: Buffer, header: string): boolean {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(raw, 'base64'); } catch { return false; }

  const expected = createHmac('sha256', key)
    .update(`${id}.${ts}.${body.toString('utf8')}`)
    .digest();

  for (const part of header.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    let got: Buffer;
    try { got = Buffer.from(value, 'base64'); } catch { continue; }
    // Length-checked first: timingSafeEqual throws on a mismatch rather than
    // returning false, and a thrown comparison would read as a server fault.
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.status(500).json({ error: 'Server is not configured' }); return; }

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: cfg } = await db
    .from('app_config').select('value').eq('key', 'resend_webhook_secret').maybeSingle();
  const secret = (cfg?.value as string | null) ?? process.env.RESEND_WEBHOOK_SECRET ?? '';
  if (!secret) {
    console.error('[email-receipt] no resend_webhook_secret — refusing unverified receipts');
    res.status(503).json({ error: 'Receipts are not configured' });
    return;
  }

  const id  = req.headers['svix-id'];
  const ts  = req.headers['svix-timestamp'];
  const sig = req.headers['svix-signature'];
  const raw: Buffer | undefined = req.rawBody;
  if (typeof id !== 'string' || typeof ts !== 'string' || typeof sig !== 'string' || !raw) {
    res.status(400).json({ error: 'Unsigned' });
    return;
  }

  // A captured request must not be replayable for ever.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > SIGNED_WINDOW_SECONDS) {
    res.status(400).json({ error: 'Stale' });
    return;
  }
  if (!signatureValid(secret, id, ts, raw, sig)) {
    res.status(401).json({ error: 'Bad signature' });
    return;
  }

  const body = req.body as { type?: string; data?: { email_id?: string; reason?: string } };
  const status = STATUS[String(body?.type ?? '')];
  const messageId = body?.data?.email_id;
  // An event we do not model is not an error — Resend adds them, and 2xx stops it
  // retrying something we will never act on.
  if (!status || !messageId) { res.status(200).json({ ok: true, ignored: true }); return; }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { email_status: status };
  if (status === 'sent')      patch.email_sent_at = now;
  if (status === 'delivered') { patch.email_delivered_at = now; patch.email_error = null; }
  if (status === 'bounced' || status === 'complained' || status === 'failed') {
    patch.email_error = String(body?.data?.reason ?? body?.type ?? '').slice(0, 500);
  }

  /**
   * The id is unique across both tables, so at most one row matches. Both are tried
   * rather than the caller being asked which kind of invitation this was — the
   * receipt does not know, and neither should this.
   *
   * `delivered` is terminal: a late `sent` arriving after it must not walk the row
   * backwards, and Resend does not guarantee order.
   */
  let matched = 0;
  for (const table of ['contractor_invites', 'project_viewers']) {
    let q = db.from(table).update(patch).eq('email_message_id', messageId);
    if (status === 'sent') q = q.neq('email_status', 'delivered');
    const { data, error } = await q.select('id');
    if (error) { console.error('[email-receipt]', table, error.message); continue; }
    matched += (data ?? []).length;
  }

  // 200 even when nothing matched: the message may be an email we send that is not an
  // invitation at all. Retrying would not make a row appear.
  res.status(200).json({ ok: true, status, matched });
}
