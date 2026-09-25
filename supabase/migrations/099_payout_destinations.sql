-- =========================================================
-- 099  Where a contractor's money is actually sent
--
-- WHY
--
-- `authorise_release` names a beneficiary — an account, gated by an accepted invite — and
-- that is as far as Groundwork can currently describe a payout. SwyChr's
-- `create_transaction` wants a country, a method, and either a mobile number or a bank
-- code plus an account number. None of that exists anywhere, so the outbound call has
-- nowhere trustworthy to read it from.
--
-- WHY NOT ON AN EXISTING TABLE
--
-- Not on `contractors` (033): that directory has no key to any account — the only bridge
-- is an email address, which is a guess, not a relationship.
-- Not on `contractor_invites` (004): an invite is an assignment to ONE project. Payment
-- details belong to the person and are reused across every project they work on; putting
-- them on the invite would copy a bank account per project and let the copies disagree.
--
-- So: keyed on the ACCOUNT, reusable, several per person, one default.
--
-- ── Stored is not usable ─────────────────────────────────────────────────────────────
-- A row exists the moment somebody types it. `status` starts `unverified` and nothing in
-- this migration can make it `verified` — no default, no trigger, no first-row special
-- case. `payout_destination_eligible()` is the single place that answers "may money be
-- sent here", and it says no to everything but a verified, non-retired row. Numbers in a
-- database must never quietly become permission to send money to them.
--
-- ── The numbers themselves stay out of the audit log ─────────────────────────────────
-- `project_audit_log.details` is readable by staff and is not the place for an account
-- number. The RPCs below log the destination id, its method and its status. What changed,
-- never what it changed to.
--
-- Run in: Supabase Dashboard > SQL Editor (after 098)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.payout_destinations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The contractor's ACCOUNT. No foreign key, per 089's rule for people: a destination is
  -- a record of where money was sent, and closing an account does not unsend it.
  owner_id       uuid NOT NULL,

  -- SwyChr requires it on every call, and the method list is per country.
  country_code   text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  method         text NOT NULL CHECK (method IN ('mobile_money', 'bank')),

  mobile_no      text,
  bank_code      text,
  account_number text,
  account_name   text,

  status         text NOT NULL DEFAULT 'unverified'
                   CHECK (status IN ('unverified', 'verified', 'retired')),
  is_default     boolean NOT NULL DEFAULT false,

  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  verified_at    timestamptz,
  verified_by    uuid,
  retired_at     timestamptz,

  -- A row is one method or the other, never a blur of both. Without this a mobile row
  -- could carry a stale bank account and the payout code would have to guess which the
  -- person meant.
  CONSTRAINT payout_destination_shape CHECK (
    (method = 'mobile_money'
       AND mobile_no IS NOT NULL AND btrim(mobile_no) <> ''
       AND bank_code IS NULL AND account_number IS NULL)
    OR
    (method = 'bank'
       AND bank_code IS NOT NULL AND btrim(bank_code) <> ''
       AND account_number IS NOT NULL AND btrim(account_number) <> ''
       AND mobile_no IS NULL)
  ),

  -- Mobile numbers reach a handset or they do not. E.164, the same bar the rest of the
  -- product applies before sending anything.
  CONSTRAINT payout_destination_mobile_e164 CHECK (
    mobile_no IS NULL OR mobile_no ~ '^\+[0-9]{7,15}$'
  ),

  -- "Verified" is a claim about a check somebody performed. It carries its timestamp or
  -- it is not that claim.
  CONSTRAINT payout_destination_verified_dated CHECK (
    (status = 'verified') = (verified_at IS NOT NULL)
  ),

  -- A retired destination is out of use. It cannot also be the one money goes to.
  CONSTRAINT payout_destination_retired_not_default CHECK (
    status <> 'retired' OR is_default = false
  ),
  CONSTRAINT payout_destination_retired_dated CHECK (
    (status = 'retired') = (retired_at IS NOT NULL)
  )
);

