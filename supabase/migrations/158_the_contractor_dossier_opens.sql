-- =========================================================
-- 158 — The contractor dossier opens
--
-- Ruth, unable to assess partner applicants: "I am unable to see contractor form
-- details… But it wasn't opening. I also refreshed multiple times."
--
-- Every contractor dossier fails, and has since it shipped. 41 of 41 on the live system:
--
--   42703  column d.bank_code does not exist
--
-- 099 created `payout_destinations.bank_code`. 101 renamed it to `bank_key`, on purpose
-- and with its reasoning written down: the column holds a Groundwork slug, not the
-- routing code a payment provider would recognise, and "carrying a slug in a column
-- called bank_code is not a cosmetic problem". 118 then wrote this function against the
-- old name. Nothing caught it because a dossier is only built when somebody expands a
-- row, and the screen catches every error into one sentence.
--
-- ── The JSON key changes too ────────────────────────────────────────────────────────
-- The payload said `bank_code` as well. Keeping that name would have been the smaller
-- change and would have re-introduced exactly the confusion 101 removed, one layer up.
-- The admin screen is updated with it.
--
-- Run in: Supabase Dashboard > SQL Editor (after 157)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_contractor_dossier(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator reads a contractor dossier';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'no_user: nobody named';
  END IF;

  SELECT jsonb_build_object(
    'user_id', p_user,
    'profile', (
      SELECT jsonb_build_object('email', p.email, 'full_name', p.full_name, 'phone', p.phone)
        FROM public.profiles p WHERE p.id = p_user),
    'onboarding', (
      SELECT to_jsonb(o) FROM public.contractor_onboarding o WHERE o.user_id = p_user),
    'emergency_contacts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'position', c.position, 'full_name', c.full_name,
               'relationship', c.relationship, 'phone', c.phone)
             ORDER BY c.position)
        FROM public.contractor_emergency_contacts c WHERE c.user_id = p_user), '[]'::jsonb),
    'payout_destinations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'country_code', d.country_code, 'method', d.method,
               'mobile_no', d.mobile_no, 'bank_key', d.bank_key,
               'account_number', d.account_number, 'account_name', d.account_name,
               'status', d.status, 'is_default', d.is_default,
               'created_at', d.created_at)
             ORDER BY d.is_default DESC, d.created_at)
        FROM public.payout_destinations d
       WHERE d.owner_id = p_user AND d.status <> 'retired'), '[]'::jsonb),
    'agreements', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'document', a.document, 'version', a.version,
               'signed_name', a.signed_name, 'accepted_at', a.accepted_at)
             ORDER BY a.accepted_at)
        FROM public.agreement_acceptances a WHERE a.user_id = p_user), '[]'::jsonb),
    'documents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', x.kind, 'filename', x.filename, 'path', x.path,
               'uploaded_at', x.uploaded_at))
        FROM public.contractor_documents x WHERE x.user_id = p_user), '[]'::jsonb),
    'status', public.contractor_onboarding_status(p_user)
  ) INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.admin_contractor_dossier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contractor_dossier(uuid) TO authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   As an admin, every contractor now opens:
--     SELECT public.admin_contractor_dossier(user_id) IS NOT NULL
--       FROM public.user_roles WHERE role = 'contractor';   → all true
