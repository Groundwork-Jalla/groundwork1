import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';

/**
 * Delete a contractor's account outright (113/114).
 *
 * ── Why this is a server action and not an RPC ───────────────────────────────────────
 * 113 tried to do it in SQL and could never have worked: in Supabase the `auth` schema
 * belongs to `supabase_auth_admin`, so a SECURITY DEFINER function owned by `postgres`
 * has no DELETE privilege on `auth.users`. Every call raised `insufficient_privilege` and
 * the browser showed a generic failure. Deleting an auth user is the Admin API's job,
 * with the service role — the same call `admin-provision-user.ts` uses to roll back a
 * half-made account.
 *
 * ── The decision stays in the database ───────────────────────────────────────────────
 * `admin_can_delete_contractor` answers whether this account MAY go: not staff, no money
 * on its way to them, and no work on somebody else's build referencing them. Those are
 * questions about data, and keeping them in SQL means one answer rather than two that can
 * drift. This handler asks, and does as it is told.
 *
 * ── Irreversible ────────────────────────────────────────────────────────────────────
 * The cascade takes their profile, roles, payout details and any project they OWN. The
 * audit row is written first, because afterwards there is nothing left to describe.
 */

export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const caller = await requireUser(req);
  if (!caller) { res.status(401).json({ error: 'Sign in required' }); return; }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[delete-contractor] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
  if (!userId) { res.status(400).json({ error: 'no_user' }); return; }

  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';

  // Authorise as the CALLER: the precheck's `is_admin()` reads auth.uid(), which a
  // service-role client does not have.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Clear everything pointing at them, then remove the row. Two halves because two
  // different owners: `postgres` owns the public tables, `supabase_auth_admin` owns
  // `auth.users`, and neither can do the other's part. 113 learned that the hard way.
  //
  // The purge carries its own guards — staff, yourself, money on its way — and records
  // the deletion while there is still something to describe.
  const { error: purgeErr } = await asCaller.rpc('admin_purge_contractor', { p_user: userId });
  if (purgeErr) {
    const msg = purgeErr.message ?? '';
    const known = ['money_in_flight', 'self_removal', 'is_admin_account', 'not_admin', 'no_user']
      .find(c => msg.includes(c));
    console.error('[delete-contractor] purge refused:', msg);
    res.status(known === 'not_admin' ? 403 : 409).json({
      error: known ?? 'delete_failed',
      detail: known ? undefined : msg,
    });
    return;
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    // Nothing should still reference them. If something does, say what — do not guess.
    console.error('[delete-contractor] deleteUser failed after purge:', delErr.message);
    res.status(409).json({ error: 'delete_failed', detail: delErr.message });
    return;
  }

  res.status(200).json({ ok: true, deleted: userId });
}
