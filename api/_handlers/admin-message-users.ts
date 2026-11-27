import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { sendViaResend } from '../_lib/resend-send.js';
import {
  adminBroadcastHtml,
  adminBroadcastText,
  resolveBroadcastActionUrl,
} from '../../src/lib/email/admin-broadcast-html.js';
import { senderFor } from '../../src/lib/email/senders.js';

/**
 * Send a custom branded email from `/admin/users` to a selected cohort of registered
 * users (for example, everyone who signed up and has not activated a project yet).
 *
 * ── Security boundaries ──────────────────────────────────────────────────────────────
 * 1. Caller must hold a valid session AND `role = 'admin'` in `user_roles`.
 * 2. Recipients are resolved strictly by `userIds` from Supabase (`profiles` with
 *    `auth.admin.getUserById` fallback) — never raw arbitrary email addresses from the
 *    request body — so this endpoint cannot be used as an open relay.
 * 3. Every message is rendered through `adminBroadcastHtml()` (escaped plain text inside
 *    Groundwork's green email shell), never raw caller HTML.
 * 4. Optional CTA URLs are restricted to Groundwork relative routes or `https://` URLs.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 500;
const PROFILE_CHUNK = 100;
const SEND_CONCURRENCY = 2;
const BATCH_PAUSE_MS = 250;

interface RequestBody {
  userIds?: unknown;
  subject?: unknown;
  message?: unknown;
  lang?: unknown;
  includeActionLink?: unknown;
  actionLabel?: unknown;
  actionPath?: unknown;
}

interface Recipient {
  id: string;
  email: string;
  fullName: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseUserIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length > MAX_RECIPIENTS) return null;
  }
  return out;
}

async function resolveRecipients(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
): Promise<{ recipients: Recipient[]; skipped: number }> {
  const byId = new Map<string, Recipient>();

  for (let i = 0; i < userIds.length; i += PROFILE_CHUNK) {
    const slice = userIds.slice(i, i + PROFILE_CHUNK);
    const { data } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', slice);

    for (const row of (data ?? []) as { id?: string; email?: string; full_name?: string }[]) {
      const id = typeof row.id === 'string' ? row.id : '';
      const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
      if (!id || !EMAIL_RE.test(email)) continue;
      byId.set(id, {
        id,
        email,
        fullName: typeof row.full_name === 'string' ? row.full_name.trim() : '',
      });
    }
  }

  // Fallback for accounts whose profile row is absent or missing an email mirror.
  for (const id of userIds) {
    if (byId.has(id)) continue;
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const u = data?.user;
      const email = typeof u?.email === 'string' ? u.email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(email)) continue;
      const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
      const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
      byId.set(id, { id, email, fullName });
    } catch {
      // Unresolvable id — counted as skipped below.
    }
  }

  const seenEmails = new Set<string>();
  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const id of userIds) {
    const rec = byId.get(id);
    if (!rec || seenEmails.has(rec.email)) {
      skipped++;
      continue;
    }
    seenEmails.add(rec.email);
    recipients.push(rec);
  }

  return { recipients, skipped };
}

export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const caller = await requireUser(req);
  if (!caller) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[admin-message-users] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  // Service role bypasses RLS; verify admin role explicitly before touching any user data.
  const { data: role } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .eq('role', 'admin')
    .maybeSingle();
  if (!role) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const body = (req.body ?? {}) as RequestBody;
  const userIds = parseUserIds(body.userIds);
  if (!userIds || userIds.length === 0) {
    res.status(400).json({ error: 'recipients_required' });
    return;
  }

  const subject = cleanText(body.subject, 160);
  const message = cleanText(body.message, 8000);
  if (subject.length < 2) {
    res.status(400).json({ error: 'subject_required' });
    return;
  }
  if (message.length < 2) {
    res.status(400).json({ error: 'message_required' });
    return;
  }

  const lang: 'en' | 'fr' = body.lang === 'fr' ? 'fr' : 'en';
  const includeActionLink = body.includeActionLink !== false;
  const rawActionPath = includeActionLink
    ? (cleanText(body.actionPath, 300) || '/projects/new')
    : null;
  if (includeActionLink && !resolveBroadcastActionUrl(rawActionPath)) {
    res.status(400).json({ error: 'invalid_action_url' });
    return;
  }
  const actionLabel = includeActionLink ? (cleanText(body.actionLabel, 80) || null) : null;

  const { recipients, skipped } = await resolveRecipients(admin, userIds);
  if (recipients.length === 0) {
    res.status(400).json({ error: 'no_valid_recipients' });
    return;
  }

  const from = senderFor('other');
  const batchId = randomUUID();
  let sent = 0;
  let failed = 0;
  const failures: { email: string; error: string }[] = [];

  for (let i = 0; i < recipients.length; i += SEND_CONCURRENCY) {
    const wave = recipients.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(wave.map(async recipient => {
      const html = adminBroadcastHtml({
        recipientName: recipient.fullName,
        body: message,
        lang,
        actionLabel,
        actionPath: rawActionPath,
      });
      const text = adminBroadcastText({
        recipientName: recipient.fullName,
        body: message,
        lang,
        actionLabel,
        actionPath: rawActionPath,
      });
      const result = await sendViaResend({
        from,
        to: recipient.email,
        subject,
        html,
        text,
        idempotencyKey: `admin-msg:${batchId}:${recipient.id}`,
        tags: [{ name: 'kind', value: 'admin_user_message' }],
      });
      return { recipient, result };
    }));

    for (const { recipient, result } of results) {
      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (failures.length < 25) {
          failures.push({ email: recipient.email, error: result.error ?? 'send_failed' });
        }
      }
    }

    if (i + SEND_CONCURRENCY < recipients.length) {
      await sleep(BATCH_PAUSE_MS);
    }
  }

  // Best-effort audit record — never hide a completed send if activity logging is unavailable.
  try {
    await admin.rpc('log_activity', {
      p_project_id: null,
      p_action: 'admin.users_messaged',
      p_entity_type: 'user_broadcast',
      p_entity_id: null,
      p_actor_id: caller.id,
      p_metadata: {
        batch_id: batchId,
        subject,
        lang,
        requested: userIds.length,
        sent,
        failed,
        skipped,
      },
    });
  } catch {
    // Non-blocking audit log.
  }

  res.status(200).json({
    ok: failed === 0,
    batchId,
    sent,
    failed,
    skipped,
    failures,
  });
}
