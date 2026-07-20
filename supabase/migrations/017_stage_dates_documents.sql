-- Migration 017: Add planned dates + notes to stages; add category + stage_id to documents
-- Apply in Supabase SQL editor after migration 016.

-- Stage planning fields
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS planned_start DATE,
  ADD COLUMN IF NOT EXISTS planned_end   DATE,
  ADD COLUMN IF NOT EXISTS notes         TEXT;

-- Document categorisation + stage linkage
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other'
    CONSTRAINT project_documents_category_check
    CHECK (category IN ('contract','permit','receipt','invoice','report','site_photo','other')),
  ADD COLUMN IF NOT EXISTS stage_id UUID
    REFERENCES public.project_stages(id) ON DELETE SET NULL;

-- Index for stage-linked document lookups
CREATE INDEX IF NOT EXISTS idx_project_documents_stage_id
  ON public.project_documents(stage_id);
