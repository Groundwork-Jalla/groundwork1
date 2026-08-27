-- =========================================================
-- 053  Free-plan cap counts every project, and owners can no longer delete
--
-- Favour, 25 Aug 2026, after the first beta test report:
--   "free plan only has 3 projects archived or not, deleted or not"
--   "i dont want them to be able to delete any projects free plan or not"
--
-- This reverses the owner-delete feature added earlier in August, and it is what
-- makes the new cap implementable at all. If a project row can never disappear,
-- "deleted or not" needs no counter, no tombstone table and no backfill — a plain
-- COUNT(*) over the rows already says it.
--
-- WHAT THE TESTER ACTUALLY FOUND. The report reads "archiving does not free a plan
-- slot", but archiving DID free one: 008's trigger counted `status != 'archived'`
-- and the dashboard's own count agreed with it. What was broken is that the
-- dashboard never filtered archived cards out of the grid, so a freed slot looked
-- like a stuck one. The counting rule is changing because Favour wants it changed,
-- not because it was wrong.
--
-- TWO HALVES, AND THE SECOND IS THE LOAD-BEARING ONE. Removing the delete button
-- without removing the DELETE privilege would be theatre: `owner_all_projects` is
-- FOR ALL, so anyone with the anon key and ten minutes could still cycle slots by
-- calling the REST endpoint directly. Since evading the cap is the exact behaviour
-- this is meant to stop, the privilege has to go too.
--
-- EXISTING USERS ARE GRANDFATHERED, with no work required: the trigger fires
-- BEFORE INSERT only, so nobody loses a project they already hold. Someone sitting
-- on four projects keeps all four and simply cannot create a fifth.
-- =========================================================

-- ── 1. The cap counts everything ─────────────────────────
--
-- Only the `status != 'archived'` clause is gone; the rest is 008 verbatim, including
-- the 'self_verify_limit:' message prefix, which projects.ts matches on to tell a cap
-- refusal apart from a genuine failure. Do not reword it.
CREATE OR REPLACE FUNCTION public.check_starter_project_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- The trigger binding itself is unchanged from 005; restated so this file is
-- self-contained if it is ever replayed against a fresh database.
DROP TRIGGER IF EXISTS enforce_starter_project_limit ON public.projects;
CREATE TRIGGER enforce_starter_project_limit
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.check_starter_project_limit();

-- ── 2. Owners lose DELETE ────────────────────────────────
--
-- `owner_all_projects` (003) is FOR ALL, which is SELECT + INSERT + UPDATE + DELETE.
-- Split into the three that remain. Archiving is an UPDATE of `status`, so the
-- archive/restore flow is untouched.
DROP POLICY IF EXISTS "owner_all_projects" ON public.projects;

CREATE POLICY "owner_select_projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "owner_insert_projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_projects"
  ON public.projects FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No owner DELETE policy, deliberately. With RLS enabled and no policy for the
-- command, PostgreSQL denies it — there is nothing further to revoke.
--
-- Admin deletion is unaffected: `admin_delete_user()` (035) is SECURITY DEFINER, so
-- it runs as the function owner and bypasses RLS. Deleting an account still cascades
-- its projects. That remains the only route by which a project row disappears, which
-- is what keeps the count above honest.

COMMENT ON FUNCTION public.check_starter_project_limit() IS
  'Self Verify allows 3 projects per user, counting archived ones (053). Owners '
  'cannot delete projects, so this count never decreases — that is the point, and it '
  'is why no separate counter is needed to satisfy "deleted or not".';