-- Exactly one live default per person, enforced by the database rather than by whichever
-- code path happens to run. Retired rows are excluded so a person can retire a default
-- and choose another without a dance.
CREATE UNIQUE INDEX IF NOT EXISTS payout_destinations_one_default
  ON public.payout_destinations (owner_id)
  WHERE is_default = true AND status <> 'retired';

CREATE INDEX IF NOT EXISTS payout_destinations_owner_idx
  ON public.payout_destinations (owner_id, status);

COMMENT ON TABLE public.payout_destinations IS
  'Where a contractor is paid. Keyed on the account, reusable across projects, one live '
  'default each. status starts unverified and only a staff act makes it verified — see '
  'payout_destination_eligible(), the one answer to "may money be sent here". See 099.';

-- ── Is this somewhere money may actually go? ─────────────
--
-- The single authority. Every future payout path asks this rather than reimplementing it,
-- so "we have some numbers" can never drift into "safe to send".
CREATE OR REPLACE FUNCTION public.payout_destination_eligible(p_destination uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payout_destinations
     WHERE id = p_destination
       AND status = 'verified'
       AND verified_at IS NOT NULL
  );
$$;

COMMENT ON FUNCTION public.payout_destination_eligible(uuid) IS
  'True only for a verified, non-retired destination. Unverified numbers in the database '
  'are not permission to send money to them. See 099.';

-- ── The acts ─────────────────────────────────────────────
--
-- Writes go through these, never through the table: the default-swap has to be one
-- transaction, and the audit line has to be written by the same thing that made the
-- change. RLS below grants no INSERT/UPDATE/DELETE at all.

