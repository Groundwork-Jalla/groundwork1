-- =========================================================
-- 081  "Other" must say what other
--
-- `contractor_applications.role` is an enum-ish key, and `other` means the real trade is
-- in `role_other` beside it. Nothing enforced that, so an application could be stored
-- with `role = 'other'` and `role_other = NULL`.
--
-- That is not only untidy. `role` is synced to GoHighLevel and merged into WhatsApp
-- templates, so an unanswered "other" reached a real contractor as the literal word:
--
--   Trade applied for: other
--
-- The payload builder now falls back to the typed trade, and to the word "Other" when
-- there is nothing to fall back to — an empty merge field fails the send outright, since
-- GHL has no default for a template variable. This constraint is the half of the fix the
-- browser cannot skip: the form inserts into this table directly, so client-side
-- validation is a courtesy and a CHECK is the boundary.
--
-- NOT VALID, deliberately: it binds every future write immediately without failing the
-- migration on rows already stored. Existing rows are listed below to be fixed by hand —
-- somebody has to read what they wrote and decide, and inventing a trade for them would
-- be worse than leaving it blank.
-- =========================================================

DO $$
DECLARE
  offenders INT;
BEGIN
  SELECT count(*) INTO offenders
    FROM public.contractor_applications
   WHERE role = 'other' AND (role_other IS NULL OR btrim(role_other) = '');

  IF offenders > 0 THEN
    RAISE NOTICE '% existing application(s) have role=other with no trade named. '
                 'They are left as they are; the constraint is NOT VALID so it binds new '
                 'writes only. Find them with: SELECT id, full_name, email FROM '
                 'public.contractor_applications WHERE role = ''other'' AND '
                 '(role_other IS NULL OR btrim(role_other) = '''');', offenders;
  END IF;
END $$;

ALTER TABLE public.contractor_applications
  DROP CONSTRAINT IF EXISTS contractor_applications_role_other_required;

ALTER TABLE public.contractor_applications
  ADD CONSTRAINT contractor_applications_role_other_required
  CHECK (role <> 'other' OR (role_other IS NOT NULL AND btrim(role_other) <> ''))
  NOT VALID;
