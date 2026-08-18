import {
  getStripe, getSupabaseAdmin, jallaVerifyPriceId, requireUser, siteUrl,
} from '../_lib/stripe.js';

/**
 * Start a Jalla Verify subscription.
 *
 * Hosted Stripe Checkout, so no card data touches Groundwork and no publishable key or
 * Stripe.js is needed on the client — we create the session here and hand back a URL to
 * redirect to.
 *
 * This charges the CLIENT for their Jalla Verify plan. It has nothing to do with paying
 * contractors; that money moves on the Switchr rail in XAF.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Identity comes from the verified bearer token, never from the request body.
  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  try {
    const stripe = getStripe();
    const admin  = getSupabaseAdmin();

    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id, subscription_status, full_name')
      .eq('id', user.id)
      .single();

    if (profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing') {
      res.status(409).json({ error: 'You already have an active subscription.' });
      return;
    }

    // Reuse the customer if we have one, so a returning subscriber keeps one billing
    // history rather than accumulating duplicate customers on every attempt.
    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile?.full_name ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const base = siteUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: jallaVerifyPriceId(), quantity: 1 }],
      // Both the session and the subscription carry the user id. The webhook reads it
      // from the subscription, which is what later lifecycle events reference.
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      subscription_data: { metadata: { supabase_user_id: user.id } },
      success_url: `${base}/profile?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}/profile?billing=cancelled`,
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[stripe] checkout session failed:', err);
    const message = process.env.NODE_ENV === 'production'
      ? 'Could not start checkout.'
      : (err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: message });
  }
}
