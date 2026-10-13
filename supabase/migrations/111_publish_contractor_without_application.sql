-- =========================================================
-- 111  Listing a contractor who never filled in an application
--
-- WHY
--
-- `public.contractors` is the directory clients browse to find somebody to build for
-- them. Exactly one thing has ever written to it: `admin_promote_application` (033),
-- which takes an APPLICATION id and publishes the listing when an admin accepts it.
--
-- That covers one of the three ways a contractor comes to exist, and strands the others:
--
--   · an APPLICANT (026/100) — applies, is accepted, gets listed. Works.
--   · an ADMIN-ONBOARDED contractor (/admin/users/new) — a real account with the
--     contractor role and no application at all. Cannot be listed. Ever.
--   · a SELF-REGISTERED partner (106) — same, and deliberately not listed by default:
--     nobody has vetted them, and the directory is Jalla saying "these people are worth
--     talking to".
--
-- So the directory reads empty while contractors exist, and the browse-and-request-a-quote
-- feature shows clients nothing. This adds the missing writer: an admin publishes a
-- contractor who already has an account, on their own say-so.
--
-- ── What it does not change ──────────────────────────────────────────────────────────
-- The directory is still admin-write-only (033). Nothing here lets a contractor list
-- themselves, and a listing still confers no access to anything — it is a profile a
-- client can read and ask for a quote from, nothing more.
--
-- Run in: Supabase Dashboard > SQL Editor (after 110)
-- =========================================================

BEGIN;

-- ── 1. Who holds an account but no listing ───────────────
--
-- The admin's shortlist: everybody with contractor standing who the directory does not
-- yet show. Returns how they came to be a contractor, because that is what tells staff
-- whether they have been vetted — an accepted applicant has, a self-registration has not.
CREATE OR REPLACE FUNCTION public.admin_unlisted_contractors()
RETURNS TABLE (
  user_id    uuid,
  full_name  text,
  email      text,
  phone      text,
  origin     text,
  since      timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.phone,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.contractor_applications a
                    WHERE a.user_id = p.id AND a.status = 'accepted') THEN 'applied'
      WHEN p.provisioned_by IS NOT NULL                                THEN 'onboarded_by_admin'
      ELSE 'self_registered'
    END,
    r.created_at
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'contractor'
 WHERE public.is_admin()                       -- no rows at all to anybody else
   AND NOT EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = p.id)
 ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_unlisted_contractors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlisted_contractors() TO authenticated;  -- is_admin() inside

-- ── 2. Publish one ───────────────────────────────────────
--
-- Admin only, and only for somebody who already holds the contractor role: the directory
-- must never advertise an account that cannot actually be given work.
--
-- `verified` is true because an admin is publishing it by hand — that IS the check. An
-- accepted application earns the same flag through 033, by a different route.
CREATE OR REPLACE FUNCTION public.admin_publish_contractor(
  p_user        uuid,
  p_trade       text,
  p_location    text,
  p_specialties text[] DEFAULT '{}',
  p_bio         text   DEFAULT NULL,
  p_years_exp   integer DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prof  public.profiles%ROWTYPE;
  v_id    uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator publishes a contractor';
  END IF;
  IF btrim(coalesce(p_trade, '')) = '' THEN
    RAISE EXCEPTION 'trade_required: the directory is browsed by trade';
  END IF;
  IF btrim(coalesce(p_location, '')) = '' THEN
    RAISE EXCEPTION 'location_required: a client searches for somebody near them';
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_account: no such user'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'contractor') THEN
    RAISE EXCEPTION 'not_contractor: that account cannot be given work, so it is not listed';
  END IF;

  INSERT INTO public.contractors
    (user_id, name, trade, location, specialties, bio, years_exp, phone, email,
     avatar_initials, verified, active)
  VALUES (
    p_user,
    COALESCE(NULLIF(btrim(v_prof.full_name), ''), v_prof.email),
    btrim(p_trade),
    btrim(p_location),
    COALESCE(p_specialties, '{}'),
    NULLIF(btrim(coalesce(p_bio, '')), ''),
    GREATEST(COALESCE(p_years_exp, 0), 0),
    v_prof.phone,
    v_prof.email,
    upper(left(regexp_replace(COALESCE(v_prof.full_name, v_prof.email), '[^A-Za-z]', '', 'g'), 2)),
    true,
    true
  )
  -- Already listed: this is an edit, not a second entry. 100's unique index on user_id
  -- is what makes that safe — and it is PARTIAL (`WHERE user_id IS NOT NULL`), so the
  -- predicate has to be repeated here or Postgres cannot infer which index is meant and
  -- refuses the statement outright.
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE
     SET trade       = EXCLUDED.trade,
         location    = EXCLUDED.location,
         specialties = EXCLUDED.specialties,
         bio         = EXCLUDED.bio,
         years_exp   = EXCLUDED.years_exp,
         active      = true
  RETURNING id INTO v_id;

  PERFORM public.log_activity(NULL, 'contractor.published', 'contractor', v_id, p_user,
    jsonb_build_object('trade', btrim(p_trade), 'by', 'admin'));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_publish_contractor(uuid, text, text, text[], text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_contractor(uuid, text, text, text[], text, integer)
  TO authenticated;  -- is_admin() inside

COMMENT ON FUNCTION public.admin_publish_contractor(uuid, text, text, text[], text, integer) IS
  'Publish a contractor who has an account but no application (111). The directory had '
  'exactly one writer — admin_promote_application — so an admin-onboarded contractor '
  'could never be listed. Admin only; the account must already hold the contractor role.';

COMMIT;
