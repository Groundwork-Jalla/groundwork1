-- =========================================================
-- 150 — Finishing an application takes you off the follow-up list
--
-- The admin drafts list separates "started and gave up" from "started and finished" by
-- `submitted_application_id`. Nine of nine in-app partner drafts have it NULL, including
-- four people who went on to submit — one of them decision-ready and already offered a
-- call. They sit on the abandoned list looking exactly like a drop-off, and nobody
-- reading that list could tell.
--
-- ── Why it never worked ─────────────────────────────────────────────────────────────
-- `markPartnerDraftSubmitted` does a direct UPDATE. Verified against production: an
-- UPDATE on this table from `anon` or `authenticated` returns 204 and changes nothing.
-- PostgREST reports a zero-row update as success, so the app has been told nine times
-- that it worked.
--
-- This is the same wall 143 hit. Drafts hold applicants' names, phone numbers and email
-- addresses, so the table is deliberately closed and every write goes through a
-- SECURITY DEFINER function. The save path was moved there; this one was missed.
--
-- So: a function, not a re-opened policy. Re-opening would mean an UPDATE policy of
-- USING (true) for anon — no ownership check at all — on exactly the rows 139 refused
-- to let anyone read.
--
-- ── Who may close what ──────────────────────────────────────────────────────────────
-- Signed in: your own drafts, found by auth.uid(). The caller does not get to name the
-- user, so nobody can close somebody else's.
-- Signed out: the public form at /contractor-apply has no account, and its draft id is
-- an unguessable UUID held only in that browser — 043's reasoning, unchanged. So a
-- draft id is accepted, and it is the only thing accepted.
--
-- Run in: Supabase Dashboard > SQL Editor (after 149)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_contractor_draft_submitted(
  p_application uuid,
  p_draft       uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF p_application IS NULL THEN
    RAISE EXCEPTION 'application_required: which application did this draft become';
  END IF;

  IF v_user IS NOT NULL THEN
    -- Every open draft of theirs, not just the one this browser knows about: somebody
    -- who starts on a phone and finishes on a laptop leaves a row the laptop has never
    -- heard of, and chasing somebody who already applied is worse than not chasing.
    UPDATE public.contractor_application_drafts
       SET submitted_application_id = p_application,
           updated_at = now()
     WHERE user_id = v_user
       AND submitted_application_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  -- The signed-out public form, which has only its draft id. Also the belt to the
  -- braces above for a signed-in applicant whose draft predates having an account.
  IF p_draft IS NOT NULL THEN
    UPDATE public.contractor_application_drafts
       SET submitted_application_id = p_application,
           updated_at = now()
     WHERE id = p_draft
       AND submitted_application_id IS NULL;
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END $$;

COMMENT ON FUNCTION public.mark_contractor_draft_submitted(uuid, uuid) IS
  'Closes a draft once it has become a real application (150). SECURITY DEFINER for the '
  'same reason as save_contractor_draft (143): the table is closed to direct writes '
  'because these rows hold applicants'' names, phones and emails. A signed-in caller '
  'closes only their own, found by auth.uid() rather than named by the caller.';

REVOKE ALL ON FUNCTION public.mark_contractor_draft_submitted(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_contractor_draft_submitted(uuid, uuid) TO anon, authenticated;


-- ── Repair the follow-up list ────────────────────────────
--
-- Everyone whose draft is still open although they did submit. Matched on the account,
-- which is the only honest link: the draft and the application are the same person's.
-- Newest application per user, since one live application per person is enforced by 133
-- and an older one would be the wrong row to point at.
WITH finished AS (
  SELECT DISTINCT ON (a.user_id) a.user_id, a.id AS application_id
    FROM public.contractor_applications a
   WHERE a.source = 'in_app' AND a.user_id IS NOT NULL
   ORDER BY a.user_id, a.created_at DESC
)
UPDATE public.contractor_application_drafts d
   SET submitted_application_id = f.application_id
  FROM finished f
 WHERE d.user_id = f.user_id
   AND d.source = 'in_app'
   AND d.submitted_application_id IS NULL;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Nobody who applied is still on the abandoned list:
--     SELECT d.email, d.submitted_application_id
--       FROM public.contractor_application_drafts d
--       JOIN public.contractor_applications a ON a.user_id = d.user_id AND a.source='in_app'
--      WHERE d.submitted_application_id IS NULL;   → 0 rows
--   And the remaining open drafts are the real ones:
--     SELECT email, updated_at FROM public.contractor_application_drafts
--      WHERE source='in_app' AND submitted_application_id IS NULL;
