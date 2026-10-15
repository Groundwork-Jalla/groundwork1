import { randomInt } from 'node:crypto';
import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { generateTemporaryPassword } from '../../src/lib/auth/temp-password.js';
import { isValidEmail } from '../../src/lib/email/is-valid-email.js';

/**
 * A partner contractor brings their own client onto Groundwork (109).
 *
 * ── A temporary password, the same as /admin/users/new ──────────────────────────────
 * The contractor is shown a one-time password to hand over, because that is how a client
 * is onboarded in person: the partner is sitting with them, and waiting on an email they
 * may not be able to open is the friction this is meant to remove.
 *
 * It does mean the contractor briefly holds a working credential for somebody else's
 * account. Two things bound that window, and both are load-bearing:
 *
 *   · `must_change_password` is set here and cleared only by a database trigger when the
 *     password hash actually changes (083). The client cannot get past it, and the
 *     moment they do the contractor's copy stops working.
 *   · `email_mfa_enabled` is set before the client has ever touched the account, so the
 *     first sign-in also needs a code sent to their inbox. Holding the password alone
 *     is not enough to sign in as them.
 *
 * The password is drawn here, returned in exactly one response, and never stored.
 *
 * ── Why the server and not an RPC ────────────────────────────────────────────────────
 * Creating an auth user needs the service role, which a browser must never hold. The
 * contractor check runs AS THE CALLER first, so the service role is only ever reached by
 * somebody the database already agrees is a contractor.
 *
 * ── Already has an account ───────────────────────────────────────────────────────────
 * Refused, with `client_exists`. Drawing a fresh password for an address that already has
 * an account would hand the contractor a working credential for somebody else's — an
 * account takeover with a nice UI. A client who is already on Groundwork brings a
 * contractor on the way that always existed: they invite them from inside their project.
 * 110 enforces the same rule in the database.
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

  // ── An address that already has an account is refused ──
  //
  // Handing a contractor a fresh password for somebody else's existing account would be
  // an account takeover with a nice UI. A client who is already on Groundwork brings a
  // contractor on the way that already existed: they invite them from inside their own
  // project.
  //
  // 110 enforces the same rule in the database, because this file is one deploy away
  // from being wrong again.
  const { data: existing } = await admin
    .from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing?.id) { res.status(409).json({ error: 'client_exists' }); return; }

  const password = generateTemporaryPassword(max => randomInt(0, max), { email, fullName });

  const { data: made, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    // The inbox is proven by the email second factor at first sign-in, not by a link.
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      // Their plan is chosen in the wizard that follows, not assumed here.
      onboarding_complete: true,
    },
  });
  if (createErr || !made?.user) {
    const dup = /already|exists|registered/i.test(createErr?.message ?? '');
    console.error('[invite-client] createUser failed:', createErr?.message ?? 'no user returned');
    res.status(dup ? 409 : 500).json({ error: dup ? 'client_exists' : 'create_failed' });
    return;
  }
  const clientId = made.user.id;

  // Both first-sign-in gates armed before the client has ever touched the account. These
  // columns are guarded (083) and only land under the service role.
  const { error: profErr } = await admin
    .from('profiles')
    .update({
      email_mfa_enabled:    true,
      must_change_password: true,
      provisioned_by:       caller.id,
      provisioned_at:       new Date().toISOString(),
    })
    .eq('id', clientId);
  if (profErr) {
    // An account that exists but is not marked would let the temporary password stand
    // indefinitely — the one thing that makes handing it over acceptable. Remove it
    // rather than hand back a half-made account.
    console.error('[invite-client] profile update failed, rolling back:', profErr.message);
    await admin.auth.admin.deleteUser(clientId);
    res.status(500).json({ error: 'create_failed' });
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
    // Without the link the wizard's insert is refused by RLS (109), so a half-done state
    // here is worse than a clear failure. Nobody has signed in to this account yet — the
    // password has not left the server — so removing it strands no owner.
    console.error('[invite-client] could not record the client link:', linkErr.message);
    await admin.auth.admin.deleteUser(clientId);
    res.status(500).json({ error: 'link_failed' });
    return;
  }

  // The password appears in exactly one place: this response body.
  res.status(200).json({ clientId, email, password });
}
