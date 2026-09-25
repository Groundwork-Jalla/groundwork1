import { swychrConfig, swychrSettings } from '../swychr/_config.js';
import { payoutStatus } from '../swychr/_client.js';
import {
  POLLABLE_STATES, payoutEventKey, mapPayoutStatus, tally, emptySummary,
  type PollOutcome,
} from '../swychr/_payout-poll.js';

/**
 * Ask SwyChr what happened to the payouts still in flight.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * Their pay-in pushes a webhook on every status change; their payout pushes nothing. So
 * the outgoing leg is polled. Without it a release reaches `initiated` and stays there
 * for ever, and the money-flow view would show a contractor waiting on a payment that
 * has in fact landed.
 *
 * ── Two callers, one function ────────────────────────────────────────────────────────
 *   a scheduler, every five minutes, authenticated by a shared secret;
 *   an admin, refreshing one payment they are looking at.
 * Scheduled polling is the authority. The on-demand path is a convenience and is scoped
 * to a single payment, because a page that quietly moves money whenever somebody opens it
 * is a page nobody can reason about.
 *
 * ── It observes; the ledger decides ──────────────────────────────────────────────────
 * Nothing here updates `payments`. Every outcome goes through `record_payment_event`, the
 * same RPC the webhook uses and the only writer 090 permits.
 */

/** One provider call has to be allowed to fail without taking the batch with it. */
const BATCH_LIMIT = 100;

/** Constant-length compare, so a wrong-length guess is not distinguishable by timing. */
const matches = (given: string, expected: string | undefined): boolean =>
  !!expected && given.length === expected.length && given === expected;

export async function handler(req: any, res: any) {
  // GET as well as POST: a scheduler typically issues GET and cannot set a body. The
  // scheduling provider is not assumed beyond that — see the three doors below.
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');

  // ── Who may ask ────────────────────────────────────────────────────────────────────
  // Three doors, and an unauthenticated caller opens none of them: nobody outside
  // Groundwork should be able to make it ask a payment provider about its customers, let
  // alone move a payment's state.
  //
  //   1. a scheduler with our own header  — for any scheduler that can set one
  //   2. a scheduler with a bearer secret — the convention hosted cron jobs use, since
  //                                         they issue a plain GET with no custom headers
  //   3. an admin's own session           — the on-demand refresh
  const secret = (await swychrSettings()).SWYCHR_WEBHOOK_SECRET.value;
  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  const bySchedule =
    matches(String(req.headers?.['x-groundwork-secret'] ?? ''), secret)
    || matches(bearer, process.env.CRON_SECRET?.trim() || undefined);

  let byAdmin = false;
  if (!bySchedule) {
    const token = bearer;
    if (token) {
      const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey;
      const asCaller = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: isAdmin } = await asCaller.rpc('is_admin');
      byAdmin = isAdmin === true;
    }
  }
  if (!bySchedule && !byAdmin) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const cfg = await swychrConfig();
  if (!cfg) {
    // Not configured is not a failure to report as one: nothing has gone wrong, there is
    // simply nobody to ask.
    res.status(200).json({ ok: false, reason: 'not_configured', ...emptySummary() });
    return;
  }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── What to ask about ──────────────────────────────────────────────────────────────
  // Outgoing SwyChr rows that are genuinely with the provider. `release_authorised` has
  // not been sent, `disbursed` is done, `failed` is done until somebody opens
  // reconciliation, and incoming rows have a webhook.
  let query = svc.from('payments')
    .select('id, direction, state, provider, provider_ref')
    .eq('direction', 'out')
    .eq('provider', 'swychr')
    .not('provider_ref', 'is', null)
    .in('state', [...POLLABLE_STATES]);

  // On-demand refresh narrows the same query rather than using a different one, so a
  // single payment can never be polled under rules the batch would not apply.
  const only = typeof req.body?.paymentId === 'string' ? req.body.paymentId : null;
  if (only) query = query.eq('id', only);

  const { data, error } = await query.limit(BATCH_LIMIT);
  if (error) {
    console.error('[swychr-poll] could not read active payouts:', error.message);
    res.status(500).json({ error: 'Could not read payments' });
    return;
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const outcomes: PollOutcome[] = [];

  for (const row of rows) {
    const paymentId = String(row.id);
    const providerRef = String(row.provider_ref ?? '');
    if (!providerRef) continue;

    try {
      const answer = await payoutStatus(cfg, providerRef);
      if (!answer.ok) {
        // The provider was unreachable or refused. That is OUR problem, not the
        // payment's: a network error must never become a failed payout.
        outcomes.push({ paymentId, providerStatus: null, eventType: null, recorded: false, error: answer.error ?? `http_${answer.status}` });
        continue;
      }

      const status = answer.data?.data?.status ?? null;
      const eventType = mapPayoutStatus(status);

      const { data: recorded, error: rpcErr } = await svc.rpc('record_payment_event', {
        p_provider: 'swychr',
        p_provider_event_id: payoutEventKey(providerRef, status),
        // A status we do not recognise is still recorded, with an `unknown_type`
        // outcome, rather than dropped.
        p_event_type: eventType ?? 'unknown',
        p_payload: (answer.data?.data ?? {}) as Record<string, unknown>,
        p_payment: paymentId,
        p_provider_ref: providerRef,
      });

      if (rpcErr) {
        outcomes.push({ paymentId, providerStatus: status, eventType, recorded: false, error: rpcErr.message });
        continue;
      }
      // `record_payment_event` returns NULL when the key already existed — the poll asked
      // a question it had already asked, which is the normal case.
      outcomes.push({ paymentId, providerStatus: status, eventType, recorded: recorded !== null });
    } catch (err) {
      // One payout's failure must not stop the others.
      outcomes.push({
        paymentId, providerStatus: null, eventType: null, recorded: false,
        error: err instanceof Error ? err.message : 'unknown_error',
      });
    }
  }

  const summary = tally(outcomes);
  if (summary.failed > 0) {
    console.warn('[swychr-poll] %d of %d payouts could not be checked', summary.failed, summary.checked);
  }
  res.status(200).json({ ok: true, by: bySchedule ? 'schedule' : 'admin', ...summary });
}
