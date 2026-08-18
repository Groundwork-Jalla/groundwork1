import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Stripe and Supabase clients.
 *
 * SCOPE: Stripe handles the Jalla Verify subscription and nothing else. Contractors are
 * paid by Switchr in XAF — Stripe Connect does not support payouts to Cameroon, and no
 * milestone money passes through a Stripe balance. If you find yourself adding a
 * PaymentIntent for a construction stage here, stop: that belongs on the Switchr rail.
 *
 * Nothing in this directory may be imported from src/ — these read process.env secrets
 * that must never reach the client bundle.
 */

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  // No explicit apiVersion: the SDK defaults to the version its own types were generated
  // against, so the two can never disagree. Pinning a literal here means every `pnpm up
  // stripe` becomes a type error until someone edits this line.
  return new Stripe(key);
}

/**
 * Supabase with the service role. Bypasses RLS, which is exactly why it lives only in
 * api/ — it is the only identity permitted to move the subscription columns guarded by
 * profiles_guard_subscription_columns.
 */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolve the caller from their Supabase access token.
 *
 * The browser sends its bearer token; we verify it server-side rather than trusting any
 * user id in the request body. A client that could name its own user id could buy a
 * subscription for someone else, or worse, attach someone else's customer to its own.
 */
export async function requireUser(req: { headers: Record<string, unknown> }) {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : typeof raw === 'string' ? raw : '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** The one Price this product sells. Created in the Stripe dashboard — see docs/STRIPE.md. */
export function jallaVerifyPriceId(): string {
  const id = process.env.STRIPE_PRICE_JALLA_VERIFY;
  if (!id) throw new Error('STRIPE_PRICE_JALLA_VERIFY is not set');
  return id;
}

export function siteUrl(req: { headers: Record<string, unknown> }): string {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL;
  const host = req.headers['x-forwarded-host'] ?? req.headers['host'];
  const h = Array.isArray(host) ? host[0] : String(host ?? 'localhost:5174');
  const proto = h.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${h}`;
}

/**
 * The Supabase user that owns an email address, creating one if there is none.
 *
 * Used by the guest checkout path: someone can pay from the pricing page without an
 * account, and the only identity Stripe gives us afterwards is the email they typed
 * into Checkout. Rather than parking the subscription in a pending state and handing
 * it out to whoever later claims that address, the account is created here and
 * Supabase emails an invite. Control of the inbox is then proven by Supabase before
 * anyone can sign in — which is the property a claim-by-email flow would not have if
 * email confirmation were ever switched off.
 *
 * `profiles.email` is a trigger-maintained mirror of `auth.users.email` (migration
 * 025), so it can be queried under the service role without touching the auth schema.
 * Matching is case-insensitive: Stripe returns the address exactly as typed.
 */
export async function findOrCreateUserByEmail(
  admin: ReturnType<typeof getSupabaseAdmin>,
  email: string,
  opts: { fullName?: string | null; redirectTo?: string } = {},
): Promise<{ userId: string; created: boolean }> {
  const normalized = email.trim();

  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', normalized)      // no wildcards: exact match, case-insensitive
    .maybeSingle();
  if (existing?.id) return { userId: existing.id, created: false };

  // inviteUserByEmail both creates the row in auth.users and sends the invite, so
  // there is no window in which an account exists that nobody can get into. The
  // handle_new_user trigger (025) creates the matching profiles row.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
    data: opts.fullName ? { full_name: opts.fullName } : undefined,
    redirectTo: opts.redirectTo,
  });
  if (error) {
    // A racing webhook retry may have created it a moment ago. Re-read before failing.
    const { data: retry } = await admin
      .from('profiles').select('id').ilike('email', normalized).maybeSingle();
    if (retry?.id) return { userId: retry.id, created: false };
    throw error;
  }
  if (!data.user) throw new Error(`invite returned no user for ${normalized}`);
  return { userId: data.user.id, created: true };
}
