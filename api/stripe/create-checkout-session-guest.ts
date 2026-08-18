import { getStripe, jallaVerifyPriceId, siteUrl } from '../_lib/stripe.js';

/**
 * Start a Jalla Verify subscription WITHOUT an account.
 *
 * Deliberately unauthenticated. Requiring sign-up before payment put a form between
 * someone with their card out and the checkout; Stripe already collects an email, so
 * the account can be created from it afterwards — see findOrCreateUserByEmail, called
 * from the webhook once payment actually succeeds.
 *
 * No account is created here. A session that is started and abandoned should leave
 * nothing behind, which is also what stops this endpoint being a way to mint users.
 *
 * Signed-in callers use create-checkout-session instead: it reuses their existing
 * Stripe customer, so their billing history stays on one record.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = getStripe();
    const base = siteUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: jallaVerifyPriceId(), quantity: 1 }],
      // No `customer`: Stripe creates one and collects the email itself. That email is
      // the only identity the webhook will have, so it is the account it provisions.
      metadata: { source: 'guest_pricing' },
      // Mirrored onto the subscription because the lifecycle events reference that,
      // not the session.
      subscription_data: { metadata: { source: 'guest_pricing' } },
      success_url: `${base}/pricing?checkout=success`,
      cancel_url:  `${base}/pricing?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[stripe] guest checkout session failed:', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
}
