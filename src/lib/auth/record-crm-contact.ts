import { supabase } from '@/lib/supabase/client';

// =========================================================
// Put this person in the CRM, once.
//
// Until now GoHighLevel only knew about contractors — every homeowner and client was
// invisible to whoever picks up the phone. This is the client half of api/ghl/user.ts.
//
// The browser sends nothing but its token. The name, address, country and language are
// read server-side from the profile, because a browser that could name its own CRM
// contact could inject anyone into the list the team trusts.
//
// Fired once per ACCOUNT per browser, and the endpoint is idempotent anyway — it checks
// the `synced_to_ghl` flag before forwarding, so a cleared localStorage costs one wasted
// request rather than a duplicate contact.
//
// ── Why the flag is keyed by user id ─────────────────────────────────────────────────
// It used to be one key for the whole browser, and signing out never cleared it. So the
// second account ever to sign in on a browser — a test client created on the same laptop
// as the admin who created it, which is exactly how the 16 November onboarding test was
// run — returned here before the request was made. The server then never heard
// `user_signup` for that account, so it was never enrolled in the welcome sequence, and
// no amount of enabling delivery would have produced the welcome email. The earlier
// account's flag was telling the truth about the earlier account, and nothing else.
//
// Modelled on record-signup-country.ts, which solves the same shape of problem: ask the
// server to look at something only the server can see, and never block on the answer.
// =========================================================

/** One flag per account. The bare legacy key (`gw:crmSynced`) is ignored, never read. */
export const crmSyncedKey = (userId: string) => `gw:crmSynced:${userId}`;

export async function recordCrmContact(): Promise<void> {
  let session: { access_token: string; user: { id: string } } | null = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch { return; /* no session, nothing to record */ }
  if (!session) return;

  const DONE_KEY = crmSyncedKey(session.user.id);
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
  } catch { /* private mode: fall through and just try */ }

  try {

    const r = await fetch('/api/events?action=crm-user', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    // Only remember success. A CRM outage or an unconfigured webhook leaves the flag
    // unset so the next session tries again — the row stays in the unsynced list either
    // way, but retrying costs nothing and closes most gaps without anyone noticing.
    const body = await r.json().catch(() => ({}));
    if (r.ok && body?.ok) {
      try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
    }
  } catch {
    /* A CRM mirror. Never surface, never block: the account is already real. */
  }
}
