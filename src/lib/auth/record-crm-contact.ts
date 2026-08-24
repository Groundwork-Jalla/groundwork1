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
// Fired once per browser, and the endpoint is idempotent anyway — it checks the
// `synced_to_ghl` flag before forwarding, so a cleared localStorage costs one wasted
// request rather than a duplicate contact.
//
// Modelled on record-signup-country.ts, which solves the same shape of problem: ask the
// server to look at something only the server can see, and never block on the answer.
// =========================================================

const DONE_KEY = 'gw:crmSynced';

export async function recordCrmContact(): Promise<void> {
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
  } catch { /* private mode: fall through and just try */ }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

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
