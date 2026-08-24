import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { forwardToGhl } from '../ghl/_forward.js';

/**
 * Homeowner / client → GoHighLevel.
 *
 * GHL has only ever heard about contractors. Every homeowner who has signed up — the
 * people who actually pay for a build — is invisible in the CRM, which is the gap Philip
 * described in the 20 August meeting. This closes it.
 *
 * Nothing about the contact comes from the request. The browser sends a bearer token and
 * nothing else; the name, address, country and language are read from the profile row
 * with the service role. A browser that could name its own contact could inject anyone
 * into the CRM, and the CRM is what the team trusts when they pick up the phone.
 *
 * Idempotent by the `synced_to_ghl` flag, so the client can call it on every session
 * without duplicating contacts. The flag is only set once GHL has accepted the contact,
 * so a failed push leaves the row findable rather than silently marked done.
 */
export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[ghl] SUPABASE_SERVICE_ROLE_KEY is not set — user not forwarded');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { data: profile, error } = await admin
    .from('profiles')
    .select('full_name, email, country, preferred_lang, synced_to_ghl, ghl_contact_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile) {
    // The row is created by a trigger on signup, so its absence is a real fault worth
    // seeing in the logs rather than a quiet 200.
    console.error('[ghl] no profile for', user.id, error);
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  if (profile.synced_to_ghl) {
    res.status(200).json({ ok: true, alreadySynced: true });
    return;
  }

  // profiles.email is the mirror of auth.users.email restored by migration 047. Falling
  // back to the token's own address covers any row written before that landed.
  const email = (profile.email as string | null) ?? user.email ?? '';

  const result = await forwardToGhl('user_signup', {
    email,
    fullName: profile.full_name as string | null,
    country:  profile.country as string | null,
    lang:     profile.preferred_lang as string | null,
  }, {
    user_id: user.id,
  }, {
    // One row per person: signing in on a new browser should not re-announce them.
    dedupeKey: `user_signup:${user.id}`,
    contactId: profile.ghl_contact_id as string | null,
  });

  if (!result.ok) {
    // 200 with ok:false, not an error status: the caller is fire-and-forget and the
    // account exists regardless. The unset flag is what records the miss.
    res.status(200).json({ ok: false, reason: result.reason });
    return;
  }

  const { error: stampErr } = await admin
    .from('profiles')
    .update({
      synced_to_ghl: true,
      synced_to_ghl_at: new Date().toISOString(),
      // Only present on the API path. This is the id every later event needs to address
      // the same contact instead of hoping GHL dedupes — the point of Phase 2.
      ...(result.contactId ? { ghl_contact_id: result.contactId } : {}),
    })
    .eq('id', user.id);

  if (stampErr) {
    // Contact is in GHL; only the bookkeeping failed. Reported so a duplicate on the
    // next session is explainable rather than mysterious.
    console.warn('[ghl] user forwarded but could not be marked synced:', stampErr);
  }

  res.status(200).json({ ok: true, stamped: !stampErr });
}
