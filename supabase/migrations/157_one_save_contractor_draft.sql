-- =========================================================
-- 157 — URGENT: one save_contractor_draft, not two
--
-- 155 is mine and it is wrong. It used CREATE OR REPLACE with the parameters in a
-- different ORDER from 143, and a function's identity in PostgreSQL includes its
-- parameter types in order. So it did not replace anything — it created a SECOND
-- function with the same name and the same parameter names in a different sequence.
--
-- PostgREST resolves by argument name. With two candidates carrying the same nine
-- names it cannot choose, and every call now fails before it reaches either:
--
--   PGRST203  Could not choose the best candidate function between:
--             save_contractor_draft(p_id, p_source, p_user_id, p_full_name, …)
--             save_contractor_draft(p_id, p_full_name, p_email, p_phone, …)
--
-- That is worse than the 409 it was meant to fix. The 409 lost drafts for applicants on
-- a second device; this loses them for everybody, on every keystroke.
--
-- I avoided exactly this trap twice in one evening — 149 dropped notify_project_members
-- before widening it, 154 dropped admin_partner_pipeline before adding a column — and
-- then walked into it here, because reordering parameters does not look like changing a
-- signature. It is.
--
-- ── The fix ─────────────────────────────────────────────────────────────────────────
-- Drop the one 155 created, identified by its own type sequence, and put 155's logic
-- into 143's signature exactly as 143 declared it: same order, same defaults, and
-- RETURNS void — 143 returns void, and CREATE OR REPLACE cannot change that (42P13).
--
-- Run in: Supabase Dashboard > SQL Editor (immediately — draft capture is down)
-- =========================================================

BEGIN;

-- 155's function, by its own type sequence. 143's is (uuid, text, text, text, text,
-- jsonb, integer, text, uuid) and is deliberately left alone.
DROP FUNCTION IF EXISTS public.save_contractor_draft(
  uuid, text, uuid, text, text, text, text, jsonb, integer);

-- 143's signature, to the letter, carrying 155's by-user lookup.
CREATE OR REPLACE FUNCTION public.save_contractor_draft(
  p_id           uuid,
  p_full_name    text DEFAULT NULL,
  p_email        text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_role         text DEFAULT NULL,
  p_payload      jsonb DEFAULT '{}'::jsonb,
  p_progress_pct integer DEFAULT 0,
  p_source       text DEFAULT 'public',
  p_user_id      uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing uuid;
BEGIN
  -- 155's reason, unchanged: 138 allows a partner ONE live in-app draft, keyed on the
  -- user. The draft id lives in localStorage, so a second browser mints a new one — it
  -- conflicts with nothing on `id` while conflicting with everything on `user_id`, and
  -- ON CONFLICT (id) never fires. Find the row by the person instead.
  IF p_source = 'in_app' AND p_user_id IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.contractor_application_drafts
     WHERE user_id = p_user_id
       AND source = 'in_app'
       AND submitted_application_id IS NULL
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      UPDATE public.contractor_application_drafts
         SET full_name = p_full_name, email = p_email, phone = p_phone, role = p_role,
             payload = coalesce(p_payload, '{}'::jsonb),
             progress_pct = p_progress_pct, updated_at = now()
       WHERE id = v_existing;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.contractor_application_drafts
    (id, source, user_id, full_name, email, phone, role, payload, progress_pct)
  VALUES
    (p_id, p_source, p_user_id, p_full_name, p_email, p_phone, p_role,
     coalesce(p_payload, '{}'::jsonb), p_progress_pct)
  ON CONFLICT (id) DO UPDATE
    SET full_name    = EXCLUDED.full_name,
        email        = EXCLUDED.email,
        phone        = EXCLUDED.phone,
        role         = EXCLUDED.role,
        payload      = EXCLUDED.payload,
        progress_pct = EXCLUDED.progress_pct,
        updated_at   = now();
END $$;

COMMENT ON FUNCTION public.save_contractor_draft(uuid, text, text, text, text, jsonb, integer, text, uuid) IS
  'Saves a half-finished application (143; second-device safe since 155, restored to '
  'this one signature in 157). A partner''s live draft is found by user, not by the id '
  'this browser happens to hold, because 138 allows them only one.';

REVOKE ALL ON FUNCTION public.save_contractor_draft(uuid, text, text, text, text, jsonb, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_contractor_draft(uuid, text, text, text, text, jsonb, integer, text, uuid) TO anon, authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Exactly one candidate, so PostgREST can resolve the call again:
--     SELECT count(*) FROM pg_proc WHERE proname = 'save_contractor_draft';   → 1
--   And a second device still folds into the one live draft:
--     SELECT public.save_contractor_draft(gen_random_uuid(), 'A','a@x.com',NULL,NULL,
--              '{}'::jsonb, 30, 'in_app', '<user>');
--     SELECT public.save_contractor_draft(gen_random_uuid(), 'A','a@x.com',NULL,NULL,
--              '{}'::jsonb, 60, 'in_app', '<user>');
--     → one row, progress 60
