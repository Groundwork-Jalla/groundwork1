-- =========================================================
-- 051_contractor_docs_office_types.sql
--
-- Let contractors attach Word documents.
--
-- The bucket's allowed_mime_types has been PDF and images since 026. A contractor
-- attaching a .docx — a CV, a company profile, a scanned registration someone typed up —
-- had it rejected by storage. The form's `accept` filter hid this most of the time by
-- greying the file out in the picker, which means the failure usually looked like "the
-- site won't let me attach my CV" rather than an error anyone reported.
--
-- Note 028 deliberately does NOT reset allowed_mime_types in its ON CONFLICT clause, so
-- this has to be set explicitly rather than relying on a re-run of that migration.
--
-- Legacy .doc is included: people in this corridor still send them, and refusing a
-- document because of its age is not a policy anyone chose.
-- =========================================================

DO $$
BEGIN
  UPDATE storage.buckets
     SET allowed_mime_types = ARRAY[
           'application/pdf',
           'image/jpeg','image/png','image/webp','image/heic',
           -- .docx and .doc
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/msword'
         ]
   WHERE id = 'contractor-docs';

  IF NOT FOUND THEN
    RAISE NOTICE 'bucket contractor-docs not found — create it in Storage > New bucket first';
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED (%) — set the allowed file types on contractor-docs in the Storage UI', SQLERRM;
END $$;
