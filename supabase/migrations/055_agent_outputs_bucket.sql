-- =========================================================
-- 055  agent-outputs — where finished agent work is stored
--
-- The queue runner (scripts/agent-queue.mjs) uploads a produced video here and writes
-- the resulting URL back to agent_requests.output_url, so the person who asked can
-- watch it on /admin/requests without anything being emailed around.
--
-- PUBLIC, and that is a decision rather than an oversight.
--
-- Almost everything produced here exists to be sent to someone outside the company: an
-- investor demo, a clip for WhatsApp, an explainer for a client deciding whether to
-- trust us with a build. A private bucket would mean signed URLs, which expire — so the
-- link Philip forwards to an investor on Monday is broken by Thursday. That is a worse
-- failure than the alternative, and it fails silently on the recipient's side where
-- nobody can see it.
--
-- What protects a file that is not meant to be forwarded yet is the PATH: uploads are
-- keyed on the request's UUID, which is not enumerable and not listable — the SELECT
-- policy below grants object listing to admins only, so the bucket cannot be browsed.
-- Same reasoning as the contractor document paths in 026, minus the read restriction.
--
-- THE LIMIT THIS PLACES ON USE: do not put anything confidential here. If an internal
-- video ever needs to be genuinely private, it needs its own bucket with signed URLs,
-- not a policy tweak to this one.
-- =========================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agent-outputs', 'agent-outputs', true,
  524288000,  -- 500 MB. A 3-minute 1080p walkthrough is ~5 MB; the headroom is for
              -- longer cuts and for stills bundled as a zip.
  ARRAY['video/mp4','video/webm','image/png','image/jpeg','image/webp',
        'application/pdf','application/zip']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 524288000,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "agent_outputs_write"  ON storage.objects;
DROP POLICY IF EXISTS "agent_outputs_list"   ON storage.objects;
DROP POLICY IF EXISTS "agent_outputs_delete" ON storage.objects;

-- Only admins upload. The runner authenticates as an admin rather than carrying a
-- service-role key, so there is no new secret to leak and RLS still applies to it.
CREATE POLICY "agent_outputs_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'agent-outputs' AND public.is_admin());

-- Reading a file by its exact path is public (that is what `public = true` does). This
-- policy governs LISTING, which stays admin-only so the bucket is not enumerable.
CREATE POLICY "agent_outputs_list"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'agent-outputs' AND public.is_admin());

CREATE POLICY "agent_outputs_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'agent-outputs' AND public.is_admin());
