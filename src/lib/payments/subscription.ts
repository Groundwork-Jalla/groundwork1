import { supabase } from '@/lib/supabase/client';
import type { ProjectTier } from '@/types/project';

/**
 * Client-side subscription helpers.
 *
 * These only ever ask the server to do something — the browser cannot grant itself a
 * tier. Migration 021 installs a trigger that rejects any write to the subscription
 * columns that is not the Stripe webhook acting as service_role.
 *
 * SCOPE: this is the Jalla Verify plan the client pays Jalla. Contractor payouts run on
 * Switchr in XAF and have nothing to do with Stripe.
 */

export type SubscriptionStatus =
  | 'active' | 'trialing' | 'past_due' | 'canceled'
  | 'incomplete' | 'incomplete_expired' | 'unpaid';

export interface SubscriptionState {
  tier: ProjectTier;
  status: SubscriptionStatus | null;
  periodEnd: string | null;
  hasBillingAccount: boolean;
}

export async function getSubscription(userId: string): Promise<SubscriptionState> {
  const { data, error } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, subscription_period_end, stripe_customer_id')
    .eq('id', userId)
    .single();

  if (error || !data) {
    return { tier: 'self_verify', status: null, periodEnd: null, hasBillingAccount: false };
  }
  return {
    tier: (data.subscription_tier as ProjectTier) ?? 'self_verify',
    status: (data.subscription_status as SubscriptionStatus) ?? null,
    periodEnd: data.subscription_period_end ?? null,
    hasBillingAccount: Boolean(data.stripe_customer_id),
  };
}

/** True when the plan entitles the account, including the grace states. */
export function isSubscriptionActive(status: SubscriptionStatus | null): boolean {
  return status === 'active' || status === 'trialing'
      || status === 'past_due' || status === 'unpaid';
}

async function authedPost(path: string): Promise<{ url: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in first.');

  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The server verifies this token and derives the user from it, rather than
      // trusting any id we might send in a body.
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? 'Something went wrong. Please try again.');
  if (!body?.url) throw new Error('No checkout URL returned.');
  return body;
}

/** Redirects to hosted Stripe Checkout. No card data touches Groundwork. */
export async function startJallaVerifyCheckout(): Promise<void> {
  const { url } = await authedPost('/api/stripe/create-checkout-session');
  window.location.href = url;
}

/**
 * Checkout for a visitor with no account. Stripe collects the email and the webhook
 * provisions the account from it once payment succeeds — so nothing exists until money
 * has actually moved, and an abandoned checkout leaves no trace.
 *
 * Unauthenticated by design; there is no token to send. A signed-in user must go
 * through startJallaVerifyCheckout instead, or they would end up with a second Stripe
 * customer and a split billing history.
 */
export async function startGuestJallaVerifyCheckout(): Promise<void> {
  const res  = await fetch('/api/stripe/create-checkout-session-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)   throw new Error(body?.error ?? 'Something went wrong. Please try again.');
  if (!body?.url) throw new Error('No checkout URL returned.');
  window.location.href = body.url;
}

/** Opens Stripe's hosted portal to change card, see invoices, or cancel. */
export async function openBillingPortal(): Promise<void> {
  const { url } = await authedPost('/api/stripe/portal');
  window.location.href = url;
}
