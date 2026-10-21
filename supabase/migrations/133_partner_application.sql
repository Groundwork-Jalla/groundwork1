-- =========================================================
-- 133  The partner application, from inside Groundwork
--
-- WHY
--
-- The new funnel is: outreach → contractor signup → onboarding → PARTNER APPLICATION →
-- pre-qualification → one call with Philip → client introduction → activation. Step four
-- had no door. `contractor_applications` (026) exists, but the only way to reach it is
-- `/contractor-apply`, the public marketing page — so a professional who has signed up
-- and finished onboarding cannot apply at all.
--
-- ── One pipeline, not two ───────────────────────────────────────────────────────────
-- Extending 026 rather than adding a `partner_applications` table beside it. Ruth runs
-- one command centre and reviews one queue; two tables would mean two admin views and a
-- candidate who exists in whichever one nobody opened. `source` says where an
-- application came from, which is the only thing that actually differs.
--
-- ── Why these four columns and no others ────────────────────────────────────────────
-- 026 already carries the specialty, the experience, the registration, the regions, the
-- capacity and why they want to join. What the new funnel asks that 026 cannot answer:
--
--   diaspora_history     have they worked with diaspora clients before
--   languages            which languages they WORK IN — distinct from 026's `lang`,
--                        which records the language the form was filled in. This one
--                        ROUTES THE BOOKING, so a French-speaking professional reaches
--                        Vanessa and not a call nobody in it can hold
--   has_current_project  do they have a live diaspora project right now
--   will_introduce       are they prepared to bring it to Groundwork
--
-- The last two are the whole qualification. Philip's calendar is the constraint — 18
-- calls produced 4 qualified professionals — and these are the two answers that decide
-- whether a call is worth booking.
--
-- ── Nothing here may break the public form ──────────────────────────────────────────
-- Every column is NULLABLE with no default behaviour change. 026's form does not send
-- them and must keep working untouched; an application from the public page simply has
-- them empty, and reads as `source = 'public'`.
--
-- Run in: Supabase Dashboard > SQL Editor (after 132)
-- =========================================================

BEGIN;

ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS diaspora_history    TEXT,
  ADD COLUMN IF NOT EXISTS languages           TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_current_project BOOLEAN,
  ADD COLUMN IF NOT EXISTS will_introduce      BOOLEAN,
  -- Where it came from. 'public' is the pre-existing marketing form; 'in_app' is a
  -- contractor who already signed up, onboarded, and is asking for the partner pathway.
  ADD COLUMN IF NOT EXISTS source              TEXT NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_applications_source_check') THEN
    ALTER TABLE public.contractor_applications
      ADD CONSTRAINT contractor_applications_source_check
      CHECK (source IN ('public', 'in_app'));
  END IF;
END $$;

COMMENT ON COLUMN public.contractor_applications.languages IS
  'Languages this professional works in (133). Routes the qualification call: a '
  'French-speaking applicant is booked with Vanessa rather than into a call nobody in '
  'it can hold.';
COMMENT ON COLUMN public.contractor_applications.has_current_project IS
  'A live diaspora project right now (133). With will_introduce, this is what decides '
  'whether a call is worth Philip''s calendar.';

-- ── Who may apply from inside the app ──────────────────────
-- 026's own INSERT policy is for the public form and stays as it is. This one is
-- narrower on purpose: a signed-in person may file ONE application, as themselves.
DROP POLICY IF EXISTS "self_insert_application" ON public.contractor_applications;
CREATE POLICY "self_insert_application"
  ON public.contractor_applications FOR INSERT TO authenticated
  WITH CHECK (
    source = 'in_app'
    -- Filed as themselves. Without this a signed-in user could file under another
    -- person's id and reach the partner queue as them.
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "self_read_application" ON public.contractor_applications;
CREATE POLICY "self_read_application"
  ON public.contractor_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- One live application per person: a second is a duplicate in Ruth's queue, not a
-- second opportunity. Withdrawn and rejected ones do not block a fresh attempt.
CREATE UNIQUE INDEX IF NOT EXISTS contractor_applications_one_open_per_user
  ON public.contractor_applications (user_id)
  -- 026's own CHECK: pending | disqualified | reviewing | accepted | rejected.
  -- Only the three that are still live block a second attempt.
  WHERE user_id IS NOT NULL AND status IN ('pending', 'reviewing', 'accepted');

-- ── The decision itself, recorded ──────────────────────────
-- "Onboarding is not complete unless they are able to decide whether they want to be
-- certified partners" (Philip, 21 Oct). So the question is asked at the end of
-- onboarding, and the ANSWER is kept — not just the applications that follow it.
--
-- Without this, somebody who says yes and then abandons the form is invisible: Ruth sees
-- no application and no trace of the intent, and the funnel leaks exactly where it is
-- being measured. `NULL` means not asked yet, which is every contractor who onboarded
-- before today.
ALTER TABLE public.contractor_onboarding
  ADD COLUMN IF NOT EXISTS partner_interest    boolean,
  ADD COLUMN IF NOT EXISTS partner_interest_at timestamptz;

COMMENT ON COLUMN public.contractor_onboarding.partner_interest IS
  'Did they say yes to the partner pathway at the end of onboarding (133)? NULL = not '
  'asked. True with no application in contractor_applications is a funnel leak worth '
  'chasing, which is the whole reason it is stored.';

/**
 * Record it. Theirs alone, like set_contractor_client_intent (118) beside it.
 */
CREATE OR REPLACE FUNCTION public.set_partner_interest(p_interest boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in: an answer has an author'; END IF;
  UPDATE public.contractor_onboarding
     SET partner_interest = p_interest, partner_interest_at = now()
   WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_onboarding: finish onboarding before answering this';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_partner_interest(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_partner_interest(boolean) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'contractor_applications'
--      AND column_name IN ('diaspora_history','languages','has_current_project','will_introduce','source');
--
--   -- the funnel, by stage:
--   SELECT source, status, count(*) FROM public.contractor_applications GROUP BY 1,2 ORDER BY 1,2;
--
--   -- said yes and never filed — the leak worth chasing:
--   SELECT o.user_id FROM public.contractor_onboarding o
--    WHERE o.partner_interest
--      AND NOT EXISTS (SELECT 1 FROM public.contractor_applications a WHERE a.user_id = o.user_id);
