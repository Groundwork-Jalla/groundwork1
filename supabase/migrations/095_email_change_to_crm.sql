-- =========================================================
-- 095 · A changed sign-in email is queued for the CRM
--
-- The CRM keys people on email. When someone changes theirs (Settings → Account, then
-- the confirmation link), every later event would upsert a second contact under the new
-- address and strand the real one — history, tags, Conversations thread — under the old.
-- So the change itself is an event, recorded HERE, at the moment auth.users changes,
-- rather than by the browser that happened to open the link: a closed tab, a dead
-- network or a CRM outage must not be able to lose it.
--
-- The row goes into ghl_outbox like every other CRM event: `api/_handlers/crm-email-
-- sync.ts` delivers it straight away, and `/admin/crm` retries anything that failed.
-- The payload carries the OLD address so the contact can be found even when no id was
-- ever stored — server-side, never from the browser.
-- =========================================================

CREATE OR REPLACE FUNCTION public.queue_email_change_for_crm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact TEXT;
BEGIN
  -- A first-time address (NULL → x) is a signup, already announced as user_signup.
  IF OLD.email IS NULL OR NEW.email IS NULL OR NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;

  SELECT p.ghl_contact_id INTO v_contact FROM public.profiles p WHERE p.id = NEW.id;

  INSERT INTO public.ghl_outbox (event, email, payload, dedupe_key)
  VALUES (
    'email_changed',
    lower(NEW.email),
    jsonb_build_object(
      'user_id',    NEW.id,
      'old_email',  lower(OLD.email),
      'new_email',  lower(NEW.email),
      'contact_id', v_contact
    ),
    -- One row per (person, new address): confirming the same change twice is one fact.
    'email_changed:' || NEW.id || ':' || lower(NEW.email)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END $$;

-- Separate from on_auth_user_email_changed (025) on purpose: that trigger keeps the
-- profiles.email mirror correct and is not touched.
DROP TRIGGER IF EXISTS on_auth_user_email_changed_crm ON auth.users;
CREATE TRIGGER on_auth_user_email_changed_crm
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.queue_email_change_for_crm();
