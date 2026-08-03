-- 021_stripe_subscriptions.sql
--
-- Account-level Jalla Verify subscription, billed through Stripe.
--
-- SCOPE — read this before extending anything here.
-- Stripe handles ONE money flow in this product: the $199/mo Jalla Verify subscription,
-- paid by the diaspora client to Jalla. That is all.
--
--   Stripe   client → Jalla, subscription only
--   Switchr  holds project funds and disburses to contractors
--
-- Contractors are NEVER paid through Stripe. Stripe Connect does not support payouts to
-- Cameroon, and milestone money does not pass through a Stripe balance. Do not add
-- PaymentIntents for stages, and do not let subscription state gate a payout.


-- ── 1. Subscription state on profiles ──────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status    TEXT
    CHECK (subscription_status IN (
      'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid'
    )),
  ADD COLUMN IF NOT EXISTS subscription_tier      TEXT NOT NULL DEFAULT 'self_verify'
    CHECK (subscription_tier IN ('self_verify', 'jalla_verify', 'jalla_management')),
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_idx
  ON public.profiles (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.subscription_tier IS
  'Entitlement granted by the Stripe subscription. Server-authoritative — see the '
  'profiles_guard_subscription_columns trigger. Never trust a client write here.';


-- ── 2. Stop the client writing its own entitlement ─────────
--
-- 001_profiles.sql grants "Users can update their own profile" as
--   FOR UPDATE USING (auth.uid() = id)
-- with no WITH CHECK and no column list, so without this guard any signed-in user could
-- PATCH subscription_tier = 'jalla_verify' straight from the browser and take the paid
-- tier for free. Postgres has no column-level RLS, so the guard is a trigger.
--
-- The service role bypasses RLS but still fires triggers, so the check is on the role:
-- only service_role (the Stripe webhook) may move these columns.

CREATE OR REPLACE FUNCTION public.guard_subscription_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL
     AND coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  THEN
    RETURN NEW;  -- the webhook, acting as service_role
  END IF;

  IF NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_tier      IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_period_end IS DISTINCT FROM OLD.subscription_period_end
  THEN
    RAISE EXCEPTION 'subscription columns are set by the billing webhook, not by the client';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_subscription_columns ON public.profiles;
CREATE TRIGGER profiles_guard_subscription_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_columns();


-- ── 3. Billing events, for idempotency and audit ───────────
--
-- Stripe retries webhooks and can deliver the same event more than once. The unique
-- constraint on stripe_event_id is what makes replay harmless: a repeat insert conflicts
-- and the handler exits without reapplying anything.

CREATE TABLE IF NOT EXISTS public.billing_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id  TEXT        NOT NULL UNIQUE,
  event_type       TEXT        NOT NULL,
  user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_customer_id TEXT,
  payload          JSONB,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_events_user_idx ON public.billing_events (user_id);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- No client policies at all: this table is written by the webhook and read by admins.
DROP POLICY IF EXISTS "admin_read_billing_events" ON public.billing_events;
CREATE POLICY "admin_read_billing_events" ON public.billing_events
  FOR SELECT USING (public.is_admin());


-- ── 4. Keep projects.tier in step with the subscription ────
--
-- The subscription is account-level, but projects.tier already exists per row and other
-- logic (project caps, stage approval routing) reads it. Rather than refactor every
-- reader, the entitlement fans out to the owner's projects.
--
-- jalla_management is deliberately excluded: it is a negotiated contract, not something
-- a Stripe subscription grants or removes.

CREATE OR REPLACE FUNCTION public.sync_projects_to_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    UPDATE public.projects
       SET tier = NEW.subscription_tier
     WHERE user_id = NEW.id
       AND tier <> 'jalla_management';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_projects_tier ON public.profiles;
CREATE TRIGGER profiles_sync_projects_tier
  AFTER UPDATE OF subscription_tier ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_projects_to_subscription();
