# Stripe setup

## Scope — read this first

Stripe handles **one** money flow in Groundwork:

| Rail | Direction | What moves | Status |
|---|---|---|---|
| **Stripe** | client → Jalla | Jalla Verify subscription, $199/mo | live |
| **Switchr** | client → contractor | project funds, milestone payouts in XAF | not wired |

**Contractors are never paid through Stripe.** Stripe Connect does not support payouts to
Cameroon, and no milestone money passes through a Stripe balance. If a future change puts
a construction stage on a PaymentIntent, that is a bug — stage money belongs on Switchr.

---

## 0. The functions must be able to load at all

`api/package.json` pins this directory to CommonJS. Without it every function carrying a
relative import — all three Stripe endpoints — dies at module load with Vercel's
`FUNCTION_INVOCATION_FAILED`, before reading a single environment variable. It looks
exactly like a Stripe misconfiguration and is not one. See `api/README.md`.

If Checkout fails with a 500 and the Vercel log shows no output from the handler, check
that file exists before touching any key below.

## 1. Environment variables

Server-side only. These live in **Vercel** project settings — Settings → Environment
Variables, applied to Production, Preview and Development — and in a local `.env` for
`stripe listen`. Never prefixed `VITE_`, because anything with that prefix is compiled
into the browser bundle and served to every visitor.

**None of these go in Supabase.** Supabase needs migration 021 applied (step 4); the keys
belong to the serverless functions, which run on Vercel.

| Variable | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → *Secret key* (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | created in step 3 (`whsec_…`) |
| `STRIPE_PRICE_JALLA_VERIFY` | created in step 2 (`price_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → *service_role* |
| `SUPABASE_URL` | same page (falls back to `VITE_SUPABASE_URL`) |
| `PUBLIC_SITE_URL` | set to `https://www.tryjalla.com`. Optional in principle — derived from the request when unset — but leaving it unset makes Checkout's success and cancel URLs depend on the host Stripe was reached on, which is one apex redirect away from being wrong |

> The service-role key bypasses RLS. It exists in `api/` only, because the webhook is the
> single identity allowed to move the subscription columns — see migration 021.

## 2. Create the product and price

Stripe Dashboard → **Products** → *Add product*:

- **Name**: `Jalla Verify`
- **Price**: `199.00 USD`, **Recurring**, **Monthly**
- Save, then copy the price ID (`price_…`) into `STRIPE_PRICE_JALLA_VERIFY`

Do not create products for Self Verify (free — nothing to charge) or Jalla Management
(negotiated contract — the CTA opens an email to sales, not Checkout).

## 3. Create the webhook

Stripe Dashboard → **Developers → Webhooks** → *Add endpoint*:

- **URL**: `https://www.tryjalla.com/api/stripe/webhook`

  Use the **`www.` host**. The apex `tryjalla.com` answers `308 Redirect` to `www`, and
  Stripe does not follow redirects when delivering a webhook — it records the 308 as the
  response and the event is never processed.
- **Events**:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

For local testing:

```bash
stripe listen --forward-to localhost:5174/api/stripe/webhook
# prints its own whsec_… — use that one locally
```

## 4. Apply the migration

```bash
supabase db push        # or run 021_stripe_subscriptions.sql in the SQL editor
```

## 5. Test the flow

```bash
stripe trigger checkout.session.completed
```

Or end-to-end with card `4242 4242 4242 4242`, any future expiry, any CVC.

Afterwards check:

```sql
select subscription_tier, subscription_status, stripe_customer_id
  from profiles where id = '<user-id>';
-- expect: jalla_verify | active | cus_…

select tier from projects where user_id = '<user-id>';
-- expect: every non-jalla_management row now jalla_verify
```

---

## How it fits together

```
UpgradeScreen
   └─ startJallaVerifyCheckout()          src/lib/payments/subscription.ts
        └─ POST /api/stripe/create-checkout-session   (bearer token → user)
             └─ Stripe Checkout (hosted)  ← card details never touch Groundwork
                  └─ webhook  /api/stripe/webhook
                       ├─ verify signature (raw body)
                       ├─ insert billing_events   ← unique event id = idempotency
                       ├─ update profiles.subscription_*   ← service role only
                       └─ trigger fans tier out to projects
```

### Why the client cannot grant itself a tier

`001_profiles.sql` grants `Users can update their own profile` as
`FOR UPDATE USING (auth.uid() = id)` — no `WITH CHECK`, no column list. Without a guard,
any signed-in user could `PATCH subscription_tier = 'jalla_verify'` from the browser.

Postgres has no column-level RLS, so migration 021 adds the
`profiles_guard_subscription_columns` trigger: any change to a subscription column from a
role other than `service_role` raises. The webhook holds the service-role key; the browser
never does.

### Replaying a webhook

`billing_events.stripe_event_id` is unique, so a redelivery is a no-op and returns
`{ duplicate: true }`. To genuinely reprocess an event, delete its row first:

```sql
delete from billing_events where stripe_event_id = 'evt_…';
```

### Entitlement mapping

| Stripe status | Tier | Why |
|---|---|---|
| `active`, `trialing` | `jalla_verify` | paid |
| `past_due`, `unpaid` | `jalla_verify` | card failed, Stripe still retrying — cutting access mid-build is the wrong call |
| `canceled`, `incomplete`, `incomplete_expired` | `self_verify` | no longer entitled |

`jalla_management` is never set or cleared by Stripe — it is a negotiated contract, and
the tier-sync trigger deliberately skips those rows.

---

## Still open

- **Switchr is not wired.** `MILESTONE_PAYMENTS_ARE_PREVIEW` is still `true`.
- **`project_stages.payment_status` is client-writable.** `owner_all_stages` is `FOR ALL`,
  so the browser can currently mark a stage paid. Harmless while no money moves, but it
  must become server-authoritative — settable only by the Switchr webhook — before
  milestone payments go live. This is the same class of hole that migration 021 closes for
  subscriptions, and it is the first thing to fix when Switchr lands.
