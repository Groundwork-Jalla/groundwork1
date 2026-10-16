-- =========================================================
-- 124  Files and voice notes in a conversation
--
-- WHY
--
-- `project_messages.attachments` has existed since 091 and `send_message` has taken a
-- `p_attachments` argument since then. Nothing has ever written to either: there was no
-- bucket to put a file in and no way to pick one. Reported from testing — "client or
-- contractor cannot add image, cannot upload a document" — which is exactly right.
--
-- A build is discussed in photographs. A client asking "is this crack normal?" sends a
-- picture, and a contractor answering sends three more. Making them describe it in
-- words is making them use WhatsApp instead, which is the thing this thread exists to
-- replace.
--
-- ── Why a bucket of its own ─────────────────────────────────────────────────────────
-- Not `documents`: that is the project's filing cabinet, and what somebody attaches to
-- a sentence is not a project document. A photo sent to ask a question would turn up in
-- the Documents tab beside the bill of quantities and the permit, and nobody would know
-- why it was there. Different lifetime, different audience, different bucket.
--
-- ── Who may read one ────────────────────────────────────────────────────────────────
-- Exactly whoever may read the message it hangs off: the thread's own person, any
-- active project participant, or staff. The file lives at
-- `conversations/<conversation id>/<name>`, so the policy reads the conversation out of
-- the path and asks the same question the message policy asks.
--
-- Run in: Supabase Dashboard > SQL Editor (after 123)
-- =========================================================

BEGIN;

-- ── May I use this conversation at all? ──────────────────
--
-- The same rule `send_message` applies, named once so a storage policy and a message
-- policy cannot drift into disagreeing about who is on a thread — which would show
-- somebody a message whose photograph they cannot open, or the reverse.
CREATE OR REPLACE FUNCTION public.can_use_conversation(p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation
       AND (
         public.is_admin()
         OR c.person_id = auth.uid()
         OR (c.project_id IS NOT NULL AND public.project_messaging_member(c.project_id))
       )
  );
$$;

REVOKE ALL ON FUNCTION public.can_use_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_conversation(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_use_conversation(uuid) IS
  'Who may read or write on a thread (124): staff, the thread''s person, or an active '
  'participant of its project. The same rule send_message enforces — a storage policy '
  'that answered differently would show a message whose attachment cannot be opened.';


-- ── The bucket ───────────────────────────────────────────
--
-- Private. Wrapped because on a hosted project `storage.buckets` belongs to
-- `supabase_storage_admin`, and a migration run as `postgres` may not be allowed to
-- touch it. If this is skipped, create the bucket by hand; the notice says so rather
-- than failing the whole migration.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'chat-attachments', 'chat-attachments', false,
    26214400,  -- 25 MB. A minute of voice is ~1 MB; a phone photo is 2–6 MB.
    ARRAY[
      -- What a build is actually discussed in.
      'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
      -- Paperwork.
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.spreadsheet',
      'text/csv','text/plain',
      -- Voice notes. MediaRecorder gives webm on Chrome and mp4 on Safari, and which
      -- one you get is the browser's choice, not ours — so both are allowed or the
      -- feature works on one phone and not the other.
      'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav'
    ]
  )
  ON CONFLICT (id) DO UPDATE
    SET public             = false,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED bucket chat-attachments (%) — create it by hand: Storage > New bucket, Public OFF, 25 MB', SQLERRM;
END $$;


-- ── Who may put a file there, and read it back ───────────
--
-- The path is `conversations/<conversation id>/<file>`, so the conversation is the
-- second segment. A name that is not in that shape matches nothing and is refused,
-- which is the right answer for a path we did not write.
DO $$
BEGIN
  DROP POLICY IF EXISTS chat_attachment_write ON storage.objects;
  CREATE POLICY chat_attachment_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'chat-attachments'
      AND (storage.foldername(name))[1] = 'conversations'
      AND public.can_use_conversation(((storage.foldername(name))[2])::uuid)
    );

  DROP POLICY IF EXISTS chat_attachment_read ON storage.objects;
  CREATE POLICY chat_attachment_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'chat-attachments'
      AND (storage.foldername(name))[1] = 'conversations'
      AND public.can_use_conversation(((storage.foldername(name))[2])::uuid)
    );
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED chat-attachments policies (%) — add them in Storage > Policies', SQLERRM;
END $$;


-- ── What an attachment looks like ────────────────────────
--
-- 091 only required `attachments` to be an array. That was enough while nothing wrote
-- to it; now that two clients and a provider webhook all will, the shape is worth
-- stating — a renderer that meets `{url: ...}` from one writer and `{path: ...}` from
-- another shows a broken thumbnail and no error.
--
-- Deliberately permissive about EXTRA keys: GHL's inbound mirror carries its own, and
-- rejecting them would drop a client's photograph rather than store a field we ignore.
-- Through a function, because a CHECK constraint may not contain a subquery and
-- walking a jsonb array needs one. IMMUTABLE, which a CHECK requires: the answer
-- depends on nothing but the value passed in.
CREATE OR REPLACE FUNCTION public.attachments_well_formed(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE a jsonb;
BEGIN
  IF p IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p) <> 'array' THEN RETURN false; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(p) LOOP
    IF jsonb_typeof(a) <> 'object' THEN RETURN false; END IF;
    IF a->>'path' IS NULL OR btrim(a->>'path') = '' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $fn$;

ALTER TABLE public.project_messages
  DROP CONSTRAINT IF EXISTS project_messages_attachment_shape;
ALTER TABLE public.project_messages
  ADD CONSTRAINT project_messages_attachment_shape
  CHECK (public.attachments_well_formed(attachments));

COMMENT ON COLUMN public.project_messages.attachments IS
  'Array of {path, name, type, size, kind} — `path` is the object in the '
  'chat-attachments bucket, never a public URL (124). `kind` is "voice" for a '
  'recording and "file" otherwise, so a player is shown instead of a download link. '
  'Extra keys are tolerated: the inbound mirror carries its own.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'chat-attachments';
--     → one row, public = false.
--   SELECT polname FROM pg_policy WHERE polname LIKE 'chat_attachment%';
--     → chat_attachment_write, chat_attachment_read.
