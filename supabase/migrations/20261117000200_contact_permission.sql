-- Whether the Groundwork team may call or text a person.
--
-- Rule 9 of the User Activation Communication Flow: "After Day 7, only qualified or
-- engaged users enter phone or text follow-up, and only where contact permissions allow
-- it." On 16 November the team found there was nowhere that permission was asked for,
-- so the rule had nothing to check. Email reminders already have their own unsubscribe,
-- and automated WhatsApp messages their own opt-in; this is the permission for a person
-- on the team to pick up the phone.
--
-- ── How it is asked ──────────────────────────────────────────────────────────────────
-- · New accounts: an optional, unticked checkbox on the signup forms. The answer rides
--   in the signup metadata and is recorded on first sign-in (source `signup`).
-- · Existing accounts, and anyone who signed up some other way (Google, an invitation
--   accepted by a provisioned account): a one-time question after signing in
--   (source `sign_in`).
-- · Anyone, any time: their profile (source `profile`).
--
-- NULL means never asked, which is NOT the same as no. Staff treat both as "do not call".
--
-- The answer is the person's own and only they record it. There is no administrator
-- override, by design. Changes no existing row: every account starts unanswered.
BEGIN;

ALTER TABLE public.profiles
 ADD COLUMN IF NOT EXISTS contact_permission boolean,
 ADD COLUMN IF NOT EXISTS contact_permission_at timestamptz,
 ADD COLUMN IF NOT EXISTS contact_permission_source text;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='profiles_contact_permission_recorded') THEN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_contact_permission_recorded CHECK(
   (contact_permission IS NULL AND contact_permission_at IS NULL AND contact_permission_source IS NULL)
   OR (contact_permission IS NOT NULL AND contact_permission_at IS NOT NULL
       AND contact_permission_source IN('signup','sign_in','profile')));
 END IF;
END $$;

-- `profiles` lets a person update their own row, so without this a browser could write
-- the answer with any date and any source. The answer itself is theirs to give; the
-- record of when and where they gave it is not theirs to edit.
CREATE OR REPLACE FUNCTION public.guard_contact_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF ROW(NEW.contact_permission,NEW.contact_permission_at,NEW.contact_permission_source)
    IS DISTINCT FROM ROW(OLD.contact_permission,OLD.contact_permission_at,OLD.contact_permission_source)
    AND current_setting('app.contact_permission_write',true) IS DISTINCT FROM 'on' THEN
  RAISE EXCEPTION 'contact_permission_via_rpc: use set_contact_permission';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_contact_permission() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS profiles_contact_permission_guard ON public.profiles;
CREATE TRIGGER profiles_contact_permission_guard BEFORE UPDATE ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_contact_permission();

CREATE OR REPLACE FUNCTION public.set_contact_permission(p_allowed boolean,p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid();p public.profiles%ROWTYPE;BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 IF p_allowed IS NULL OR p_source IS NULL OR p_source NOT IN('signup','sign_in','profile') THEN RAISE EXCEPTION 'invalid_contact_permission'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=v_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
 -- The signup answer is replayed from metadata on every new browser. Once anything has
 -- been recorded it must never overwrite a choice made since.
 IF p.contact_permission IS NULL OR (p_source<>'signup' AND p.contact_permission IS DISTINCT FROM p_allowed) THEN
  PERFORM set_config('app.contact_permission_write','on',true);
  UPDATE public.profiles SET contact_permission=p_allowed,contact_permission_at=clock_timestamp(),contact_permission_source=p_source
   WHERE id=v_user RETURNING * INTO p;
  PERFORM set_config('app.contact_permission_write','off',true);
  PERFORM public.log_activity(NULL,'account.contact_permission_changed','profile',v_user,v_user,
   jsonb_build_object('allowed',p_allowed,'source',p_source));
 END IF;
 RETURN jsonb_build_object('contact_permission',p.contact_permission,'contact_permission_at',p.contact_permission_at,'contact_permission_source',p.contact_permission_source);
END $$;
REVOKE ALL ON FUNCTION public.set_contact_permission(boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_contact_permission(boolean,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
