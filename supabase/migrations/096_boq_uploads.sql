-- =========================================================
-- 096 · Bills of quantities, including spreadsheets
--
-- The wizard lets a client attach the costing they already have — a contractor's quote
-- or a bill of quantities. Two things stopped that being true for the commonest format
-- of all:
--
--   1. A BoQ was filed as `category = 'contract'`, because the CHECK in 017 has no value
--      for it. It is not a contract; it is the number the whole project is priced on,
--      and it needs to be findable as such in the Documents tab.
--   2. `text/csv` and OpenDocument spreadsheets are not in the `documents` bucket's
--      allowed_mime_types (011), so Storage refuses them. Excel's own two types are
--      already allowed — only the browser's `accept` attribute was hiding them.
--
-- Nothing is reclassified. Existing rows keep whatever category they were given; this
-- only makes the right one available from now on.
-- =========================================================

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_category_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_category_check
  CHECK (category IN ('contract','permit','receipt','invoice','report','site_photo','boq','other'));

COMMENT ON COLUMN public.project_documents.category IS
  'What the file is. ''boq'' is a bill of quantities or costing the client supplied — '
  'see src/lib/documents/accepted-files.ts for the formats Storage will take.';

-- ── The bucket takes spreadsheets in every ordinary flavour ─────────────────────────
--
-- Kept in step with src/lib/documents/accepted-files.ts. A type missing here is not a
-- validation message — it is an upload that fails after the person thought it worked.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.oasis.opendocument.spreadsheet',
         'text/csv',
         'image/jpeg', 'image/png', 'image/gif', 'image/webp'
       ]
 WHERE id = 'documents';
