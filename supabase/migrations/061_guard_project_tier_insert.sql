-- =========================================================
-- 061  A paid tier is granted by payment, never by picking it
--
-- 060 stopped an owner UPDATING their own tier. This closes the wider door: INSERT.
--
-- The wizard offers all three plans and features Jalla Verify, then creates the project
-- with whatever was chosen. Checkout lives only at /upgrade and nothing in the wizard
-- charges anybody — so picking the paid plan granted the paid plan, through ordinary UI,
-- no API call required. That is unlimited projects and unlimited contractor invites for
-- free.
--
-- CLAMPED, NOT REJECTED. Refusing the insert would lose the client their whole wizard
-- run at the last step, over a plan they can still buy thirty seconds later. Instead the
-- project is created on self_verify and the client is sent to Stripe; when payment lands,
-- sync_projects_to_subscription() (021) upgrades it through the path that already
-- exists. Abandon checkout and you keep the project on the free plan, which is the
-- honest outcome.
--
-- The entitlement is read from profiles.subscription_tier — written only by the Stripe
-- webhook — so this cannot be talked into granting anything the client merely asked for.
--
-- jalla_management is never self-granted under any circumstance: 021 calls it a
-- negotiated contract and refuses to sync it, so it can only arrive from an admin.
-- =========================================================

CREATE OR REPLACE FUNCTION public.clamp_project_tier_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entitled TEXT;
BEGIN
  -- Server-side callers and admins are trusted: the Stripe webhook, the service key,
  -- and an administrator setting up a negotiated contract.
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.tier = 'self_verify' THEN
    RETURN NEW;                       -- the free plan needs no entitlement
  END IF;

  SELECT subscription_tier INTO entitled FROM public.profiles WHERE id = NEW.user_id;

  -- Only a tier the subscription actually grants survives. Everything else — including
  -- jalla_management, which no subscription grants — falls back to the free plan.
  IF COALESCE(entitled, 'self_verify') IS DISTINCT FROM NEW.tier THEN
    NEW.tier := 'self_verify';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_clamp_tier ON public.projects;
CREATE TRIGGER projects_clamp_tier
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.clamp_project_tier_on_insert();

REVOKE ALL ON FUNCTION public.clamp_project_tier_on_insert() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.clamp_project_tier_on_insert() IS
  'A new project gets the tier the owner is entitled to, not the one they selected. '
  'Paid plans arrive via Stripe -> profiles.subscription_tier -> sync (021). Clamps '
  'rather than rejects so a client never loses a wizard run at the final step.';
