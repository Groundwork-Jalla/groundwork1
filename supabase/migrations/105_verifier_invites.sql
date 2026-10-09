-- =========================================================
-- 105  A verifier's own front door
--
-- WHY
--
-- A contractor has had a way in since 100: they apply at /contractor-apply, Jalla
-- interviews them, an admin accepts the application, and the acceptance email carries a
-- claim token that turns into a contractor account. One gate.
--
-- A verifier has had none. `user_roles` has permitted `role = 'verifier'` since 001 and
-- 086 built the whole surface on it, but nothing could create one: /admin/verifiers is a
-- read-only directory and no RPC granted the role. The only way was an admin typing the
-- account in by hand, which means staff choose someone's password for them and the person
-- never signs themselves up.
--
-- This gives the verifier the same shape the contractor already has — an invitation we
-- email, and a page that says "Sign up as a verifier".
--
-- ── Why an invitation and not an open signup ──────────────────────────────────────────
-- A verifier's signature is what releases a stage payment (087, 090). If the page that
-- grants the role were open, anyone could hold it while we got round to checking them —
-- and `approve_stage` does not ask how the role was obtained. So the role stays earned:
-- Jalla interviews the engineer, an admin invites that email, and the token we mail is
-- what proves the person opening it is the one we interviewed.
--
-- This is the same reasoning 100 recorded for contractors, and the same mechanism:
--
--     the token is the capability; holding it is the proof.
--
-- ── What this does NOT do ────────────────────────────────────────────────────────────
-- It does not fill `verifier_profiles` (discipline, registration body, city). Claiming
-- makes the ACCOUNT and grants the ROLE; the credentials behind it stay a staff task, and
-- `listVerifierDirectory` already renders a verifier who holds the role with no profile.
--
-- Run in: Supabase Dashboard > SQL Editor (after 104)
-- =========================================================

BEGIN;

-- ── 1. The invitation ────────────────────────────────────
--
-- Deliberately its own table rather than a column on `verifier_profiles`: the invitation
-- exists BEFORE there is any account or profile to hang it on, which is the whole point.
CREATE TABLE IF NOT EXISTS public.verifier_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  full_name   text        NOT NULL,
  token       uuid        NOT NULL DEFAULT gen_random_uuid(),
  invited_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at  timestamptz NOT NULL DEFAULT now(),
  -- Claimed and linked are the same fact. Either both or neither — the shape 100 uses.
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT verifier_invite_claim_shape CHECK ((claimed_at IS NULL) = (user_id IS NULL)),
  -- An invitation cannot be both spent and withdrawn: withdrawing a claimed one would
  -- read as "this account is not a verifier" while the role row says otherwise.
  CONSTRAINT verifier_invite_not_both  CHECK (NOT (claimed_at IS NOT NULL AND revoked_at IS NOT NULL)),
  -- Who withdrew it is part of withdrawing it. This table is the audit record for an
  -- invitation, because `log_activity` cannot hold one: it refuses an activity with
  -- neither a project nor a person, and an invited address has no account yet.
  CONSTRAINT verifier_invite_revoked_by CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- A token is a secret; two invitations must never share one.
CREATE UNIQUE INDEX IF NOT EXISTS verifier_invites_token
  ON public.verifier_invites (token);

-- One account, one invitation. Without this one person could claim several.
CREATE UNIQUE INDEX IF NOT EXISTS verifier_invites_one_per_account
  ON public.verifier_invites (user_id) WHERE user_id IS NOT NULL;

-- One live invitation per address. Re-inviting someone resends the token they already
-- have (see issue_verifier_invite) instead of leaving two valid links in two inboxes.
CREATE UNIQUE INDEX IF NOT EXISTS verifier_invites_one_open_per_email
  ON public.verifier_invites (lower(email))
  WHERE claimed_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE public.verifier_invites IS
  'An invitation to become a Groundwork verifier (105). Created by an admin after the '
  'engineer has been interviewed; the token is mailed to `email` and claiming it grants '
  'the verifier role. Not a profile: credentials live in verifier_profiles (086).';

ALTER TABLE public.verifier_invites ENABLE ROW LEVEL SECURITY;

-- No policy for anon or an ordinary user: everything a visitor needs comes through
-- `verifier_invite_preview`, which returns one row and only to the token holder.
DROP POLICY IF EXISTS "admins_all_verifier_invites" ON public.verifier_invites;
CREATE POLICY "admins_all_verifier_invites"
  ON public.verifier_invites FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- An invited person may read the row they claimed, so the app can show them their standing.
