import { getSupabaseAdmin, requireUser, findOrCreateUserByEmail } from '../_lib/stripe.js';
import { siteUrl } from '../../src/lib/site-url.js';
import { isValidEmail } from '../../src/lib/email/is-valid-email.js';

/**
 * A partner contractor brings their own client onto Groundwork (109).
 *
 * ── What this does, and the one thing it deliberately does not ───────────────────────
 * It invites the address and records the link. It does NOT mint a credential: Supabase's
 * `inviteUserByEmail` creates the account and mails the only way into it in a single
 * step, so the client sets their own password and the contractor never sees one.
 *
 * That is the whole difference from admin-provision-user.ts, which shows staff a
 * temporary password. Staff are accountable to Jalla. A contractor is a third party, and
 * handing them a working credential for a client's account would make every project that
 * client ever owns repudiable — "the contractor could have done that as me".
 *
 * ── Why the server and not an RPC ────────────────────────────────────────────────────
 * Creating an auth user needs the service role, which a browser must never hold. The
 * contractor check runs AS THE CALLER first, so the service role is only ever reached by
 * somebody the database already agrees is a contractor.
 *
 * ── Already has an account ───────────────────────────────────────────────────────────
 * Fine, and common: a client may already be on Groundwork. `findOrCreateUserByEmail`
 * returns the existing id without sending anything, and the link is recorded all the
 * same. What it must never do is overwrite or re-credential that account.
 */

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

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
    console.error('[invite-client] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const email    = str(req.body?.email, 254).toLowerCase();
  const fullName = str(req.body?.fullName, 120);
  if (!isValidEmail(email)) { res.status(400).json({ error: 'invalid_email' }); return; }
  if (fullName.length < 2)  { res.status(400).json({ error: 'name_required' }); return; }

  // ── The gate ──
  // Contractor standing is the role OR an accepted assignment — the same definition
  // `holdsContractorAccess` uses in the browser, kept here in SQL so the two cannot
  // drift into disagreeing about who is a contractor.
  const { data: roleRow } = await admin
    .from('user_roles').select('role')
    .eq('user_id', caller.id).eq('role', 'contractor').limit(1);
  let isContractor = (roleRow?.length ?? 0) > 0;
  if (!isContractor) {
    const { data: assigned } = await admin
      .from('contractor_invites').select('id')
      .eq('contractor_user_id', caller.id).eq('status', 'accepted').limit(1);
    isContractor = (assigned?.length ?? 0) > 0;
  }
  if (!isContractor) {
    // Same answer as a wrong path: somebody who is not a contractor learns nothing.
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Inviting yourself would make you your own client and the CHECK in 109 refuses the
  // link anyway; saying so is friendlier than a constraint violation.
  if (email === String(caller.email ?? '').toLowerCase()) {
    res.status(400).json({ error: 'self_invite' }); return;
  }

  let clientId: string;
  let created: boolean;
  try {
    const r = await findOrCreateUserByEmail(admin, email, {
      fullName,
      // They land on the password screen, then their project is waiting.
      redirectTo: `${siteUrl()}/auth/callback`,
    });
    clientId = r.userId;
    created = r.created;
  } catch (err) {
    console.error('[invite-client] could not invite:', err);
    res.status(502).json({ error: 'invite_failed' });
    return;
  }

  // ── The address already belonged to somebody ──
  //
  // `findOrCreateUserByEmail` returns an existing account silently, and 109 originally
  // linked it regardless. That let a contractor who knew any address on the platform
  // name it as their client and then create projects owned by that person, who had
  // agreed to nothing and was told nothing.
  //
  // For a NEW account the invitation is the consent — the only way in is the mail we
  // sent. For one that already exists it is not, so this refuses, and the contractor is
  // pointed at the route that already existed for exactly this: the client invites them
  // from inside their own project.
  //
  // 110 enforces the same rule in the database, because this file is one deploy away
  // from being wrong again.
  if (!created) {
    res.status(409).json({ error: 'client_exists' });
    return;
  }

  // The link is what lets this contractor create a project for them (109). Written under
  // the service role: `contractor_clients` grants nobody INSERT, so a contractor cannot
  // award themselves a client.
  const { error: linkErr } = await admin
    .from('contractor_clients')
    .upsert({ contractor_id: caller.id, client_id: clientId, client_was_created: true },
            { onConflict: 'contractor_id,client_id' });

  if (linkErr) {
    // Without the link the wizard's insert would be refused by RLS, so a half-done state
    // here is worse than a clear failure. The account, if it was just created, is a real
    // invited account and is left alone rather than deleted out from under its owner.
    console.error('[invite-client] could not record the client link:', linkErr.message);
    res.status(500).json({ error: 'link_failed', invited: created });
    return;
  }

  res.status(200).json({ clientId, email, invited: created });
}
