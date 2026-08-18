import { getSupabaseAdmin, requireUser } from './_lib/stripe.js';

/**
 * Record the country an account was created from, taken from the request IP.
 *
 * Signup asks for a name and a password and nothing else, so `profiles.country` is NULL
 * for everyone — which left the landing page's social-proof toast with names and no
 * locations. The request already carries the answer: Vercel resolves the client IP and
 * puts the ISO country on every request as `x-vercel-ip-country`.
 *
 * Server-side on purpose. A client-supplied country is a client-controlled string, and
 * this one is displayed publicly to strangers; the header cannot be set by the browser.
 *
 * Writes ONLY when the column is NULL, so it records where the account was created and
 * does not follow the user around as they travel or switch VPN. Never touches
 * `profiles.country` — that is the country the user states about themselves, and an IP
 * guess must not overwrite it.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const raw = req.headers['x-vercel-ip-country'];
  const country = (Array.isArray(raw) ? raw[0] : raw ?? '').toString().trim().toUpperCase();

  // Absent locally and on any non-Vercel host. Nothing to record, and not an error.
  if (!/^[A-Z]{2}$/.test(country)) {
    res.status(200).json({ recorded: false });
    return;
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('profiles')
      .update({ signup_country: country })
      .eq('id', user.id)
      .is('signup_country', null)     // first observation wins
      .select('id');

    if (error) throw error;
    res.status(200).json({ recorded: (data?.length ?? 0) > 0 });
  } catch (err) {
    // Cosmetic data for a marketing toast — never fail the caller over it.
    console.error('[geo] could not record signup country:', err);
    res.status(200).json({ recorded: false });
  }
}
