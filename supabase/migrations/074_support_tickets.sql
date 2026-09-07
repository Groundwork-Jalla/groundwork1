-- =========================================================
-- 074  support_tickets
--
-- WHAT WAS WRONG
--
-- Two screens have been writing to `public.support_tickets` since launch. The table has
-- never existed. No migration creates it, and both writers catch the resulting
-- "relation does not exist" and tell the user it worked:
--
--   · routes/help.tsx        — the contact form. Showed "Message sent." every time.
--   · routes/profile.tsx     — the Close-account flow. Showed "Account deletion request
--                              submitted. Our team will process it within 48 hours."
--
-- So every support message since launch was discarded, and every person who asked us to
-- delete their account was told we were on it. The second one is the worse of the two:
-- it is a data-rights request that was answered with a sentence and a dropped write.
--
-- This migration creates the table. The swallowing `catch` blocks go with it, in the same
-- change — a table that exists behind code that hides its own failures would still be
-- silent the next time something breaks.
--
-- ONE COLUMN NAME, NOT TWO
--
-- The two writers disagreed: help.tsx sent `message`, profile.tsx sent `body`. Rather
-- than carry both as nullable columns and let each screen pick, the column is `message`
-- and profile.tsx is changed to match. A table shaped around a disagreement keeps the
-- disagreement alive.
--
-- `kind` separates them instead, because they are genuinely different work: a support
-- question gets answered, a deletion request has a legal clock on it.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, not CASCADE. An account-deletion ticket has to outlive the account it asked
  -- us to delete — deleting the user must not also delete the evidence that they asked,
  -- when they asked, and whether we did it.
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  kind        TEXT NOT NULL DEFAULT 'support'
                CHECK (kind IN ('support', 'account_deletion')),
  name        TEXT,
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,

  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  admin_notes TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The queue is read newest-first and filtered by status; deletion requests are pulled out
-- on their own because of the clock on them.
CREATE INDEX IF NOT EXISTS support_tickets_created_idx ON public.support_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx  ON public.support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_kind_idx    ON public.support_tickets (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx    ON public.support_tickets (user_id);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
--
-- Insert must be ATTRIBUTED: `user_id = auth.uid()` and nothing else. Without it any
-- signed-in user could file a ticket — an account-deletion ticket, say — in someone
-- else's name. Both screens run behind the authenticated layout, so there is no
-- anonymous path to support here.
CREATE POLICY "insert_own" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "select_own" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin_select_all" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admins move status and add notes. Nobody edits the reporter's own words: `message`,
-- `subject`, `email` and `kind` are the record of what was said.
CREATE POLICY "admin_update" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Deliberately NO delete policy. Tickets are closed, not removed.

-- ── updated_at ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_support_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  -- The reporter's own words are immutable. An admin who needs to correct something puts
  -- it in admin_notes; the ticket says what was actually sent to us.
  NEW.subject := OLD.subject;
  NEW.message := OLD.message;
  NEW.email   := OLD.email;
  NEW.kind    := OLD.kind;
  NEW.created_at := OLD.created_at;

  -- user_id is pinned ONLY against reassignment. It must still be allowed to go NULL,
  -- because that is how `ON DELETE SET NULL` is implemented: deleting the user issues an
  -- UPDATE on this row, which fires this trigger. A blanket `NEW.user_id := OLD.user_id`
  -- puts the id straight back, the referential action silently does nothing, and the
  -- ticket is left pointing at a user that no longer exists. Found by deleting a user on
  -- a real cluster; it does not raise, it just quietly orphans the row.
  IF NEW.user_id IS NOT NULL THEN
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_support_ticket ON public.support_tickets;
CREATE TRIGGER trg_touch_support_ticket
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_support_ticket();

-- ── Notification on insert ───────────────────────────────
--
-- Two channels, both best-effort, and neither may block the insert. The ROW is the
-- durable record; the email and the bell are how somebody finds out about it today. That
-- ordering is the whole point of this migration — the old code had it exactly backwards,
-- with no record and a reassuring message.
--
-- Follows 059: Resend is called from the database, credentials out of app_config (RLS on,
-- no policies, so only SECURITY DEFINER functions can read it).
CREATE OR REPLACE FUNCTION public.notify_support_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  resend_key TEXT;
  inbox      TEXT;
  is_del     BOOLEAN := NEW.kind = 'account_deletion';
  heading    TEXT;
  body_html  TEXT;
BEGIN
  heading := CASE WHEN is_del THEN 'Account deletion request' ELSE 'New support message' END;

  -- ── The bell, for every admin ──
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT ur.user_id,
           CASE WHEN is_del THEN 'account_deletion_request' ELSE 'support_ticket' END,
           heading,
           left(NEW.subject, 140),
           jsonb_build_object('ticket_id', NEW.id, 'kind', NEW.kind, 'email', NEW.email)
    FROM   public.user_roles ur
    WHERE  ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'support ticket % : admin notification failed: %', NEW.id, SQLERRM;
  END;

  -- ── The email ──
  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  SELECT value INTO inbox      FROM public.app_config WHERE key = 'notify_email';

  IF resend_key IS NOT NULL AND resend_key <> '' AND inbox IS NOT NULL AND inbox <> '' THEN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:' || CASE WHEN is_del THEN '#7f1d1d' ELSE '#0a0a0a' END || ';padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">' || heading || '</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.55);">'
      || public.html_escape(COALESCE(NEW.name, '')) || CASE WHEN NEW.name IS NULL OR NEW.name = '' THEN '' ELSE ' — ' END
      || public.html_escape(NEW.email) || '</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#0a0a0a;">' || public.html_escape(NEW.subject) || '</p>'
      || '<p style="margin:0;font-size:13px;line-height:1.7;color:#0a0a0a;white-space:pre-wrap;">' || public.html_escape(NEW.message) || '</p>'
      || CASE WHEN is_del THEN
           '<p style="margin:20px 0 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;line-height:1.6;color:#7f1d1d;">'
           || 'This is a data-rights request. The person was told we would process it within 48 hours.</p>'
         ELSE '' END
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/support" '
      || 'style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a></p>'
      || '<p style="margin:16px 0 0;font-size:11px;color:#8a8a87;">Reply straight to '
      || public.html_escape(NEW.email) || '.</p>'
      || '</td></tr></table></body></html>';

    BEGIN
      PERFORM net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || resend_key),
        body    := jsonb_build_object(
                     'from',     'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',       jsonb_build_array(inbox),
                     -- So a human can answer without opening the panel.
                     'reply_to', NEW.email,
                     'subject',  CASE WHEN is_del THEN '[deletion] ' ELSE '[support] ' END
                                 || left(NEW.subject, 90),
                     'html',     body_html),
        timeout_milliseconds := 5000);
    EXCEPTION WHEN OTHERS THEN
      -- Never let a notification failure block somebody asking for help.
      RAISE WARNING 'support ticket % : email failed: %', NEW.id, SQLERRM;
    END;
  ELSE
    RAISE WARNING 'support ticket % : no resend_api_key/notify_email in app_config', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_support_ticket()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_support_ticket()   FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_support_ticket ON public.support_tickets;
CREATE TRIGGER trg_notify_support_ticket
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_ticket();

GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
