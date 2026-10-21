-- =========================================================
-- 144 — The one-contact change landed on the wrong function
--
-- Reported from the live form, 22 Oct: the Emergency contact screen says one person is
-- enough, one was filled in, and Continue answered
--
--   "All three emergency contacts are required."
--
-- 142 reduced the requirement from three to one — but it wrote a NEW function called
-- `save_emergency_contacts`, and the application calls
-- `save_contractor_emergency_contacts`. So 142 added a function nobody calls and left
-- the one that runs still demanding exactly three. It verified clean on a scratch
-- cluster because the test called the function that had just been written rather than
-- the one the client actually uses.
--
-- The payload keys were wrong too: the client sends `full_name`, `relationship`, `phone`
-- and 142's version read `fullName`. Either mistake alone would have broken it.
--
-- This changes the REAL function, keeping 116's name and its snake_case keys, and drops
-- the dead one so it cannot be mistaken for the live path later.
--
-- Run in: Supabase Dashboard > SQL Editor (after 143)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.save_contractor_emergency_contacts(p_contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.assert_own_onboarding();
  v_n    integer;
BEGIN
  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts_shape: expected a list of contacts';
  END IF;

  v_n := jsonb_array_length(p_contacts);
  -- One is enough (142's intent, applied here to the function that actually runs).
  -- Three remains the maximum the table allows: position is CHECKed 1..3.
  IF v_n < 1 THEN
    RAISE EXCEPTION 'contacts_count: at least one emergency contact is required';
  END IF;
  IF v_n > 3 THEN
    RAISE EXCEPTION 'contacts_count: at most three emergency contacts can be stored, got %', v_n;
  END IF;

  DELETE FROM public.contractor_emergency_contacts WHERE user_id = v_user;

  -- The column CHECKs do the validating — a blank name or a number that is not E.164
  -- aborts the whole statement, so a bad contact cannot leave a half-saved set behind.
  -- Keys stay snake_case, which is what the client sends.
  INSERT INTO public.contractor_emergency_contacts
    (user_id, position, full_name, relationship, phone)
  SELECT v_user,
         (ord)::smallint,
         btrim(c->>'full_name'),
         btrim(c->>'relationship'),
         btrim(c->>'phone')
    FROM jsonb_array_elements(p_contacts) WITH ORDINALITY AS t(c, ord);

  RETURN public.contractor_onboarding_status(v_user);
END $$;

REVOKE ALL ON FUNCTION public.save_contractor_emergency_contacts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_contractor_emergency_contacts(jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_contractor_emergency_contacts(jsonb) IS
  'Saves a contractor''s emergency contacts (116; one is enough since 144). The name and '
  'the snake_case keys are what the client sends — 142 changed a differently named copy '
  'and the live form went on demanding three.';

-- The function 142 added and nothing ever called.
DROP FUNCTION IF EXISTS public.save_emergency_contacts(jsonb);

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   As a contractor, one contact must now save:
--     SELECT public.save_contractor_emergency_contacts(
--       '[{"full_name":"Awa","relationship":"Sister","phone":"+237677112233"}]'::jsonb);
--     → steps.emergency true
--   And the dead one is gone:
--     SELECT public.save_emergency_contacts('[]'::jsonb);   → function does not exist
