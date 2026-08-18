import { supabase } from '@/lib/supabase/client';

// =========================================================
// Stamp the country an account was created from, once.
//
// Signup collects a name and a password, so `profiles.country` is NULL for everyone and
// the landing page's social-proof toast had names with no location. Rather than add a
// field to the form, the server reads the country Vercel already resolved from the
// request IP — see api/profile-geo.ts.
//
// The browser cannot send the country itself: it is displayed publicly to strangers, so
// a client-supplied value would be a client-controlled string on a public page. All the
// client does is ask the server to look at its own request.
//
// Fired once per browser. The endpoint is idempotent anyway (it writes only when the
// column is NULL), but a flag keeps this off the critical path of every page load.
// =========================================================

const DONE_KEY = 'gw:geoStamped';

export async function recordSignupCountry(): Promise<void> {
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
  } catch { /* private mode: fall through and just try */ }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch('/api/profile-geo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    // Marked regardless of the answer: a miss means no header (local dev, non-Vercel
    // host) or a value already recorded, and neither is worth retrying every load.
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
  } catch {
    /* Cosmetic data for a marketing toast. Never surface, never block. */
  }
}
