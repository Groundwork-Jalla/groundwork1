-- =========================================================
-- 110  A contractor may only build for a client who actually is one
--
-- WHY — THIS CLOSES A LIVE HOLE IN 109
--
-- 109 scoped a partner's right to create a project to "a client they brought on", and
-- recorded that in `contractor_clients`. The scoping was right. What was wrong is what
-- got into that table.
--
-- The server invites the client by address, through `findOrCreateUserByEmail` — which
-- returns an EXISTING account silently when the address already belongs to somebody. The
-- handler then wrote the link regardless. So a contractor who knew any address on the
-- platform — another contractor's client, a member of staff — could enter it, have the
-- link recorded, and from that moment:
--
--   · create projects owned by that person, who never agreed to anything;
--   · become the PRIMARY contractor on them, which is the position a release pays;
--   · and the victim was told nothing — a project simply appeared on their dashboard.
--
-- ── The rule ─────────────────────────────────────────────────────────────────────────
-- A link grants nothing on its own. It grants only when one of two things is true:
--
--   · the account did not exist until this contractor invited it. The invitation IS the
--     consent: the only way into that account is the mail we sent, so nobody is being
--     signed up behind their back; or
--   · the client has explicitly accepted (`accepted_at`).
--
-- Everything else — an address that already belonged to somebody — grants nothing, and
-- that is the case the handler now refuses outright. A client who already has an account
-- brings a contractor on the way that already existed: they invite them from inside their
-- own project.
--
-- ── Fail closed on what is already there ─────────────────────────────────────────────
-- `client_was_created` defaults to false, so EVERY row written before this migration
-- grants nothing until the client accepts. That is deliberate. We cannot tell after the
-- fact which of those addresses were new and which were taken, and the safe answer to an
-- unknown is no.
--
-- Run in: Supabase Dashboard > SQL Editor (after 109) — AS SOON AS POSSIBLE
-- =========================================================

BEGIN;

-- ── 1. Was this account ours to create? ──────────────────
ALTER TABLE public.contractor_clients
  ADD COLUMN IF NOT EXISTS client_was_created boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contractor_clients.client_was_created IS
  'True only when the invitation itself created the account (110). False means the '
  'address already belonged to somebody, and the link grants nothing until that person '
  'accepts — a contractor must not be able to build for an account they merely named.';

-- ── 2. The gate both policies read ───────────────────────
--
-- Replaces 109's version, which asked only "is there a row". Both call sites — the
-- projects policy and the four that hang off a project — go through these two, so there
-- is one place where this rule lives.
CREATE OR REPLACE FUNCTION public.is_my_client(p_client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contractor_clients cc
     WHERE cc.contractor_id = auth.uid()
       AND cc.client_id = p_client
       AND (cc.client_was_created OR cc.accepted_at IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_my_clients_project(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
      JOIN public.contractor_clients cc ON cc.client_id = p.user_id
     WHERE p.id = p_project
       AND cc.contractor_id = auth.uid()
       AND (cc.client_was_created OR cc.accepted_at IS NOT NULL)
  );
$$;

-- ── 3. A link may never be written for an account that existed ───────────────────────
--
-- Defence in depth. The handler refuses this case, but the handler is one deploy away
-- from being wrong again, and this table is the thing that grants the right.
CREATE OR REPLACE FUNCTION public.contractor_clients_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A contractor cannot be their own client; 109 has the CHECK, this keeps the error
  -- readable when the row arrives through an upsert.
  IF NEW.contractor_id = NEW.client_id THEN
    RAISE EXCEPTION 'self_client: a contractor is not their own client';
  END IF;

  -- Claiming the account was new is only true if nobody else has already claimed this
  -- client, and is never something a later update may switch on.
  IF TG_OP = 'UPDATE' AND NEW.client_was_created AND NOT OLD.client_was_created THEN
    RAISE EXCEPTION 'cannot_promote: a link cannot become "newly created" after the fact';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contractor_clients_guard ON public.contractor_clients;
CREATE TRIGGER contractor_clients_guard
  BEFORE INSERT OR UPDATE ON public.contractor_clients
  FOR EACH ROW EXECUTE FUNCTION public.contractor_clients_guard();

-- ── 4. The client accepts ────────────────────────────────
--
-- The consent path for an address that already had an account. Only the client may call
-- it, for a link that names them — a contractor cannot accept on their behalf.
CREATE OR REPLACE FUNCTION public.accept_contractor_link(p_link uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.contractor_clients%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO v_row FROM public.contractor_clients WHERE id = p_link FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such link'; END IF;
  IF v_row.client_id <> v_actor THEN
    RAISE EXCEPTION 'not_yours: only the client named on a link may accept it';
  END IF;

  UPDATE public.contractor_clients
     SET accepted_at = COALESCE(accepted_at, now())
   WHERE id = p_link;

  PERFORM public.log_activity(NULL, 'contractor.client_link_accepted',
    NULL, NULL, v_actor, jsonb_build_object('contractor_id', v_row.contractor_id));
END $$;

REVOKE ALL ON FUNCTION public.accept_contractor_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_contractor_link(uuid) TO authenticated;

-- ── 5. Taking the project makes them primary, including on a retry ───────────────────
--
-- 109 set `is_primary` in the INSERT but not in the ON CONFLICT branch. So where a row
-- already existed — the client had invited this contractor to the project first — they
-- were marked accepted and `is_primary` silently stayed false. The partner who built the
-- project would not have been the one a release paid.
--
-- Set on conflict too, but only when nobody else already holds it: 101 has a partial
-- unique index allowing one primary per project, and overwriting somebody else's standing
-- is a decision for staff, not a side effect of a retry.
CREATE OR REPLACE FUNCTION public.contractor_take_own_client_project(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_id    uuid;
  v_other boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT public.is_my_clients_project(p_project) THEN
    RAISE EXCEPTION 'not_my_client: this project does not belong to a client you brought on';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;
  IF v_email IS NULL THEN RAISE EXCEPTION 'no_email: your account has no address on file'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.contractor_invites
     WHERE project_id = p_project AND is_primary
       AND lower(email) IS DISTINCT FROM lower(v_email)
  ) INTO v_other;

  INSERT INTO public.contractor_invites
    (project_id, invited_by, email, role, status, accepted_at, is_primary)
  VALUES (p_project, v_actor, v_email, 'contractor', 'accepted', now(), NOT v_other)
  ON CONFLICT (project_id, email) DO UPDATE
     SET status      = 'accepted',
         accepted_at = COALESCE(public.contractor_invites.accepted_at, now()),
         -- The fix: a retry, or a row the client created first, still ends up primary.
         is_primary  = public.contractor_invites.is_primary OR NOT v_other
  RETURNING id INTO v_id;

  UPDATE public.contractor_invites SET contractor_user_id = v_actor WHERE id = v_id;

  PERFORM public.log_activity(p_project, 'contractor.took_own_client_project',
    'contractor_invite', v_id, v_actor,
    jsonb_build_object('primary', NOT v_other, 'another_primary_existed', v_other));
  RETURN v_id;
END $$;

COMMIT;