CREATE OR REPLACE FUNCTION public.add_payout_destination(
  p_owner uuid, p_country text, p_method text,
  p_mobile text DEFAULT NULL, p_bank_code text DEFAULT NULL,
  p_account_number text DEFAULT NULL, p_account_name text DEFAULT NULL,
  p_make_default boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  -- Your own, or staff acting for somebody. Nobody else's.
  IF NOT (p_owner = v_actor OR public.is_admin()) THEN
    RAISE EXCEPTION 'not_owner: a payout destination belongs to its account';
  END IF;

  -- One transaction: the old default is stood down before the new one is written, so the
  -- unique index never sees two.
  IF p_make_default THEN
    UPDATE public.payout_destinations
       SET is_default = false, updated_at = now()
     WHERE owner_id = p_owner AND is_default = true AND status <> 'retired';
  END IF;

  INSERT INTO public.payout_destinations
    (owner_id, country_code, method, mobile_no, bank_code, account_number, account_name,
     is_default, created_by)
  VALUES
    (p_owner, upper(btrim(p_country)), p_method,
     NULLIF(btrim(p_mobile), ''), NULLIF(btrim(p_bank_code), ''),
     NULLIF(btrim(p_account_number), ''), NULLIF(btrim(p_account_name), ''),
     COALESCE(p_make_default, false), v_actor)
  RETURNING id INTO v_id;

  -- What changed, never what it changed to. No number reaches the log.
  PERFORM public.log_activity(NULL, 'payout_destination.added', 'payout_destination', v_id, p_owner,
    jsonb_build_object('method', p_method, 'country_code', upper(btrim(p_country)),
                       'status', 'unverified', 'is_default', COALESCE(p_make_default, false)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_default_payout_destination(p_destination uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.payout_destinations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.payout_destinations WHERE id = p_destination FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such destination'; END IF;
  IF NOT (v_row.owner_id = v_actor OR public.is_admin()) THEN
    RAISE EXCEPTION 'not_owner: a payout destination belongs to its account';
  END IF;
  IF v_row.status = 'retired' THEN
    RAISE EXCEPTION 'retired: a retired destination cannot be the default';
  END IF;

  UPDATE public.payout_destinations
     SET is_default = false, updated_at = now()
   WHERE owner_id = v_row.owner_id AND is_default = true AND id <> p_destination AND status <> 'retired';
  UPDATE public.payout_destinations SET is_default = true, updated_at = now() WHERE id = p_destination;

  PERFORM public.log_activity(NULL, 'payout_destination.default_set', 'payout_destination', p_destination, v_row.owner_id,
    jsonb_build_object('method', v_row.method, 'status', v_row.status));
END $$;

CREATE OR REPLACE FUNCTION public.retire_payout_destination(p_destination uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.payout_destinations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.payout_destinations WHERE id = p_destination FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such destination'; END IF;
  IF NOT (v_row.owner_id = v_actor OR public.is_admin()) THEN
    RAISE EXCEPTION 'not_owner: a payout destination belongs to its account';
  END IF;
  IF v_row.status = 'retired' THEN RETURN; END IF;

  -- Retiring clears the default in the same statement: the CHECK forbids a retired
  -- default, and doing it in two would leave a moment where the row violates it.
  UPDATE public.payout_destinations
     SET status = 'retired', retired_at = now(), is_default = false, updated_at = now()
   WHERE id = p_destination;

  PERFORM public.log_activity(NULL, 'payout_destination.retired', 'payout_destination', p_destination, v_row.owner_id,
    jsonb_build_object('method', v_row.method, 'was_default', v_row.is_default));
END $$;

-- Staff only. Verification is a statement that somebody checked, so only somebody may
-- make it — never a default, never a trigger, never the first row by accident.
CREATE OR REPLACE FUNCTION public.verify_payout_destination(p_destination uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.payout_destinations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only staff verify a payout destination';
  END IF;
  SELECT * INTO v_row FROM public.payout_destinations WHERE id = p_destination FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such destination'; END IF;
  IF v_row.status = 'retired' THEN RAISE EXCEPTION 'retired: a retired destination is not verified'; END IF;
  IF v_row.status = 'verified' THEN RETURN; END IF;

  UPDATE public.payout_destinations
     SET status = 'verified', verified_at = now(), verified_by = v_actor, updated_at = now()
   WHERE id = p_destination;

  PERFORM public.log_activity(NULL, 'payout_destination.verified', 'payout_destination', p_destination, v_row.owner_id,
    jsonb_build_object('method', v_row.method, 'verified_by', v_actor));
END $$;

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE public.payout_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_read_payout_destinations" ON public.payout_destinations;
DROP POLICY IF EXISTS "admin_read_payout_destinations" ON public.payout_destinations;

-- The person whose account it is, and staff who have to run the payout. Nobody else —
-- a client must never see a contractor's account number, and one contractor must never
-- see another's.
CREATE POLICY "owner_read_payout_destinations" ON public.payout_destinations
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "admin_read_payout_destinations" ON public.payout_destinations
  FOR SELECT TO authenticated USING (public.is_admin());
-- No INSERT / UPDATE / DELETE policy: the four RPCs above are the only writers.

REVOKE ALL ON FUNCTION public.payout_destination_eligible(uuid)                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_payout_destination(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_default_payout_destination(uuid)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retire_payout_destination(uuid)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_payout_destination(uuid)                                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payout_destination_eligible(uuid)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_payout_destination(uuid, text, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_payout_destination(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.retire_payout_destination(uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_payout_destination(uuid)                                   TO authenticated;

-- ── Verify ───────────────────────────────────────────────
SELECT 'table'            AS what, count(*)::text AS n FROM information_schema.tables  WHERE table_name = 'payout_destinations'
UNION ALL SELECT 'one-default index', count(*)::text FROM pg_indexes WHERE indexname = 'payout_destinations_one_default'
UNION ALL SELECT 'write policies (expect 0)', count(*)::text FROM pg_policies
  WHERE tablename = 'payout_destinations' AND cmd <> 'SELECT'
UNION ALL SELECT 'verified rows (expect 0 on a fresh install)', count(*)::text
  FROM public.payout_destinations WHERE status = 'verified';

-- ── Rollback (not run) ───────────────────────────────────
-- DROP FUNCTION IF EXISTS public.verify_payout_destination(uuid), public.retire_payout_destination(uuid),
--   public.set_default_payout_destination(uuid),
--   public.add_payout_destination(uuid, text, text, text, text, text, text, boolean),
--   public.payout_destination_eligible(uuid);
-- DROP TABLE IF EXISTS public.payout_destinations;
