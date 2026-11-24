-- Remove stray uncoded [Draft] placeholder lifecycle steps (seeded if migration 177
-- was re-run after real activation journeys) so users never receive emails containing
-- "PLACEHOLDER — replace with the approved wording."
BEGIN;

DELETE FROM public.lifecycle_sequence_steps
WHERE (code IS NULL OR btrim(code) = '')
  AND (
    subject_en LIKE '[Draft] %'
    OR subject_fr LIKE '[Brouillon] %'
    OR body_en LIKE '%PLACEHOLDER — replace with the approved wording.%'
    OR body_fr LIKE '%PROVISOIRE — à remplacer par le texte approuvé.%'
  );

-- Cancel any pending deliveries whose subject/body carried the placeholder text
-- or whose step no longer exists.
UPDATE public.lifecycle_deliveries d
SET status = 'skipped',
    last_error = 'removed_seeded_draft_placeholder'
WHERE d.status IN ('prepared', 'failed', 'blocked')
  AND NOT EXISTS (
    SELECT 1
    FROM public.lifecycle_enrollments e
    JOIN public.lifecycle_sequence_steps s
      ON s.sequence_key = e.sequence_key AND s.position = d.position
    WHERE e.id = d.enrollment_id
  );

COMMIT;
