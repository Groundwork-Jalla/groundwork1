import { randomInt } from 'node:crypto';
import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { generateTemporaryPassword } from '../../src/lib/auth/temp-password.js';

/**
 * Create a Jalla Management client's account on their behalf.
 *
 * ── The situation ────────────────────────────────────────────────────────────────────
 * Managed clients do not sign up. Their details are collected in person, an admin
 * creates the account here, then creates their project on /admin/projects/new, and hands
 * the client a username (their email) and a temporary password. The first sign-in then
 * asks for a code sent to that email, and refuses to go further until the temporary
 * password is replaced with one the admin has never seen.
 *
 * ── What the browser may and may not decide ──────────────────────────────────────────
 * The admin's browser sends the client's details. It does NOT send the password — that is
 * drawn here, returned exactly once in the response, and never stored or logged. It does
 * not choose the tier either: an account created this way is Jalla Management, which the
 * wizard then reads from user_metadata.
 *
 * ── Why email_confirm ────────────────────────────────────────────────────────────────
 * Supabase's own invite flow (findOrCreateUserByEmail in _lib/stripe.ts) proves the inbox
 * by making the invite link the only way in. Here the admin is the way in, and the inbox
 * is proven by the email second factor at first sign-in — `email_mfa_enabled` is set
 * before the client has ever touched the account. Marking the email confirmed is what
 * lets signInWithPassword succeed at all.
 *
 * ── must_change_password ─────────────────────────────────────────────────────────────
 * Set here under the service role, cleared by a database trigger when auth.users'
 * password hash actually changes (migration 083). The client never asserts "done".
 */

interface Body {
  email?: unknown;
  fullName?: unknown;
  phone?: unknown;
  country?: unknown;
  lang?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
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

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[provision] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  // The service role bypasses RLS, so the admin check is ours to make. Same answer as a
  // wrong path: a non-admin gets no confirmation this endpoint exists.
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

  const body = (req.body ?? {}) as Body;
  const email    = str(body.email, 254).toLowerCase();
  const fullName = str(body.fullName, 120);
  const phone    = str(body.phone, 40);
  const country  = str(body.country, 10).toUpperCase();   // validated below, never truncated into a different country
  const lang     = str(body.lang, 2) === 'fr' ? 'fr' : 'en';

  if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'invalid_email' }); return; }
  if (fullName.length < 2)   { res.status(400).json({ error: 'name_required' }); return; }
  // ISO-3166 alpha-2 shape only. The full list lives in src/lib/countries.ts, which
  // cannot be imported here (it carries an @/ alias — see api/README.md); the browser
  // offers only real codes and a wrong one costs a blank country, not an account.
  if (country && !/^[A-Z]{2}$/.test(country)) { res.status(400).json({ error: 'invalid_country' }); return; }

  // Refuse rather than "find or create": handing an admin a fresh password for an account
  // someone already owns would be an account takeover with a nice UI.
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', email)     // no wildcards in a validated address: exact, case-insensitive
    .maybeSingle();
  if (existing?.id) { res.status(409).json({ error: 'email_taken' }); return; }

  const password = generateTemporaryPassword(max => randomInt(0, max), { email, fullName });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone: phone || undefined,
      country: country || undefined,
      // No welcome/tier-choice screen for a managed client; the admin already chose.
      tier: 'jalla_management',
      onboarding_complete: true,
    },
  });
  if (createErr || !created.user) {
    // Supabase's own duplicate check catches a race with a concurrent self sign-up.
    const dup = /already|exists|registered/i.test(createErr?.message ?? '');
    console.error('[provision] createUser failed:', createErr?.message ?? 'no user returned');
    res.status(dup ? 409 : 500).json({ error: dup ? 'email_taken' : 'create_failed' });
    return;
  }
  const userId = created.user.id;

  // handle_new_user (047) has already inserted the profiles row with name and email.
  // The provisioning columns are guarded (083) and only land under the service role.
  const { error: profErr } = await admin
    .from('profiles')
    .update({
      country: country || null,
      phone: phone || null,
      preferred_lang: lang,
      email_mfa_enabled: true,
      must_change_password: true,
      provisioned_by: caller.id,
      provisioned_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (profErr) {
    // The account exists but is not marked as provisioned: it would let the temporary
    // password stand indefinitely. Remove it rather than hand out a half-made account.
    console.error('[provision] profile update failed, rolling back user:', profErr.message);
    await admin.auth.admin.deleteUser(userId);
    res.status(500).json({ error: 'create_failed' });
    return;
  }

  // The record (089): a person-level activity row — no project yet, so project_id is
  // NULL and the row is visible to admins only. The service role bypasses RLS; the actor
  // is the caller this handler verified above, not anything the request body said.
  // Fail-soft: the account is already made and marked, and an audit row that cannot be
  // written (the migration not yet pasted) must not fail the provisioning.
  const { error: auditErr } = await admin.from('project_audit_log').insert({
    project_id:  null,
    action:      'client.provisioned',
    actor_id:    caller.id,
    person_id:   userId,
    entity_type: 'profile',
    entity_id:   userId,
    details:     { email, tier: 'jalla_management', by: 'admin' },
  });
  if (auditErr) console.error('[provision] audit row not written:', auditErr.message);

  // The password appears in exactly one place: this response body.
  res.status(200).json({ userId, email, password });
}
