-- The three-project cap is a CLIENT plan limit, not a contractor one.
--
-- 005 added it, 008 reworded it, 053 made it count archived projects too. None of
-- them distinguished who owned the project, because at the time only clients owned
-- any. A contractor now creates projects of their own — their builds, on their own
-- account — and on the fourth one the insert was refused with
-- "self_verify_limit: Self Verify plan allows a maximum of 3 projects".
--
-- That is a plan limit sold to clients. A contractor is not on a client plan and is
-- not buying one; capping their working account at three builds caps the business.
-- Philip, 29 October: "let that project creation limit, like the self-verified
-- thing, let it just be for clients for now."
--
-- Nothing else changes. The cap, its count, and its message are 053 verbatim — the
-- 'self_verify_limit:' prefix especially, which `projects.ts` matches on to tell a
-- cap refusal apart from a genuine failure. Only the exemption is new.
--
-- Contractor standing is read from `user_roles`, which is the same source the app
-- trusts (100): a role an admin granted, never anything the browser can set.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_starter_project_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A contractor's own builds are not a client plan's three projects.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = NEW.user_id AND role = 'contractor'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.tier = 'self_verify' THEN
    IF (
      SELECT COUNT(*) FROM public.projects
      WHERE user_id = NEW.user_id
        AND tier = 'self_verify'
    ) >= 3 THEN
      RAISE EXCEPTION 'self_verify_limit: Self Verify plan allows a maximum of 3 projects, including archived ones.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
