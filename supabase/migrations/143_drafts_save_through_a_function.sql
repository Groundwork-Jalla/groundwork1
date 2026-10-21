-- =========================================================
-- 143 — The draft autosave was still refused after 139
--
-- 139 restored 043's write policies and they work: as `anon` a plain INSERT returns 201
-- and a PATCH returns 204. The autosave still failed, because it does neither — it
-- UPSERTS, so that the first save creates the row and every later one replaces it
-- without a round trip to find out which case it is.
--
--   POST /rest/v1/contractor_application_drafts
--   Prefer: resolution=merge-duplicates          → 42501
--
-- `INSERT ... ON CONFLICT DO UPDATE` has to READ the conflicting row before it can
-- update it, and 043 deliberately grants no SELECT policy on this table:
--
--   "SELECT is NOT granted. These rows hold names, phone numbers and emails; nobody
--    but an admin reads them back."
--
-- So the write policies and the read rule were each correct and together made the one
-- operation the client actually performs impossible. Verified on a scratch cluster:
-- with INSERT and UPDATE policies and no SELECT policy the upsert is refused, and
-- adding a SELECT policy makes the identical statement succeed.
--
-- ── Why a function and not a SELECT policy ───────────────
-- A SELECT policy that let an applicant read their own row would have to identify them,
-- and an applicant is anonymous — the unguessable id in their browser is the only handle
-- on them. `USING (true)` would hand every name, phone number and email to anybody with
-- the anon key. So the upsert moves into a SECURITY DEFINER function instead, which is
-- the same answer 052 already reached for READING a draft back:
--
--   "Goes through `get_contractor_draft` (052) rather than a table read: the applicant
--    is anonymous and the only SELECT policy on the table is admin-only. The id itself
--    is the credential."
--
-- Run in: Supabase Dashboard > SQL Editor (after 142)
-- =========================================================

BEGIN;

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
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'draft_id_required: the draft has no id';
  END IF;
  IF p_source NOT IN ('public', 'in_app') THEN
    RAISE EXCEPTION 'bad_source: % is not a door anybody comes through', p_source;
  END IF;

  -- An in-app draft is written by somebody signed in, and it may only be written as
  -- THEMSELVES. Without this the definer rights above would let any caller attach a
  -- draft to any account. A public draft stays anonymous, as it always was.
  IF p_source = 'in_app' AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'not_your_draft: an in-app draft belongs to the person writing it';
  END IF;

  INSERT INTO public.contractor_application_drafts
    (id, full_name, email, phone, role, payload, progress_pct, source, user_id, updated_at)
  VALUES (
    p_id,
    NULLIF(btrim(coalesce(p_full_name, '')), ''),
    lower(NULLIF(btrim(coalesce(p_email, '')), '')),
    NULLIF(btrim(coalesce(p_phone, '')), ''),
    NULLIF(btrim(coalesce(p_role, '')), ''),
    coalesce(p_payload, '{}'::jsonb),
    greatest(0, least(100, coalesce(p_progress_pct, 0))),
    p_source,
    CASE WHEN p_source = 'in_app' THEN p_user_id ELSE NULL END,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name    = EXCLUDED.full_name,
        email        = EXCLUDED.email,
        phone        = EXCLUDED.phone,
        role         = EXCLUDED.role,
        payload      = EXCLUDED.payload,
        progress_pct = EXCLUDED.progress_pct,
        source       = EXCLUDED.source,
        user_id      = EXCLUDED.user_id,
        updated_at   = now()
    -- A draft that has already become an application is finished with. Without this,
    -- a stale tab left open could reopen somebody's closed follow-up row.
    WHERE public.contractor_application_drafts.submitted_application_id IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.save_contractor_draft(uuid, text, text, text, text, jsonb, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_contractor_draft(uuid, text, text, text, text, jsonb, integer, text, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.save_contractor_draft(uuid, text, text, text, text, jsonb, integer, text, uuid) IS
  'Upserts an application draft (143). A definer function because the upsert must read '
  'the conflicting row and this table has no SELECT policy by design — the alternative, '
  'opening SELECT to anon, would publish every applicant''s name, phone and email. The '
  'id is the credential, as in 052; an in-app draft may only be written by its owner.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Twice with the SAME id, as the anon key — the second is the upsert that used to fail:
--     POST /rest/v1/rpc/save_contractor_draft
--       {"p_id":"<uuid>","p_full_name":"probe","p_progress_pct":10}
--     POST again with p_progress_pct 60   → 204 both times, one row, pct 60
--   And an in-app draft cannot be filed against somebody else:
--     {"p_id":"<uuid>","p_source":"in_app","p_user_id":"<another user>"}  → not_your_draft
