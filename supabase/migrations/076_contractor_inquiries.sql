-- =========================================================
-- 076  contractor_inquiries — the in-platform way to reach a contractor
--
-- WHY
--
-- Product rule, 9 Sep 2026: every form of contact happens inside Groundwork. 075 takes
-- contractor phone numbers and emails away from the browser for good; this is what
-- replaces them.
--
-- WHAT WAS THERE BEFORE
--
-- A "Request Quote" dialog whose submit handler was, in full:
--
--   onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
--
-- No insert, no email, no RPC anywhere in the component. It showed the subscriber a
-- confirmation screen and sent nothing — the same defect as the support form in 074, on
-- the one screen a paying customer uses to find a builder. Every quote request since the
-- directory shipped is gone.
--
-- HOW AN INTRODUCTION WORKS NOW
--
-- The homeowner files an inquiry. The team is notified — bell and email — and brokers
-- the introduction. The contractor's details never cross to the homeowner, and the
-- homeowner's details never cross to the contractor without somebody deciding to.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.contractor_inquiries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  contractor_id UUID NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: an inquiry is a record of an introduction we were asked to
  -- make. Closing the account does not unmake the asking.
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- As typed in the dialog. Deliberately not read off the profile: the person may be
  -- asking on behalf of a family member, and the name they give is the one to use.
  name          TEXT NOT NULL,
  location      TEXT NOT NULL,
  build_type    TEXT NOT NULL
                  CHECK (build_type IN ('residential','commercial','industrial','mixed-use')),
  message       TEXT NOT NULL,

  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','introduced','declined','closed')),
  admin_notes   TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- There is deliberately NO contact-preference column. The dialog used to ask "WhatsApp,
-- email or phone call?", which only makes sense if the answer leads off the platform.

CREATE INDEX IF NOT EXISTS contractor_inquiries_created_idx    ON public.contractor_inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS contractor_inquiries_status_idx     ON public.contractor_inquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS contractor_inquiries_contractor_idx ON public.contractor_inquiries (contractor_id);
CREATE INDEX IF NOT EXISTS contractor_inquiries_user_idx       ON public.contractor_inquiries (user_id);

ALTER TABLE public.contractor_inquiries ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
--
-- Attributed AND entitled, both checked here rather than in React. The directory sits
-- behind Jalla Verify; without the second clause a Self Verify account could file
-- inquiries against every contractor in the book straight from the API, which is the
-- same class of hole 075 just closed on the phone numbers.
CREATE POLICY "insert_own_entitled" ON public.contractor_inquiries
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.contractor_directory_entitled()
    -- Only a live directory entry. A suspended contractor is not taking work.
    AND EXISTS (SELECT 1 FROM public.contractors c WHERE c.id = contractor_id AND c.active)
  );

CREATE POLICY "select_own" ON public.contractor_inquiries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin_select_all" ON public.contractor_inquiries
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_update" ON public.contractor_inquiries
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- No delete policy. Introductions are closed, not erased.

-- ── What the sender wrote is theirs ──────────────────────
CREATE OR REPLACE FUNCTION public.touch_contractor_inquiry()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at    := now();
  NEW.name          := OLD.name;
  NEW.location      := OLD.location;
  NEW.build_type    := OLD.build_type;
  NEW.message       := OLD.message;
  NEW.contractor_id := OLD.contractor_id;
  NEW.created_at    := OLD.created_at;

  -- Pinned against reassignment only. It must still be allowed to go NULL, because that
  -- is how `ON DELETE SET NULL` is implemented — deleting the user issues an UPDATE on
  -- this row, and a blanket restore would put the id back and silently orphan it.
  IF NEW.user_id IS NOT NULL THEN
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_contractor_inquiry ON public.contractor_inquiries;
CREATE TRIGGER trg_touch_contractor_inquiry
  BEFORE UPDATE ON public.contractor_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.touch_contractor_inquiry();

-- ── Tell the team ────────────────────────────────────────
--
-- Best-effort, and it may not block the insert. The row is the record; the email is how
-- somebody finds out today. Same ordering as 074, and the same reason.
CREATE OR REPLACE FUNCTION public.notify_contractor_inquiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  resend_key  TEXT;
  inbox       TEXT;
  who         TEXT;
  body_html   TEXT;
BEGIN
  SELECT c.name INTO who FROM public.contractors c WHERE c.id = NEW.contractor_id;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT ur.user_id, 'contractor_inquiry',
           'Quote request for ' || COALESCE(who, 'a contractor'),
           left(NEW.name || ' · ' || NEW.location, 140),
           jsonb_build_object('inquiry_id', NEW.id, 'contractor_id', NEW.contractor_id)
    FROM   public.user_roles ur WHERE ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'inquiry % : admin notification failed: %', NEW.id, SQLERRM;
  END;

  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  SELECT value INTO inbox      FROM public.app_config WHERE key = 'notify_email';

  IF resend_key IS NOT NULL AND resend_key <> '' AND inbox IS NOT NULL AND inbox <> '' THEN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Quote request</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.55);">for '
      || public.html_escape(COALESCE(who, 'a contractor')) || '</p></td></tr>'
      || '<tr><td style="padding:24px 28px;">'
      || '<table cellpadding="0" cellspacing="0">'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">From</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.name) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Where</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.location) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Build</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.build_type) || '</td></tr>'
      || '</table>'
      || '<p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:#0a0a0a;white-space:pre-wrap;">'
      || public.html_escape(NEW.message) || '</p>'
      || '<p style="margin:20px 0 0;padding:12px 14px;background:#f8f8f8;border:1px solid #e5e5e5;border-radius:8px;font-size:12px;line-height:1.6;color:#4a4a48;">'
      || 'Groundwork brokers this introduction. Neither side has the other''s contact details.</p>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/inquiries" '
      || 'style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a></p>'
      || '</td></tr></table></body></html>';

    BEGIN
      PERFORM net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type','application/json',
                                      'Authorization','Bearer ' || resend_key),
        body    := jsonb_build_object(
                     'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',      jsonb_build_array(inbox),
                     'subject', '[quote] ' || COALESCE(who, 'contractor') || ' — ' || left(NEW.name, 60),
                     'html',    body_html),
        timeout_milliseconds := 5000);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'inquiry % : email failed: %', NEW.id, SQLERRM;
    END;
  ELSE
    RAISE WARNING 'inquiry % : no resend_api_key/notify_email in app_config', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_contractor_inquiry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_contractor_inquiry()  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_contractor_inquiry ON public.contractor_inquiries;
CREATE TRIGGER trg_notify_contractor_inquiry
  AFTER INSERT ON public.contractor_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.notify_contractor_inquiry();

GRANT SELECT, INSERT, UPDATE ON public.contractor_inquiries TO authenticated;
