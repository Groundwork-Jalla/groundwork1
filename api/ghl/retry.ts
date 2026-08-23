import { deliver, type GhlEvent } from './_forward.js';

/**
 * Replay everything the CRM never received.
 *
 * A GHL outage used to lose events permanently: each push happens inline, and when it
 * failed the caller shrugged — correctly, because a signup must not fail over a CRM.
 * The event simply never happened. The outbox records the intent before the attempt, and
 * this is what drains it.
 *
 * ── Who may call it ──────────────────────────────────────────────────────────────────
 * An admin, from the applications screen — or Vercel Cron with a shared secret, if this
 * is ever put on a schedule. `vercel.json` has no crons today and this deliberately does
 * not add one: a button someone presses after seeing a count is honest, whereas a
 * schedule that quietly half-works is how the email outage lasted a month.
 *
 * ── Bounded on purpose ───────────────────────────────────────────────────────────────
 * A run does at most BATCH rows. If the CRM is still down, a large backlog would
 * otherwise mean hundreds of doomed requests inside one function invocation, and Vercel
 * would time out mid-way with nothing recorded. Small batches converge; one big sweep
 * fails whole.
 */

const BATCH = 25;

function isEvent(v: unknown): v is GhlEvent {
  return v === 'user_signup' || v === 'application_decision'
      || v === 'subscription_changed' || v === 'project_created';
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');

  // Two ways in. A cron secret lets this be scheduled later without reworking auth;
  // otherwise it is an admin pressing the button, checked as the caller so is_admin()
  // can read auth.uid().
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = String(req.headers?.authorization ?? '');
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const token = authHeader.replace(/^Bearer /i, '');
    if (!token) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error } = await asCaller.rpc('is_admin');
    if (error || isAdmin !== true) {
      res.status(403).json({ error: 'Admins only' });
      return;
    }
  }

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: readErr } = await db
    .from('ghl_outbox')
    .select('id, event, email, payload, attempts')
    .neq('status', 'sent')
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (readErr) {
    console.error('[ghl-retry] could not read the outbox:', readErr);
    res.status(500).json({ error: 'Could not read the outbox' });
    return;
  }

  let sent = 0, failed = 0;

  for (const row of rows ?? []) {
    if (!isEvent(row.event)) {
      // An event name this deployment no longer knows. Park it rather than retrying for
      // ever — a row nobody can deliver should not sit at the front of every batch.
      await db.from('ghl_outbox')
        .update({ status: 'failed', last_error: `unknown event "${row.event}"` })
        .eq('id', row.id);
      failed++;
      continue;
    }

    const payload = (row.payload ?? {}) as Record<string, any>;
    // The payload holds both the contact and the event fields, merged when it was
    // recorded. Split them back out so a replay sends exactly what the first attempt did.
    const { email, fullName, phone, country, city, lang, ...fields } = payload;

    const result = await deliver(
      row.event,
      row.email,
      { email: row.email, fullName, phone, country, city, lang },
      fields,
    );

    if (result.ok) {
      sent++;
      await db.from('ghl_outbox').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        contact_id: result.contactId ?? null,
        attempts: (row.attempts ?? 0) + 1,
        last_error: null,
      }).eq('id', row.id);
    } else {
      failed++;
      await db.from('ghl_outbox').update({
        status: 'failed',
        attempts: (row.attempts ?? 0) + 1,
        last_error: (result.reason ?? 'unknown').slice(0, 500),
      }).eq('id', row.id);

      // Nothing else will succeed either. Stop rather than burning the whole batch —
      // and the remaining rows keep their place at the front of the next run.
      if (result.reason === 'not_configured' || result.reason === 'unreachable') break;
    }
  }

  res.status(200).json({ ok: true, considered: rows?.length ?? 0, sent, failed });
}
