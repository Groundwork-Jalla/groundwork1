import type Stripe from 'stripe';
import { findOrCreateUserByEmail, getStripe, getSupabaseAdmin, siteUrl } from '../_lib/stripe.js';
import { forwardToGhl } from '../ghl/_forward.js';

/**
 * Stripe webhook — the only writer of subscription state.
 *
 * profiles_guard_subscription_columns (migration 021) rejects any write to the
 * subscription columns that does not come from the service role, so this handler is the
 * sole path by which a user becomes Jalla Verify. A browser cannot grant itself the tier.
 *
 * Again: subscriptions only. No contractor is paid from here.
 */

// Signature verification needs the byte-exact body, so Vercel's parser must stay off.
// Reading req.body here would produce a re-serialised object and every signature check
// would fail.
export const config = { api: { bodyParser: false } };

async function rawBody(readable: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Which entitlement a Stripe status grants. */
function tierFor(status: Stripe.Subscription.Status): 'self_verify' | 'jalla_verify' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'jalla_verify';
    // past_due and unpaid keep access: the card failed but the customer has not left,
    // and Stripe is still retrying. Cutting them off mid-build would be the wrong call.
    case 'past_due':
    case 'unpaid':
      return 'jalla_verify';
    default:
      return 'self_verify';
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET is not set');
    res.status(500).json({ error: 'Webhook not configured' });
    return;
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    const body = await rawBody(req);
    const sig  = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    // An unverified payload is an unauthenticated caller claiming to be Stripe.
    console.error('[stripe] signature verification failed:', err);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  const admin = getSupabaseAdmin();

  // Idempotency. Stripe retries on any non-2xx and can deliver the same event twice even
  // on success; the unique constraint on stripe_event_id makes a replay a no-op.
  const { error: insertError } = await admin.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event.data.object as unknown as Record<string, unknown>,
  });
  if (insertError) {
    if (insertError.code === '23505') {          // unique_violation — already handled
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    console.error('[stripe] could not record billing event:', insertError);
    res.status(500).json({ error: 'Could not record event' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;
        if (!session.subscription) break;

        // Signed-in checkout puts the user id on the session. Guest checkout cannot —
        // there was no session to derive one from — so the email Stripe collected is
        // the identity, and the account is created from it now that money has actually
        // moved. Nothing is provisioned when a guest session is merely started.
        let userId = session.metadata?.supabase_user_id ?? session.client_reference_id;
        if (!userId) {
          const email = session.customer_details?.email ?? session.customer_email;
          if (!email) {
            console.error('[stripe] guest checkout with no email:', session.id);
            break;
          }
          const { userId: resolved, created } = await findOrCreateUserByEmail(admin, email, {
            fullName: session.customer_details?.name ?? null,
            redirectTo: `${siteUrl(req)}/auth/callback`,
          });
          userId = resolved;
          console.info('[stripe] guest checkout', created ? 'provisioned' : 'matched', email);

          // Stamp the id onto the customer and subscription. Later lifecycle events
          // reference those, and resolving them by metadata is cheaper and less
          // ambiguous than looking the customer up every time.
          await Promise.all([
            stripe.customers.update(String(session.customer), {
              metadata: { supabase_user_id: userId },
            }),
            stripe.subscriptions.update(String(session.subscription), {
              metadata: { supabase_user_id: userId, source: 'guest_pricing' },
            }),
          ]).catch(err => console.warn('[stripe] could not backfill metadata:', err));
        }

        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        await applySubscription(admin, userId, sub, event.id);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id
          ?? (await userIdForCustomer(admin, String(sub.customer)));
        if (!userId) {
          // Expected for guest checkout: Stripe can deliver subscription.created before
          // checkout.session.completed, and until the latter runs there is no email on
          // the subscription and no profile carrying the customer id. That handler
          // applies the same state, so dropping this one loses nothing.
          console.info('[stripe] no user yet for subscription', sub.id, '- awaiting checkout.session.completed');
          break;
        }
        await applySubscription(
          admin,
          userId,
          event.type === 'customer.subscription.deleted'
            ? { ...sub, status: 'canceled' as Stripe.Subscription.Status }
            : sub,
          event.id,
        );
        break;
      }

      case 'invoice.payment_failed': {
        // Stripe will also send customer.subscription.updated with status past_due, which
        // is what actually moves the entitlement. Recorded here for the audit trail only.
        console.warn('[stripe] invoice payment failed:', (event.data.object as Stripe.Invoice).id);
        break;
      }

      default:
        break;   // recorded in billing_events, no state change
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe] handler failed for', event.type, err);
    // 500 asks Stripe to retry. The billing_events row already exists, so the retry will
    // short-circuit as a duplicate — clear that row if a genuine reprocess is needed.
    res.status(500).json({ error: 'Handler failed' });
  }
}

async function applySubscription(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  sub: Stripe.Subscription,
  eventId: string,
) {
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const { error } = await admin
    .from('profiles')
    .update({
      stripe_customer_id: String(sub.customer),
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      subscription_tier: tierFor(sub.status),
      subscription_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    })
    .eq('id', userId);

  if (error) throw error;
  // profiles_sync_projects_tier then fans the entitlement out to the owner's projects,
  // leaving jalla_management rows alone.

  // Backfill the audit row now that we know who the event belonged to.
  await admin
    .from('billing_events')
    .update({ user_id: userId, stripe_customer_id: String(sub.customer) })
    .eq('stripe_event_id', eventId);

  // Mirror the change into the CRM. This is the single funnel every subscription state
  // passes through — new, upgraded, cancelled, past_due — so one hook here covers all of
  // them, and the team can see who is paying without opening Stripe.
  //
  // Read after the write so the tier reflects what was just applied rather than what the
  // row held a moment ago. Never allowed to fail the webhook: Stripe retries on a
  // non-2xx, and retrying a payment event because a CRM was down would replay the
  // billing side too.
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, country, preferred_lang, subscription_tier')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.email) {
    await forwardToGhl('subscription_changed', {
      email: profile.email as string,
      fullName: profile.full_name as string | null,
      country: profile.country as string | null,
      lang: profile.preferred_lang as string | null,
    }, {
      user_id: userId,
      subscription_status: sub.status,
      subscription_tier: (profile.subscription_tier as string | null) ?? '',
      period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : '',
    });
  }
}

async function userIdForCustomer(
  admin: ReturnType<typeof getSupabaseAdmin>,
  customerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();
  return data?.id ?? null;
}
