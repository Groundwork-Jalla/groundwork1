import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { isValidEmail } from '../../src/lib/email/is-valid-email.js';
import { siteUrl } from '../../src/lib/site-url.js';

/**
 * A partner contractor brings their own client onto Groundwork (109).
 *
 * The account must exist before the project can have an owner. That does not entitle
 * the contractor to a credential for it: only the client's inbox receives the invitation,
 * and the client chooses their own password before entering the app.
 *
 * Reserve a NEW, unconfirmed account without choosing a password, arm the first-sign-in
 * gates and record the contractor link, then send the email. Sending last means even a
 * client who opens it immediately cannot enter before the password gate is in place.
 *
 * `createUser` refuses duplicates, including a racing registration. Starting with
 * `inviteUserByEmail` or `generateLink` instead could reuse an existing unconfirmed
 * account and wrongly claim that this contractor created it (110).
 *
 * Existing accounts are refused with `client_exists`: their owner invites a contractor
 * from inside their own project. No password, session or invitation token is returned
 * to the caller. The guarded `must_change_password` flag clears only when the password
 * hash actually changes (083); login, callback and the app shell all enforce it.
 */

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (req.method === 'GET') res.setHeader('Cache-Control', 'no-store');

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

  if (req.method === 'GET') {
    // An account can outlive an unfinished wizard. Recover only clients this caller is
    // already allowed to build for (110), including accounts created on another device.
    // Profile reads use the server because contractors cannot read other users' profiles.
    const { data: linked, error: linksErr } = await admin
      .from('contractor_clients')
      .select('client_id, invited_at')
      .eq('contractor_id', caller.id)
      .or('client_was_created.eq.true,accepted_at.not.is.null')
      .order('invited_at', { ascending: false });
    if (linksErr) {
      console.error('[invite-client] pending client lookup failed:', linksErr.message);
      res.status(500).json({ error: 'pending_clients_failed' }); return;
    }
    if (!linked?.length) { res.status(200).json({ clients: [] }); return; }

    const clientIds = linked.map((link: { client_id: string }) => link.client_id);
    const [profiles, projects] = await Promise.all([
      admin.from('profiles').select('id, full_name, email').in('id', clientIds),
      // Check every project owned by these clients, including one the client created.
      // Existing projects belong on the work dashboard, not in a fresh creation wizard.
      admin.from('projects').select('user_id').in('user_id', clientIds),
    ]);
    if (profiles.error || projects.error) {
      console.error('[invite-client] pending client details failed:',
        profiles.error?.message ?? projects.error?.message);
      res.status(500).json({ error: 'pending_clients_failed' }); return;
    }

    const owners = new Set((projects.data ?? []).map((project: { user_id: string }) => project.user_id));
    const identities = new Map((profiles.data ?? []).map((profile: {
      id: string; full_name: string | null; email: string | null;
    }) => [profile.id, profile] as const));
    const clients = linked.flatMap((link: { client_id: string; invited_at: string }) => {
      const profile = identities.get(link.client_id);
      if (owners.has(link.client_id) || !profile?.email) return [];
      return [{
        clientId: link.client_id,
        fullName: profile.full_name?.trim() || profile.email,
        email: profile.email,
        invitedAt: link.invited_at,
      }];
    });
    res.status(200).json({ clients });
    return;
  }

  const email    = str(req.body?.email, 254).toLowerCase();
  const fullName = str(req.body?.fullName, 120);
  if (!isValidEmail(email)) { res.status(400).json({ error: 'invalid_email' }); return; }
  if (fullName.length < 2)  { res.status(400).json({ error: 'name_required' }); return; }

  // Inviting yourself would make you your own client and the CHECK in 109 refuses the
  // link anyway; saying so is friendlier than a constraint violation.
  if (email === String(caller.email ?? '').toLowerCase()) {
    res.status(400).json({ error: 'self_invite' }); return;
  }

  // Do not attach somebody else's existing account to this contractor (110).
  const { data: existing, error: lookupErr } = await admin
    .from('profiles').select('id').ilike('email', email).maybeSingle();
  if (lookupErr) {
    console.error('[invite-client] account lookup failed:', lookupErr.message);
    res.status(500).json({ error: 'create_failed' }); return;
  }
  if (existing?.id) { res.status(409).json({ error: 'client_exists' }); return; }

  const { data: made, error: createErr } = await admin.auth.admin.createUser({
    email,
    // No chosen or shared password; Supabase keeps any internal credential private.
    // Only following the invitation proves ownership of this address.
    email_confirm: false,
    user_metadata: {
      full_name: fullName,
      client_invited_by_contractor: true,
      // The project starts on Self Verify; its tier belongs to the project record.
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

  // These guarded columns (083) must be in place BEFORE the invitation is sent.
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
    // Without the link the wizard's insert is refused by RLS (109). No invitation has
    // been sent yet, so the incomplete account can be removed safely.
    console.error('[invite-client] could not record the client link:', linkErr.message);
    await admin.auth.admin.deleteUser(clientId);
    res.status(500).json({ error: 'link_failed' });
    return;
  }

  // Supabase sends the single-use link directly to the client. This accepts the reserved,
  // unconfirmed account; it does not replace a password or issue one to the contractor.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?flow=client-invite`,
  });
  if (inviteErr || invited?.user?.id !== clientId) {
    console.error('[invite-client] invitation failed:', inviteErr?.message ?? 'unexpected user');
    // There is no project yet. Removing the new account also removes its link, allowing
    // a fresh attempt instead of stranding an account whose owner received no email.
    await admin.auth.admin.deleteUser(clientId);
    res.status(500).json({ error: 'invite_failed' });
    return;
  }

  res.status(200).json({ clientId, email });
}
