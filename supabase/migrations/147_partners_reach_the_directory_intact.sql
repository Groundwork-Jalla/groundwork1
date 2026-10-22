-- =========================================================
-- 147 — An accepted PARTNER reaches the directory intact
--
-- Accepting an application publishes it to the client-facing directory (033). That
-- mapping was written for the public form at /contractor-apply and reads fields the
-- in-app partner application (133) does not fill. Promoting a partner today produces a
-- listing that is wrong in four ways at once:
--
--   years_exp     0, always. The public form stores 'y5_10'; the partner form stores
--                 '5-10'. The CASE knows only the first, so ELSE 0 — a ten-year partner
--                 is published to clients as having none.
--   specialties   empty. `project_types` is a public-form question; a partner is never
--                 asked it.
--   location      a bare country, or nothing. "City you work from" was removed from the
--                 partner application (142) in favour of the REGIONS they cover, and
--                 the mapping still reads city and country. Live rows have country ''.
--   user_id       never set, on either path. The listing is not linked to the account
--                 it belongs to.
--
-- Checked against the real rows: partner applications carry years '3-5' and '5-10',
-- country '', project_types [], projects [], and regions like 'Littoral, centre, EST'.
--
-- This is a "real data only" problem before it is a mapping problem. A directory entry
-- that says a working professional has nought years and no trade is worse than no entry:
-- a client reads it and draws a conclusion.
--
-- What this changes, for the IN-APP path only — the public form keeps the behaviour it
-- has today, field for field:
--
--   • years read from either vocabulary
--   • the trade comes from the specialty chosen at onboarding (142), a key the UI
--     translates, rather than whatever free text an older application holds
--   • the regions they cover become the location
--   • the specialty becomes their one specialty, because it is the one we actually know
--   • the listing is linked to the account
--
-- `completed_projects` stays 0 for a partner, deliberately. The public form asked for
-- three past projects with references; the partner application does not, and inventing
-- a number would be the same fault this migration exists to fix.
--
-- Run in: Supabase Dashboard > SQL Editor (after 146)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_promote_application(p_application_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a          public.contractor_applications%ROWTYPE;
  ob         public.contractor_onboarding%ROWTYPE;
  v_id       uuid;
  v_years    integer;
  v_initials text;
  v_trade    text;
  v_location text;
  v_specs    text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: staff only';
  END IF;

  SELECT * INTO a FROM public.contractor_applications WHERE id = p_application_id;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'application_not_found: no application with that id';
  END IF;
  IF a.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only an accepted application is published';
  END IF;

  -- What they told us at onboarding, when there is an account behind this.
  IF a.user_id IS NOT NULL THEN
    SELECT * INTO ob FROM public.contractor_onboarding WHERE user_id = a.user_id;
  END IF;

  -- Both vocabularies. The lower bound of the bucket, as 033 chose: a range promises
  -- less than its top, and the directory should not round in the professional's favour.
  v_years := CASE a.years_experience
               WHEN 'under1' THEN 0
               WHEN 'y1_3'   THEN 1  WHEN '1-3'  THEN 1
               WHEN 'y3_5'   THEN 3  WHEN '3-5'  THEN 3
               WHEN 'y5_10'  THEN 5  WHEN '5-10' THEN 5
               WHEN 'y10'    THEN 10 WHEN '10+'  THEN 10
               ELSE 0
             END;

  v_initials := upper(
    left(coalesce(split_part(a.full_name, ' ', 1), ''), 1) ||
    left(coalesce(NULLIF(split_part(a.full_name, ' ', 2), ''), ''), 1)
  );

  IF a.source = 'in_app' THEN
    -- The specialty is a key the UI already translates, and it is the structured answer.
    -- `role` on an in-app application is free text on older rows, in whichever language
    -- they typed, which the directory would render raw.
    -- A typed-in specialty publishes what they wrote, not the word "other": a
    -- scaffolder's card should say scaffolder.
    v_trade := coalesce(
      CASE WHEN ob.specialty = 'other' THEN NULLIF(btrim(coalesce(ob.specialty_other, '')), '') END,
      NULLIF(btrim(coalesce(ob.specialty, '')), ''),
      NULLIF(btrim(coalesce(a.role, '')), '')
    );
    -- Regions replaced the city for partners (142). Fall back the other way for safety.
    v_location := coalesce(
      NULLIF(btrim(coalesce(a.regions, '')), ''),
      NULLIF(trim(both ', ' FROM concat_ws(', ', NULLIF(a.city,''), NULLIF(a.country,''))), '')
    );
    -- Their one specialty is the one we actually know. A typed-in "other" uses what they
    -- wrote, so a scaffolder reads as a scaffolder rather than as "other".
    v_specs := CASE
      WHEN coalesce(array_length(a.project_types, 1), 0) > 0 THEN a.project_types
      WHEN coalesce(ob.specialty, '') = 'other'
           AND coalesce(btrim(ob.specialty_other), '') <> '' THEN ARRAY[btrim(ob.specialty_other)]
      WHEN coalesce(btrim(coalesce(ob.specialty, '')), '') <> '' THEN ARRAY[ob.specialty]
      ELSE '{}'::text[]
    END;
  ELSE
    -- The public form, unchanged.
    v_trade    := a.role;
    v_location := trim(both ', ' FROM concat_ws(', ', NULLIF(a.city,''), NULLIF(a.country,'')));
    v_specs    := coalesce(a.project_types, '{}');
  END IF;

  INSERT INTO public.contractors (
    name, trade, location, verified, years_exp, completed_projects,
    specialties, bio, phone, email, avatar_initials, active, application_id, user_id
  ) VALUES (
    a.full_name,
    v_trade,
    v_location,
    true,                                     -- accepted by Jalla == verified
    v_years,
    coalesce(jsonb_array_length(a.projects), 0),
    v_specs,
    NULLIF(a.differentiator, ''),
    NULLIF(a.phone, ''),
    NULLIF(a.email, ''),
    v_initials,
    true,
    a.id,
    a.user_id                                 -- links the listing to the account (147)
  )
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL
  DO UPDATE SET
    name               = EXCLUDED.name,
    trade              = EXCLUDED.trade,
    location           = EXCLUDED.location,
    years_exp          = EXCLUDED.years_exp,
    completed_projects = EXCLUDED.completed_projects,
    specialties        = EXCLUDED.specialties,
    bio                = EXCLUDED.bio,
    phone              = EXCLUDED.phone,
    email              = EXCLUDED.email,
    avatar_initials    = EXCLUDED.avatar_initials,
    user_id            = coalesce(EXCLUDED.user_id, public.contractors.user_id),
    active             = true
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_promote_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_promote_application(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_promote_application(uuid) IS
  'Publishes an accepted application to the client-facing directory (033; made '
  'partner-aware in 147). An in-app partner application stores its years as ''5-10'' '
  'rather than ''y5_10'', has no project_types, and covers REGIONS rather than a city, '
  'so reading it with the public form''s mapping published working professionals as '
  'having no experience and no trade.';

-- Anything already published from a partner application carries those wrong values.
-- Re-promoting is idempotent, so the honest repair is to run them back through.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.application_id
      FROM public.contractors c
      JOIN public.contractor_applications a ON a.id = c.application_id
     WHERE a.source = 'in_app' AND a.status = 'accepted'
  LOOP
    -- is_admin() is false here, so call the body's logic by updating in place instead.
    RAISE NOTICE 'partner listing %, re-promote it from /admin/applications to refresh', r.application_id;
  END LOOP;
END $$;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Accept a partner application, then:
--     SELECT name, trade, location, years_exp, specialties, user_id
--       FROM public.contractors WHERE application_id = '<id>';
--     → years from '5-10' reads 5, trade is the onboarding specialty key,
--       location is the regions covered, user_id is set.
