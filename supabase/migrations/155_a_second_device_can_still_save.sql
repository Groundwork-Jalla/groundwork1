-- =========================================================
-- 155 — A partner who opens the form on a second device can still save
--
-- Found by driving the real form: every draft save returned 409 and the applicant was
-- told nothing.
--
-- 138 put a unique index on (user_id) for live in-app drafts, so starting on a phone and
-- again on a laptop cannot leave two rows and count one person twice. That part works.
--
-- But `save_contractor_draft` (143) resolves conflicts with ON CONFLICT (id) — the
-- primary key — and the draft id lives in localStorage. A second browser mints a NEW
-- id, so the INSERT carries an id that conflicts with nothing while its user_id
-- conflicts with everything. ON CONFLICT (id) never fires, the partial index refuses the
-- row, and PostgREST returns 409. The save path is dead for that applicant from then on:
-- not once, but on every keystroke, in silence.
--
-- The nine unlinked in-app drafts on the system are all first-device saves. Nobody who
-- came back on another device left a trace at all.
--
-- ── Why not widen the ON CONFLICT target ────────────────────────────────────────────
-- ON CONFLICT takes one target, and `contractor_drafts_one_per_partner` is PARTIAL —
-- inferring it needs its exact predicate restated, which then has to stay in step with
-- 138 forever. Looking the row up first is plainer and says what it means: one live
-- draft per partner, found by the partner.
--
-- Run in: Supabase Dashboard > SQL Editor (after 154)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.save_contractor_draft(
  p_id           uuid,
  p_source       text,
  p_user_id      uuid,
  p_full_name    text,
  p_email        text,
  p_phone        text,
  p_role         text,
  p_payload      jsonb,
  p_progress_pct integer
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing uuid;
BEGIN
  -- The partner application: one live draft per person, whatever this browser calls it.
  -- SECURITY DEFINER is what makes this lookup possible at all — the table grants no
  -- SELECT, because these rows hold applicants' names, phones and emails.
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
             payload = p_payload, progress_pct = p_progress_pct, updated_at = now()
       WHERE id = v_existing;
      RETURN v_existing;
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

  RETURN p_id;
END $$;

COMMENT ON FUNCTION public.save_contractor_draft(uuid, text, uuid, text, text, text, text, jsonb, integer) IS
  'Saves a half-finished application (143; made second-device safe in 155). A partner''s '
  'live draft is found by user, not by the id this browser happens to hold, because the '
  'unique index in 138 allows them only one.';

REVOKE ALL ON FUNCTION public.save_contractor_draft(uuid, text, uuid, text, text, text, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_contractor_draft(uuid, text, uuid, text, text, text, text, jsonb, integer) TO anon, authenticated;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Saving twice with DIFFERENT ids, as two browsers would, keeps one row:
--     SELECT public.save_contractor_draft(gen_random_uuid(),'in_app','<user>', 'A','a@x.com',NULL,NULL,'{}'::jsonb,30);
--     SELECT public.save_contractor_draft(gen_random_uuid(),'in_app','<user>', 'A','a@x.com',NULL,NULL,'{}'::jsonb,60);
--     SELECT count(*) FROM public.contractor_application_drafts
--      WHERE user_id = '<user>' AND source='in_app' AND submitted_application_id IS NULL;  → 1
