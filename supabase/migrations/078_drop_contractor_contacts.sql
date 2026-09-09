-- =========================================================
-- 078  Remove contractor_contacts, and close two loose grants
--
-- WHY THIS EXISTS AT ALL
--
-- An earlier draft of 075 shipped a `contractor_contacts()` function that returned
-- contractor phone numbers and email addresses to any Jalla Verify subscriber. It was
-- written before the rule was settled; the rule — every form of contact happens inside
-- Groundwork, no homeowner receives a contractor's details on any tier — arrived after,
-- and 075 was rewritten to drop it.
--
-- That rewrite is only true of the FILE. A database that already ran the earlier draft
-- still has the function, and an editing history is not a migration. Confirmed live on
-- 9 Sep 2026: the function answered 42501 (permission denied) rather than PGRST202
-- (no such function), which is how you tell "revoked" from "gone".
--
-- Nothing calls it any more. It is removed rather than left revoked, because a function
-- that hands out contact details is one GRANT away from doing so again.
-- =========================================================

DROP FUNCTION IF EXISTS public.contractor_contacts();
DROP FUNCTION IF EXISTS public.contractor_contact(UUID);   -- the per-id draft before it

-- ── The default nobody means to grant ────────────────────
--
-- Postgres grants EXECUTE on a new function to PUBLIC. `GRANT ... TO authenticated`
-- adds to that; it does not replace it, so `anon` kept inheriting the PUBLIC grant and
-- could call this. It returns false for a caller with no session, so nothing leaked —
-- but "harmless because of what it happens to return" is not the same as "not callable",
-- and the other functions in 075 were revoked properly.
REVOKE ALL     ON FUNCTION public.contractor_directory_entitled() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contractor_directory_entitled() TO authenticated;

-- Same treatment for the two written since, for the same reason.
REVOKE ALL     ON FUNCTION public.admin_list_contractors() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_contractors() TO authenticated;
