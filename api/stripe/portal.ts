import { getStripe, getSupabaseAdmin, requireUser, siteUrl } from '../_lib/stripe.js';

/**
 * Stripe Billing Portal session — update card, view invoices, cancel.
 *
 * Cancellation, card changes and invoice history all live in Stripe's hosted portal
 * rather than being rebuilt here. That keeps us out of storing card details and means a
 * cancellation always arrives back as a webhook, so entitlement can never drift from
 * what Stripe believes.
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

  try {
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      res.status(404).json({ error: 'No billing account yet.' });
      return;
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl(req)}/profile`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[stripe] portal session failed:', err);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
}
