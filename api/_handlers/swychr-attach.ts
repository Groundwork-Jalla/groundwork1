import {
  normaliseReference, attachRefusal, attachEventKey,
} from '../../src/lib/payments/payout-reference.js';

/**
 * Tell the ledger that an authorised release is now with SwyChr.
 *
 * ── Why a human does this ────────────────────────────────────────────────────────────
 * Groundwork records and governs; SwyChr holds and moves. The payout itself is created
 * on SwyChr's side, so Groundwork cannot learn of it by itself: the published contract
 * gives payouts no webhook, and the status endpoint answers "what happened to THIS
 * transaction id" — there is no way to ask which transactions exist. Somebody who can
 * see both screens supplies the one fact that links them.
 *
 * ── Why this is the whole gap ────────────────────────────────────────────────────────
 * Everything downstream already runs. `record_payment_event` accepts
 * `release_authorised → initiated`, stamps `initiated_at`, and writes `provider_ref`;
 * the five-minute cron then polls every row in `initiated` and drives it to `disbursed`
 * or `failed` on SwyChr's word. Before a reference exists the poll cannot see the row,
 * which is why an authorised release sits still forever without this.
 *
 * ── What it deliberately cannot do ───────────────────────────────────────────────────
 * It does not move money, choose an amount, or touch a currency: the transfer has
 * already happened on SwyChr. It cannot change a reference once set — see
 * `attachRefusal`. And it cannot invent a state: the only transition it can cause is
 * the one 090's table already allows, refused in SQL if the row is not where it claims.
 *
 * Reached as `POST /api/events?action=swychr-attach`, so it costs no function slot.
 */
export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Recording that money has moved is an administrator's act, not a member's.
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const paymentId = typeof req.body?.paymentId === 'string' ? req.body.paymentId.trim() : '';
  const reference = normaliseReference(req.body?.reference);
  if (!paymentId) {
    res.status(400).json({ error: 'missing_payment' });
    return;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Read the row first so a refusal names the actual reason. `record_payment_event`
  // would refuse an illegal transition too, but it answers with an event id and an
  // `illegal_transition` outcome — true, and useless to somebody holding a reference
  // they cannot file.
  const { data: row, error: readErr } = await admin
    .from('payments')
    .select('id, direction, state, provider_ref, project_id')
    .eq('id', paymentId)
    .maybeSingle();

  if (readErr) {
    res.status(500).json({ error: 'lookup_failed', detail: readErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const refusal = attachRefusal(
    { direction: row.direction, state: row.state, providerRef: row.provider_ref },
    reference,
  );
  if (refusal) {
    res.status(409).json({ error: refusal, state: row.state });
    return;
  }

  const { data: eventId, error: rpcErr } = await admin.rpc('record_payment_event', {
    p_provider: 'swychr',
    p_provider_event_id: attachEventKey(reference as string),
    p_event_type: 'initiated',
    // What Groundwork knows at this moment, and no more. The poll fills in SwyChr's own
    // account of the transfer as soon as it runs.
    p_payload: { source: 'admin_attach', transaction_id: reference },
    p_payment: paymentId,
    p_provider_ref: reference,
  });

  if (rpcErr) {
    res.status(500).json({ error: 'record_failed', detail: rpcErr.message });
    return;
  }

  // NULL means the key already existed: somebody filed this reference already, and the
  // ledger is unchanged. That is a success, not a conflict — the desired state holds.
  res.status(200).json({
    ok: true,
    recorded: eventId !== null,
    reference,
    paymentId,
  });
}
