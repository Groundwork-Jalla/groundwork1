-- The funnel's "pre-qualified" count has been zero since 153, and nobody noticed.
--
-- WHAT WAS WRONG
--
-- 136 counted a pre-qualified applicant as:
--
--     has_current_project IS TRUE AND will_introduce IS TRUE
--
-- which was the rule at the time. 153 then rewrote the application form, and the
-- question "will you introduce this project?" stopped being asked. `will_introduce`
-- has been NULL on every application filed since, so `IS TRUE` has never matched and
-- the count has reported **0** on every refresh of the admin funnel — a number Philip
-- has been reviewing in meetings.
--
-- The app had the same fault in two readers and they were corrected on 31 Oct 2026 to
-- call `qualifiesForCall`, the rule the form itself runs when it decides whether to
-- offer somebody a calendar. This brings the SQL onto that same rule, so the applicant,
-- the contractor's own track and the staff funnel finally answer one question the same
-- way.
--
-- THE RULE, AS THE FORM RUNS IT
--
-- Everything asked, and nothing disqualifying. Three disqualifiers, and only three
-- (src/lib/contractor/partner-qualification.ts):
--
--   project_status = 'none'       no build to manage, so no partnership to discuss
--   client_on_site_daily = true   a client who CAN stand on the slab does not need us
--   will_use_groundwork = 'no'    a partner who will not run the job here is not one
--
-- Years of experience is deliberately NOT a gate. The form document is explicit that it
-- "simply establishes who we give preference to when ranking them" — it sorts the
-- directory, it does not remove anybody. The 22 October decision that under five years
-- could not book a call was reversed, and counting it here would reintroduce it through
-- the back door.
--
-- An unanswered question never disqualifies: that is the difference between "they said
-- no" and "they have not reached that question yet". Hence the NOT NULL tests, which
-- are what make this "finished the form and is still in it" rather than "has not failed
-- yet".
--
-- NOTHING ELSE IN 136 CHANGES. `accounts`, `onboarded`, `partner_interested`,
-- `applications` and `sent_to_booking` are re-declared only because Postgres replaces a
-- function whole.
--
-- Run in: Supabase Dashboard > SQL Editor (after 136)

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_partner_funnel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_accounts      integer;
  v_onboarded     integer;
  v_interested    integer;
  v_applications  integer;
  v_prequalified  integer;
  v_booking       integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;

  -- The role, not `holds_contractor_access`: somebody invited onto a single project
  -- arrived through a client, not through outreach, and counting them here would credit
  -- the funnel with accounts it did not create.
  SELECT count(*) INTO v_accounts
    FROM public.user_roles WHERE role = 'contractor';

  -- 116 owns the definition; this only counts what it returns.
  SELECT count(*) INTO v_onboarded
    FROM public.user_roles r
   WHERE r.role = 'contractor'
     AND coalesce(
           (public.contractor_onboarding_status(r.user_id) ->> 'complete')::boolean,
           false);

  -- The gap between finishing onboarding and filing the application — the follow-up
  -- list. Somebody who said yes and then stopped is the cheapest person to recover.
  SELECT count(*) INTO v_interested
    FROM public.contractor_onboarding WHERE partner_interest IS TRUE;

  -- In-app only: the public form (pre-133) was a different funnel, filled in by
  -- strangers before they had an account, and mixing the two makes both unreadable.
  SELECT count(*) INTO v_applications
    FROM public.contractor_applications WHERE source = 'in_app';

  -- ── The fix ───────────────────────────────────────────────────────────────────────
  -- `qualifiesForCall`, in SQL. See the header for why experience is not a condition
  -- and why each column must be NOT NULL.
  SELECT count(*) INTO v_prequalified
    FROM public.contractor_applications
   WHERE source = 'in_app'
     AND project_status       IS NOT NULL
     AND client_on_site_daily IS NOT NULL
     AND will_use_groundwork  IS NOT NULL
     AND project_status       <> 'none'
     AND client_on_site_daily IS NOT TRUE
     AND will_use_groundwork  <> 'no';

  SELECT count(*) INTO v_booking
    FROM public.contractor_applications
   WHERE source = 'in_app' AND booking_shown_at IS NOT NULL;

  RETURN jsonb_build_object(
    'accounts',            v_accounts,
    'onboarded',           v_onboarded,
    'partner_interested',  v_interested,
    'applications',        v_applications,
    'prequalified',        v_prequalified,
    'sent_to_booking',     v_booking
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_partner_funnel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_funnel() TO authenticated;

COMMENT ON FUNCTION public.admin_partner_funnel() IS
  'The partner funnel counts (136, pre-qualified rule corrected in 171). Pre-qualified '
  'is qualifiesForCall: every question answered and none of the three disqualifiers. '
  'Experience ranks an applicant, it does not gate them.';

COMMIT;
