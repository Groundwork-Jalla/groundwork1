-- A change order is a revised stage price with its reason on record.
--
-- 17-18 Nov 2026: change orders and additional works (a boys' quarters, a swimming pool,
-- a change to the structure) go through the existing revised-price flow — the contractor
-- proposes a stage price, the homeowner approves, and receipts already filed keep their
-- original amounts. Since 20261114000000 every stage's price can be revised, paid or not,
-- so no separate change-order table is needed.
--
-- What that flow lacked was the WHY. The reason was optional, so a price could move by
-- millions with nothing to say what changed — and a revised price nobody can explain is
-- exactly what an audit or a dispute later asks about. From here on every proposal states
-- what changed and why; earlier proposals are history and are not touched.
--
-- A trigger, not a rewrite of propose_stage_prices, so every writer is held to it and that
-- function's body is not re-declared.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_price_change_reason()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF btrim(coalesce(NEW.note,''))='' THEN
  RAISE EXCEPTION 'price_change_reason_required' USING HINT='Say what changed and why.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_price_change_reason() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS stage_price_amendment_reason ON public.stage_price_amendments;
CREATE TRIGGER stage_price_amendment_reason BEFORE INSERT ON public.stage_price_amendments
 FOR EACH ROW EXECUTE FUNCTION public.guard_price_change_reason();

COMMIT;

-- Verify (read-only):
--   SELECT tgname FROM pg_trigger WHERE tgname='stage_price_amendment_reason';
