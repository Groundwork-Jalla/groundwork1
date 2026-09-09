-- =========================================================
-- 079  Certificates: stop anyone forging one, and revoke the Self Verify ones
--
-- WHAT WAS WRONG
--
-- `014_certificates.sql` shipped this, and nothing has changed it since:
--
--   CREATE POLICY "authenticated_insert_certificates"
--     ON public.certificates FOR INSERT TO authenticated WITH CHECK (true);
--
-- `WITH CHECK (true)`. Any signed-in user could insert a certificate row for ANY project
-- and any stage, then hand out the `/verify/:id` link — which is public, by design, and
-- is the entire trust surface of the product. A verification anybody can mint is not a
-- verification.
--
-- There is also no UPDATE and no DELETE policy at all, so nothing could be withdrawn once
-- issued. Philip's answer of 4 Sep 2026 was "Revoke", and until now there was no
-- mechanism to do it with.
--
-- ── REVOKE, DO NOT DELETE ────────────────────────────────────────────────────────────
--
-- A revoked certificate keeps its row and its public read. `/verify/:id` then answers
-- "this certificate was revoked" instead of 404 — which matters, because a link that
-- simply breaks reads as our bug, while a link that says revoked is an answer. The row
-- is also the record that it was ever issued.
--
-- The PDF is a different matter: the bucket is public-read, so a revoked row with a live
-- file is still a certificate anyone can download. Those come out.
-- =========================================================

ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS revoked_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

CREATE INDEX IF NOT EXISTS certificates_revoked_idx
  ON public.certificates (revoked_at) WHERE revoked_at IS NOT NULL;

-- ── Only an admin may issue one ──────────────────────────
--
-- The legitimate path is `adminApproveStage` (src/lib/supabase/approvals.ts), which runs
-- in an admin's own session, so `is_admin()` holds there and nowhere else.
DROP POLICY IF EXISTS "authenticated_insert_certificates" ON public.certificates;

CREATE POLICY "admin_insert_certificates"
  ON public.certificates FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ── Only an admin may revoke one ─────────────────────────
CREATE POLICY "admin_update_certificates"
  ON public.certificates FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Deliberately no DELETE policy. See the header: a certificate that disappears cannot be
-- shown to have been revoked.

-- ── The certificates already issued on Self Verify ───────
--
-- Philip, 4 Sep 2026: "Revoke." His call, made knowingly — it is the cleanest incentive
-- and the worst experience, and he chose it with both stated.
--
-- Scoped by the PROJECT's tier at the time this runs. A project that later upgrades does
-- not un-revoke its old certificates: they were issued for work nobody from Jalla saw.
UPDATE public.certificates c
   SET revoked_at     = now(),
       revoked_reason = 'self_verify_not_eligible'
  FROM public.projects p
 WHERE p.id = c.project_id
   AND p.tier = 'self_verify'
   AND c.revoked_at IS NULL;

-- ── And pull their PDFs out of the public bucket ─────────
--
-- NOT from here. Supabase guards `storage.objects` with a `protect_delete()` trigger:
--
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--                Use the Storage API instead.
--
-- It is right to. Deleting the row would leave the underlying object orphaned in the
-- bucket rather than removed, so the SQL that looks like it deletes a file does not.
--
-- The purge therefore runs through the Storage API instead, in
-- `api/_handlers/certificate-purge.ts`, which is admin-only and idempotent. This column
-- is what makes it idempotent, and what says a revoked certificate is fully withdrawn
-- rather than merely marked.
ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS pdf_purged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.certificates.pdf_purged_at IS
  'When the PDF was removed from the public certificates bucket. Null on a revoked row '
  'means the file is still downloadable by anyone holding the URL — run the purge. '
  'Storage cannot be touched from SQL; see api/_handlers/certificate-purge.ts.';

-- The URL on the row is left in place on purpose. Once purged it is dead, and it is the
-- record of where the file was — useful if a revocation is ever disputed.
