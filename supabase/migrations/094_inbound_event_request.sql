-- =========================================================
-- 094  Inbound events keep the sanitised request around the payload
--
-- Phase 6.2, Option 2 (docs/groundwork-admin/06-unified-inbox.md §16.7). Depends on 050
-- (ghl_inbound_events). Independent of 093.
--
-- WHY. The first real inbound event (18 Sep 2026) came from GoHighLevel's workflow Webhook
-- action, whose body carries the contact and the message text but no message id and no
-- conversation id — and the action's merge-field picker offers none (§16.6). The one
-- place not yet looked at is the HTTP request itself: headers and query. The handler has
-- only ever stored `payload = body`. This column is where the request goes, so the
-- question "does GHL put an identifier anywhere else?" is answered from evidence, once,
-- rather than guessed.
--
-- WHAT. One nullable JSONB column. The handler writes `{ method, query, headers }` where
-- `headers` is identity-focused and sanitised BEFORE the row is built: never the shared
-- secret, authorization or cookie; nothing whose name contains secret/token/key; none of
-- the client-IP headers the edge adds (x-forwarded-for, x-real-ip, forwarded,
-- cf-connecting-ip, true-client-ip); not user-agent or content-type, which say nothing
-- about identity. Values are cut at 512 characters and the object at 8 KB.
--
-- WHAT IT DOES NOT DO. Nothing acts on it. Capture stays capture: the write is in the
-- same insert as `payload`, before the GHL_INBOUND_ACT gate, and no conversation or
-- message is touched. Rows written before this migration simply have NULL here.
-- =========================================================

ALTER TABLE public.ghl_inbound_events
  ADD COLUMN IF NOT EXISTS request JSONB;

COMMENT ON COLUMN public.ghl_inbound_events.request IS
  'Sanitised HTTP request around the payload: { method, query, headers }. Headers are '
  'identity-focused only — never the shared secret, authorization, cookie, anything named '
  '*secret*/*token*/*key*, client-IP headers, user-agent or content-type. NULL for rows '
  'recorded before 094. Evidence for the inbound identity decision (06 §16); never acted on.';
