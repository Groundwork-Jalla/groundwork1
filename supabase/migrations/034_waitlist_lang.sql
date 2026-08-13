-- =========================================================
-- 034_waitlist_lang.sql
--
-- Record the language a waitlist signup was made in, and stop the table collecting
-- case-variant duplicates of the same person.
--
-- Groundwork is bilingual and the contractor application already stores `lang` (026)
-- so follow-up is written in the language the person actually used. The waitlist never
-- captured it, so every launch announcement to a French signup would have gone out in
-- English.
--
-- The email problem: /community inserted the raw input, so `Foo@Bar.com` and
-- `foo@bar.com` are two rows that both pass the UNIQUE constraint. That means a
-- duplicate signup silently becomes a second lead in GoHighLevel, and the same person
-- gets everything twice. The client now normalises, and the CHECK below makes it
-- impossible to reintroduce from anywhere else.
--
-- Run in: Supabase Dashboard > SQL Editor (after 031)
-- =========================================================

ALTER TABLE public.waitlist_emails
  ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'en';

DO $$
BEGIN
  ALTER TABLE public.waitlist_emails
    ADD CONSTRAINT waitlist_emails_lang_check CHECK (lang IN ('en', 'fr'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'lang check constraint already present.';
END $$;

COMMENT ON COLUMN public.waitlist_emails.lang IS
  'Language the signup form was in. Drives which language the launch announcement uses.';

-- Fold any existing case variants together before enforcing lower case. Keeps the
-- earliest row per address, because that is the one whose created_at is true and whose
-- synced_to_ghl flag reflects a real forward.
WITH ranked AS (
  SELECT id, lower(email) AS norm,
         row_number() OVER (PARTITION BY lower(email) ORDER BY created_at) AS rn
  FROM public.waitlist_emails
)
DELETE FROM public.waitlist_emails w
USING ranked r
WHERE w.id = r.id AND r.rn > 1;

UPDATE public.waitlist_emails
   SET email = lower(trim(email))
 WHERE email <> lower(trim(email));

DO $$
BEGIN
  ALTER TABLE public.waitlist_emails
    ADD CONSTRAINT waitlist_emails_email_normalised
    CHECK (email = lower(trim(email)));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'email normalisation constraint already present.';
END $$;

DO $$
DECLARE v_total int; v_fr int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE lang = 'fr') INTO v_total, v_fr
  FROM public.waitlist_emails;
  RAISE NOTICE 'waitlist_emails: % row(s), % French. Existing rows default to en.', v_total, v_fr;
END $$;
