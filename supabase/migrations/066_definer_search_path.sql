-- =========================================================
-- 066  Close the search_path gap on the outbox reader
--
-- `admin_ghl_outbox()` (050) is SECURITY DEFINER with `SET search_path = public`. With a
-- schema on the path, a caller can create an object that shadows an unqualified
-- reference inside the function body and have it execute with the owner's rights. The
-- body here happens to qualify everything already, so this is a hardening rather than a
-- live hole — but the setting is what makes that guarantee hold when someone edits the
-- body later, and Supabase's linter flags it either way.
--
-- `''` is the correct value: it forces every reference to be schema-qualified, which
-- they now are. 065 was written this way from the start.
--
-- Nothing else about the function changes.
-- =========================================================

CREATE OR REPLACE FUNCTION public.admin_ghl_outbox(limit_n INT DEFAULT 100)
RETURNS TABLE (
  id UUID, event TEXT, email TEXT, status TEXT, attempts INT,
  last_error TEXT, created_at TIMESTAMPTZ, sent_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;

  RETURN QUERY
    SELECT o.id, o.event, o.email, o.status, o.attempts,
           o.last_error, o.created_at, o.sent_at
      FROM public.ghl_outbox o
     WHERE o.status <> 'sent'
     ORDER BY o.created_at DESC
     LIMIT GREATEST(1, LEAST(limit_n, 500));
END $$;

REVOKE ALL ON FUNCTION public.admin_ghl_outbox(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ghl_outbox(INT) TO authenticated;


-- ── Anything else still on a schema-qualified path ───────
-- Run this after applying; it should return no rows. Any that appear are SECURITY
-- DEFINER functions whose body must be requalified before their search_path is changed.
--
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.prosecdef
--      AND (p.proconfig IS NULL
--           OR NOT ('search_path=' = ANY (SELECT split_part(c, '"', 1) FROM unnest(p.proconfig) c)))
--    ORDER BY p.proname;
