-- =========================================================
-- 136 — The five numbers Philip's funnel is measured by
--
-- Outreach → contractor signup → contractor onboarding → partner application →
-- pre-qualification → the call with Philip → client introduction → activation.
--
-- The outcome measures named for that flow are: contractor accounts created,
-- contractor onboarding completed, partner applications completed, applicants
-- pre-qualified, calls booked. Until now every one of them was a question somebody
-- answered by hand, which is why nobody could say where the drop-off was.
--
-- Two decisions worth naming:
--
-- 1. "Onboarding completed" is NOT re-defined here. It calls
--    `contractor_onboarding_status()` (116), which is the single place that decides
--    whether somebody is finished. 116's own comment says what happens when two places
--    each decide what "a contractor" means: one of them is wrong and the person is
--    stuck. A COUNT with its own six conditions would have been that second place.
--
-- 2. "Calls booked" cannot be read from Groundwork at all. Philip's schedule is not
--    ours to query, and the booking widget is a cross-origin Google iframe, so a click
--    inside it is invisible to us. What we CAN observe is that the applicant reached the
--    booking step and was shown a slot. That is what this records, and it is reported
--    under that name — `sent_to_booking` — never as a booking we have confirmed. The
--    true figure lives in Philip's calendar; this is the denominator next to it, so a
--    gap between the two is itself the finding. A number that quietly overstated itself
--    would be worse than no number.
--
-- Run in: Supabase Dashboard > SQL Editor (after 135)
-- =========================================================

BEGIN;

-- ── The one fact we own about the call ────────────────────
ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS booking_shown_at TIMESTAMPTZ;

COMMENT ON COLUMN public.contractor_applications.booking_shown_at IS
  'When this applicant reached the booking step and was shown a slot (136). The nearest '
  'fact Groundwork owns to "a call was booked", which lives in Philip''s calendar and '
  'not here, behind a cross-origin iframe. Never report it as a confirmed booking.';


-- ── The applicant marking their own row ──────────────────
--
-- Theirs only, and idempotent: the FIRST time they reached the step is the interesting
-- one, so a revisit must not move the timestamp and make the follow-up list look
-- fresher than it is.
CREATE OR REPLACE FUNCTION public.mark_booking_shown()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: no application to mark';
  END IF;

  UPDATE public.contractor_applications
     SET booking_shown_at = now()
   WHERE user_id = v_actor
     AND booking_shown_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.mark_booking_shown() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_booking_shown() TO authenticated;

COMMENT ON FUNCTION public.mark_booking_shown() IS
  'Records that the caller reached the booking step (136). Own row only, and only the '
  'first time — a revisit must not refresh the timestamp.';


-- ── The five numbers ─────────────────────────────────────
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

  -- Step 2. The role, not `holds_contractor_access`: somebody invited onto a single
  -- project arrived through a client, not through outreach, and counting them here would
  -- credit the funnel with accounts it did not create.
  SELECT count(*) INTO v_accounts
    FROM public.user_roles WHERE role = 'contractor';

  -- Step 3. 116 owns the definition; this only counts what it returns.
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

  -- Step 4. In-app only: the public form (pre-133) was a different funnel, filled in by
  -- strangers before they had an account, and mixing the two makes both unreadable.
  SELECT count(*) INTO v_applications
    FROM public.contractor_applications WHERE source = 'in_app';

  -- Step 5. The same two answers the applicant's own screen turns on, so staff and
  -- applicant never see different verdicts.
  SELECT count(*) INTO v_prequalified
    FROM public.contractor_applications
   WHERE source = 'in_app'
     AND has_current_project IS TRUE
     AND will_introduce IS TRUE;

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
  'The five funnel numbers for the partner flow (136), plus the interested-but-did-not-'
  'apply gap. Staff only. `sent_to_booking` means they reached the booking step, not '
  'that a call was confirmed — that lives in Philip''s calendar.';

COMMIT;
