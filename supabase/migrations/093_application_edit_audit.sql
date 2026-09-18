-- =========================================================
-- 093 · Admin edits to contractor applications leave a trace
--
-- Admins can now correct an application from /admin/applications/:id — a mistyped
-- phone number, a trade chosen wrongly, a city spelt three ways. The row is the
-- applicant's own account of themselves, though, and "why do you want to join" edited
-- by staff with no record of it is the kind of thing that erodes trust in a review
-- process. So the database stamps who last changed the CONTENT and when.
--
-- Stamped by trigger, not by the client: a page that forgets to set it would leave a
-- silent edit, which is the one outcome this exists to prevent. Status changes,
-- acknowledgement and CRM bookkeeping are not content and do not stamp.
-- =========================================================

ALTER TABLE public.contractor_applications
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contractor_applications.edited_at IS
  'Last time an admin changed what the applicant submitted. NULL = as submitted. See 093.';

CREATE OR REPLACE FUNCTION public.stamp_application_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the columns the applicant filled in. Anything else changing alone is
  -- bookkeeping and must not look like an edit.
  IF ROW(NEW.full_name, NEW.business_name, NEW.phone, NEW.email, NEW.country, NEW.city,
         NEW.portfolio_url, NEW.role, NEW.role_other, NEW.years_experience,
         NEW.operates_as, NEW.team_size, NEW.project_types, NEW.credentials,
         NEW.projects, NEW.accepts_milestones, NEW.accepts_verification,
         NEW.accepts_no_side_pay, NEW.video_url, NEW.why_join, NEW.differentiator,
         NEW.ready_for_early, NEW.regions, NEW.concurrent_projects, NEW.lang)
     IS DISTINCT FROM
     ROW(OLD.full_name, OLD.business_name, OLD.phone, OLD.email, OLD.country, OLD.city,
         OLD.portfolio_url, OLD.role, OLD.role_other, OLD.years_experience,
         OLD.operates_as, OLD.team_size, OLD.project_types, OLD.credentials,
         OLD.projects, OLD.accepts_milestones, OLD.accepts_verification,
         OLD.accepts_no_side_pay, OLD.video_url, OLD.why_join, OLD.differentiator,
         OLD.ready_for_early, OLD.regions, OLD.concurrent_projects, OLD.lang)
  THEN
    NEW.edited_at := now();
    NEW.edited_by := auth.uid();
  ELSE
    -- The stamp is the trigger's to write. A client sending its own value gets it undone.
    --
    -- One exception: ON DELETE SET NULL is an UPDATE through this trigger, and pinning
    -- edited_by there would make deleting a former admin fail on every row they touched.
    -- That case is recognisable — the admin it points at is already gone — and only
    -- that case may null it. A client nulling it while the admin still exists is undone.
    NEW.edited_at := OLD.edited_at;
    IF NEW.edited_by IS DISTINCT FROM OLD.edited_by THEN
      IF NOT (NEW.edited_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.edited_by)) THEN
        NEW.edited_by := OLD.edited_by;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_application_edit ON public.contractor_applications;
CREATE TRIGGER trg_stamp_application_edit
  BEFORE UPDATE ON public.contractor_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_application_edit();