DROP POLICY IF EXISTS "invitee_read_own_verifier_invite" ON public.verifier_invites;
CREATE POLICY "invitee_read_own_verifier_invite"
  ON public.verifier_invites FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 2. Issue an invitation ───────────────────────────────
--
-- Admin-only. Idempotent for the same address: an open invitation returns the token it
-- already has, so re-sending the email never invalidates the link already in their inbox.
CREATE OR REPLACE FUNCTION public.issue_verifier_invite(p_email text, p_full_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_token uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may invite a verifier';
  END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email: a verifier invitation needs an address to send to';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'name_required: the page has to be able to say whose invitation it is';
  END IF;

  -- The address already belongs to a verifier: nothing to invite.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'verifier'
     WHERE lower(p.email) = v_email
  ) THEN
    RAISE EXCEPTION 'already_verifier: that address already holds the verifier role';
  END IF;

  SELECT token INTO v_token FROM public.verifier_invites
   WHERE lower(email) = v_email AND claimed_at IS NULL AND revoked_at IS NULL;
  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;

  -- `invited_by` and `invited_at` on the row below are the record of this act.
  INSERT INTO public.verifier_invites (email, full_name, invited_by)
  VALUES (v_email, v_name, v_actor)
  RETURNING token INTO v_token;

  RETURN v_token;
END $$;

-- ── 3. Who the link is for ───────────────────────────────
--
-- Granted to anon for the same reason 100 grants its preview: the invitee has no account
-- yet, and a page that cannot name whose invitation it is reads as a phishing link. It
-- returns that one invitation's own name and address and nothing else — no other
-- invitation is reachable without its token.
CREATE OR REPLACE FUNCTION public.verifier_invite_preview(p_token uuid)
RETURNS TABLE (full_name text, email text, claimed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.full_name, i.email, i.claimed_at IS NOT NULL
    FROM public.verifier_invites i
   WHERE i.token = p_token AND i.revoked_at IS NULL;
$$;

-- ── 4. Claim it ──────────────────────────────────────────
--
-- Links the invitation to the signed-in account and grants the role. With 100's claim and
-- the admin provisioning endpoint, this is the third and last way the verifier role is
-- granted — and the only one the verifier themselves can walk through.
CREATE OR REPLACE FUNCTION public.claim_verifier_account(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  i       public.verifier_invites%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: create an account first, then claim';
  END IF;

  SELECT * INTO i FROM public.verifier_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND             THEN RAISE EXCEPTION 'invalid_token: no invitation matches that link'; END IF;
  IF i.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked: that invitation has been withdrawn'; END IF;

  -- Claiming twice from the same account is a refresh, not an error.
  IF i.claimed_at IS NOT NULL THEN
    IF i.user_id = v_actor THEN RETURN i.id; END IF;
    RAISE EXCEPTION 'already_claimed: another account has claimed this invitation';
  END IF;

  UPDATE public.verifier_invites
     SET user_id = v_actor, claimed_at = now()
   WHERE id = i.id;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'verifier')
  ON CONFLICT (user_id, role) DO NOTHING;

  PERFORM public.log_activity(NULL, 'verifier.account_claimed', 'verifier_invite', i.id, v_actor,
    jsonb_build_object('email', i.email));
  RETURN i.id;
END $$;

-- ── 5. Withdraw one ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_verifier_invite(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  i       public.verifier_invites%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may withdraw an invitation';
  END IF;
  SELECT * INTO i FROM public.verifier_invites WHERE id = p_invite FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invite: no such invitation'; END IF;
  -- Withdrawing a spent invitation would say "not a verifier" while user_roles says
  -- otherwise. Removing the ROLE is the separate, deliberate act.
  IF i.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_claimed: this invitation has been used; remove the role instead';
  END IF;

  UPDATE public.verifier_invites
     SET revoked_at = now(), revoked_by = v_actor
   WHERE id = i.id;
END $$;

-- ── 6. Grants ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.issue_verifier_invite(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifier_invite_preview(uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_verifier_account(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_verifier_invite(uuid)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_verifier_invite(text, text) TO authenticated;  -- is_admin() inside
GRANT EXECUTE ON FUNCTION public.verifier_invite_preview(uuid)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_verifier_account(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_verifier_invite(uuid)      TO authenticated;  -- is_admin() inside

COMMIT;
