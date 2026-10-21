-- =========================================================
-- 138 — Tell a half-finished PARTNER application from a half-finished contractor one
--
-- `/admin/drafts` has listed abandoned applications since 043, but every row looked the
-- same because every row came from the same place: the public form at
-- /contractor-apply, filled in by a stranger with no account.
--
-- Since 133 there is a second, entirely different way in. A contractor who already has
-- an account answers six questions at /work/partner. Those two people need opposite
-- follow-ups — one is a cold lead who typed an email, the other is somebody already
-- using Groundwork who stopped one question short of a call with Philip — so the list
-- has to say which is which.
--
-- Two columns:
--
--   source   'public' for the open form, 'in_app' for the partner application. Named
--            and valued exactly as `contractor_applications.source` (133), so the same
--            word means the same thing on both tables.
--
--   user_id  who it is, when we know. A public draft is anonymous by nature — the id in
--            their browser is the only handle on them — but an in-app draft is a signed-in
--            contractor and staff should be able to open their record.
--
-- No policy changes. 043 already grants INSERT and UPDATE to `authenticated` as well as
-- `anon`, so a signed-in partner can already write their own draft.
--
-- Run in: Supabase Dashboard > SQL Editor (after 137)
-- =========================================================

BEGIN;

ALTER TABLE public.contractor_application_drafts
  ADD COLUMN IF NOT EXISTS source  TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.contractor_application_drafts
  DROP CONSTRAINT IF EXISTS contractor_draft_source;
ALTER TABLE public.contractor_application_drafts
  ADD  CONSTRAINT contractor_draft_source
  CHECK (source IN ('public', 'in_app'));

-- An in-app draft without a user is not something that can exist: it is written by a
-- signed-in contractor, and without the id staff cannot tell whose it is.
ALTER TABLE public.contractor_application_drafts
  DROP CONSTRAINT IF EXISTS contractor_draft_in_app_has_user;
ALTER TABLE public.contractor_application_drafts
  ADD  CONSTRAINT contractor_draft_in_app_has_user
  CHECK (source <> 'in_app' OR user_id IS NOT NULL);

COMMENT ON COLUMN public.contractor_application_drafts.source IS
  'Which door they started at (138): ''public'' is the open form at /contractor-apply, '
  '''in_app'' is the partner application at /work/partner (133). The admin list shows '
  'these as Contractor and Partner, because the follow-up is a different job.';

COMMENT ON COLUMN public.contractor_application_drafts.user_id IS
  'The signed-in contractor who started an in-app draft (138). Null for a public draft, '
  'whose author is anonymous by design — the unguessable id in their browser is the '
  'only handle on them.';

-- The follow-up list is read per source, so staff can work one queue at a time.
CREATE INDEX IF NOT EXISTS contractor_drafts_source_idx
  ON public.contractor_application_drafts (source, updated_at DESC)
  WHERE submitted_application_id IS NULL;

-- One live partner draft per contractor. Without this, starting the form on a phone and
-- again on a laptop leaves two rows and the follow-up list counts one person twice.
CREATE UNIQUE INDEX IF NOT EXISTS contractor_drafts_one_per_partner
  ON public.contractor_application_drafts (user_id)
  WHERE source = 'in_app' AND submitted_application_id IS NULL;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Existing rows are all public and keep working:
--     SELECT source, count(*) FROM public.contractor_application_drafts GROUP BY source;
--   An in-app draft must name its author:
--     INSERT INTO public.contractor_application_drafts (id, source)
--     VALUES (gen_random_uuid(), 'in_app');          → 23514
